import { differenceInCalendarDays } from 'date-fns';
import {
  SCHEDULE,
  COMPANIES,
  FINANCE_DISCORD_IDS,
  MANAGEMENT_DISCORD_IDS,
  CASE_STATUSES_REQUIRING_REVIEW,
  TERMINAL_CASE_STATUSES,
  normalizeCaseStatus,
  STATUS,
} from './config.js';
import { parseSheetDate } from './sheets.js';

/** Determines the company from the letter prefix of the document number (GLJ26_0955). */
export function companyForDocNr(docNr) {
  const prefix = (docNr.match(/^\p{L}+/u)?.[0] ?? '').toUpperCase();
  const company = COMPANIES[prefix];
  return {
    prefix,
    name: company?.name ?? `Unknown (${prefix || '?'})`,
    responsibleName: company?.responsibleName ?? 'Not specified',
    discordIds: company?.discordIds ?? [],
  };
}

/** Recipients of the operational collection escalation (deduplicated). */
export function teamEscalationRecipients(docNr) {
  const company = companyForDocNr(docNr);
  return [...new Set([...company.discordIds, ...FINANCE_DISCORD_IDS])];
}

/** Management notification recipients. */
export function managementRecipients() {
  return [...new Set(MANAGEMENT_DISCORD_IDS)];
}

export function smsSentCount(reminderCase) {
  return [
    reminderCase.sms1Date,
    reminderCase.sms2Date,
    reminderCase.sms3Date,
  ].filter(Boolean).length;
}

function daysSince(dateStr, today) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const d = parseSheetDate(dateStr.slice(0, 10));
  if (!d) return null;
  return differenceInCalendarDays(today, d);
}

function caseStatusContext(reminderCase, today) {
  const rawCaseStatus = (reminderCase.caseStatus ?? '').trim();
  const caseStatus = normalizeCaseStatus(rawCaseStatus);
  const invalidCaseStatus = !!rawCaseStatus && !caseStatus;
  const reviewRequired = CASE_STATUSES_REQUIRING_REVIEW.includes(caseStatus);
  const reviewDate = parseSheetDate(
    (reminderCase.nextReviewDate ?? '').slice(0, 10),
  );
  const reviewDays = reviewDate
    ? differenceInCalendarDays(today, reviewDate)
    : null;

  return {
    caseStatus,
    invalidCaseStatus,
    missingReviewDate: reviewRequired && !reviewDate,
    reviewPending: reviewRequired && reviewDays !== null && reviewDays < 0,
    reviewDue: reviewRequired && reviewDays !== null && reviewDays >= 0,
  };
}

/**
 * Client SMS and the one-time collection team escalation.
 * Management notifications are evaluated separately in decideManagementAction().
 */
export function decideOperationalAction(
  invoice,
  reminderCase,
  today,
  validPhone,
) {
  const status = reminderCase.status || STATUS.NEW;
  const overdueDays = differenceInCalendarDays(today, invoice.dueDate);
  const {
    caseStatus,
    invalidCaseStatus,
    reviewPending,
  } = caseStatusContext(reminderCase, today);

  if (status === STATUS.PAID) {
    return { type: 'NONE', reason: 'already marked as paid' };
  }

  if (TERMINAL_CASE_STATUSES.includes(caseStatus)) {
    return { type: 'NONE', reason: `final case status: ${caseStatus}` };
  }

  if (reviewPending) {
    return {
      type: 'NONE',
      reason: `postponed until ${reminderCase.nextReviewDate}`,
    };
  }

  if (status === STATUS.CALL_REQUIRED) {
    if (!reminderCase.discordDate) {
      return { type: 'ESCALATE_TEAM', noPhone: !validPhone };
    }
    return { type: 'NONE', reason: 'team already informed' };
  }

  // A status set by a colleague stops SMS automation and hands the case to a person.
  if (caseStatus || invalidCaseStatus) {
    if (!reminderCase.discordDate) {
      return { type: 'ESCALATE_TEAM', noPhone: !validPhone };
    }
    return { type: 'NONE', reason: `case handled by a person: ${caseStatus || 'invalid status'}` };
  }

  // Without a valid phone number no SMS can be sent — escalate to colleagues right away.
  if (!validPhone) {
    if (reminderCase.discordDate) {
      return { type: 'NONE', reason: 'no number, team already informed' };
    }
    return { type: 'ESCALATE_TEAM', noPhone: true };
  }

  switch (status) {
    case STATUS.NEW: {
      if (overdueDays >= SCHEDULE.firstSmsAfterDueDays) {
        return { type: 'SEND_SMS', step: 1 };
      }
      return { type: 'NONE', reason: `only ${overdueDays} day(s) overdue` };
    }
    case STATUS.REMINDER_1_SENT: {
      const days = daysSince(reminderCase.sms1Date, today);
      if (days !== null && days >= SCHEDULE.secondSmsAfterDays) {
        return { type: 'SEND_SMS', step: 2 };
      }
      return { type: 'NONE', reason: `SMS2 in ${SCHEDULE.secondSmsAfterDays - (days ?? 0)} day(s)` };
    }
    case STATUS.REMINDER_2_SENT: {
      const days = daysSince(reminderCase.sms2Date, today);
      if (days !== null && days >= SCHEDULE.thirdSmsAfterDays) {
        return { type: 'SEND_SMS', step: 3 };
      }
      return { type: 'NONE', reason: `SMS3 in ${SCHEDULE.thirdSmsAfterDays - (days ?? 0)} day(s)` };
    }
    case STATUS.REMINDER_3_SENT: {
      if (reminderCase.discordDate) {
        return { type: 'MARK_CALL_REQUIRED' };
      }
      const days = daysSince(reminderCase.sms3Date, today);
      if (days !== null && days >= SCHEDULE.teamEscalationAfterSms3Days) {
        return { type: 'ESCALATE_TEAM' };
      }
      return {
        type: 'NONE',
        reason: `team escalation in ${
          SCHEDULE.teamEscalationAfterSms3Days - (days ?? 0)
        } day(s)`,
      };
    }
    default:
      // Unknown (manually entered) status — do nothing, a person is handling the process.
      return { type: 'NONE', reason: `manual status: ${status}` };
  }
}

/**
 * The management notification flow is independent of the technical SMS status.
 * That way the overdue-day-10 check still works even if an SMS failed.
 */
export function decideManagementAction(
  invoice,
  reminderCase,
  today,
  validPhone,
) {
  const status = reminderCase.status || STATUS.NEW;
  const overdueDays = differenceInCalendarDays(today, invoice.dueDate);
  const {
    caseStatus,
    invalidCaseStatus,
    missingReviewDate,
    reviewPending,
    reviewDue,
  } = caseStatusContext(reminderCase, today);

  if (status === STATUS.PAID || TERMINAL_CASE_STATUSES.includes(caseStatus)) {
    return { type: 'NONE', reason: 'case closed' };
  }
  if (reviewPending) {
    return {
      type: 'NONE',
      reason: `management review postponed until ${reminderCase.nextReviewDate}`,
    };
  }
  if (
    !reviewDue &&
    overdueDays < SCHEDULE.managerNotificationAfterDueDays
  ) {
    return {
      type: 'NONE',
      reason: `management notification in ${
        SCHEDULE.managerNotificationAfterDueDays - overdueDays
      } day(s)`,
    };
  }

  const days = daysSince(reminderCase.managementDiscordDate, today);
  if (!reviewDue && days !== null && days < SCHEDULE.managerRepeatAfterDays) {
    return {
      type: 'NONE',
      reason: `management notification in ${SCHEDULE.managerRepeatAfterDays - days} day(s)`,
    };
  }

  return {
    type: 'NOTIFY_MANAGEMENT',
    noPhone: !validPhone,
    reviewDue,
    clearReviewDate: reviewDue,
    missingReviewDate,
    invalidCaseStatus,
    includeTeamFallback: !reminderCase.discordDate,
  };
}
