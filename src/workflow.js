import { addDays, differenceInCalendarDays, format, startOfDay } from 'date-fns';
import { SCHEDULE, STATUS } from './config.js';
import { sendDiscordToMany } from './discord.js';
import { deduplicateInvoices, shouldMarkPaid } from './invoices.js';
import {
  decideManagementAction,
  decideOperationalAction,
  smsSentCount,
  teamEscalationRecipients,
} from './logic.js';
import {
  sendManagementNotification,
  sendTeamEscalation,
} from './notifications.js';
import { normalizePhone } from './phone.js';
import {
  appendHistory,
  ensureAuxSheets,
  getSheetsClient,
  readCases,
  readInvoiceSnapshot,
  saveCases,
} from './sheets.js';
import { sendSMS } from './sms.js';
import { reminderText } from './sms-texts.js';

function log(...args) {
  console.log(`[${format(new Date(), 'HH:mm:ss')}]`, ...args);
}

function newReminderCase(invoice, validPhone) {
  return {
    rowNumber: null,
    docNr: invoice.docNr,
    client: invoice.client,
    phone: validPhone ?? invoice.phoneRaw,
    amount: invoice.amount.toFixed(2),
    dueDate: invoice.dueDateRaw,
    status: STATUS.NEW,
    sms1Date: '',
    sms2Date: '',
    sms3Date: '',
    discordDate: '',
    caseStatus: '',
    callResult: '',
    notes: '',
    lastChecked: '',
    nextReviewDate: '',
    managementDiscordDate: '',
  };
}

function refreshReminderCase(reminderCase, invoice, validPhone) {
  const previous = [
    reminderCase.client,
    reminderCase.phone,
    reminderCase.amount,
    reminderCase.dueDate,
  ].join('\0');

  reminderCase.client = invoice.client || reminderCase.client;
  reminderCase.amount = invoice.amount.toFixed(2);
  reminderCase.dueDate = invoice.dueDateRaw;
  if (validPhone) reminderCase.phone = validPhone;

  return previous !== [
    reminderCase.client,
    reminderCase.phone,
    reminderCase.amount,
    reminderCase.dueDate,
  ].join('\0');
}

async function executeOperationalAction(context) {
  const {
    action,
    invoice,
    reminderCase,
    overdueDays,
    validPhone,
    today,
    todayStr,
    nowStr,
    dryRun,
    plannedActions,
    historyRows,
    markChanged,
  } = context;

  if (action.type === 'NONE') {
    plannedActions.push(
      `⏸  ${invoice.docNr} (${invoice.client}) — nothing: ${action.reason}`,
    );
    return;
  }

  if (action.type === 'MARK_CALL_REQUIRED') {
    plannedActions.push(`📞 ${invoice.docNr} — mark as handed over to the team`);
    if (dryRun) return;
    reminderCase.status = STATUS.CALL_REQUIRED;
    reminderCase.lastChecked = nowStr;
    markChanged(reminderCase);
    return;
  }

  if (action.type === 'SEND_SMS') {
    plannedActions.push(
      `📱 ${invoice.docNr} (${invoice.client}) — SMS${action.step} to ${validPhone}`,
    );
    if (dryRun) return;

    const text = reminderText(action.step, {
      docNr: invoice.docNr,
      amount: invoice.amount,
      dueDate: invoice.dueDateRaw,
    });
    const result = await sendSMS(validPhone, text, {
      id: `${invoice.docNr}-sms${action.step}`,
    });
    const nextCheckDays = action.step === 1
      ? SCHEDULE.secondSmsAfterDays
      : action.step === 2
        ? SCHEDULE.thirdSmsAfterDays
        : SCHEDULE.teamEscalationAfterSms3Days;

    if (result.ok) {
      reminderCase.status = [
        STATUS.REMINDER_1_SENT,
        STATUS.REMINDER_2_SENT,
        STATUS.REMINDER_3_SENT,
      ][action.step - 1];
      reminderCase[`sms${action.step}Date`] = todayStr;
      log(`SMS${action.step} sent: ${invoice.docNr} → ${validPhone}`);
    } else {
      log(
        `SMS${action.step} ERROR: ${invoice.docNr} → ${validPhone}: ${result.error}`,
      );
    }

    reminderCase.lastChecked = nowStr;
    markChanged(reminderCase);
    historyRows.push([
      nowStr,
      invoice.docNr,
      `SMS${action.step} reminder`,
      validPhone,
      result.ok ? 'OK' : `ERROR: ${result.error}`,
      result.ok
        ? format(addDays(today, nextCheckDays), 'yyyy-MM-dd')
        : todayStr,
    ]);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return;
  }

  if (action.type !== 'ESCALATE_TEAM') return;

  plannedActions.push(
    `📞 ${invoice.docNr} (${invoice.client}) — team Discord escalation${
      action.noPhone ? ' (no number)' : ''
    }`,
  );
  if (dryRun) return;

  const result = await sendTeamEscalation(
    reminderCase,
    overdueDays,
    action,
  );
  reminderCase.status = STATUS.CALL_REQUIRED;
  reminderCase.lastChecked = nowStr;
  if (result.ok) reminderCase.discordDate = todayStr;
  markChanged(reminderCase);

  const resultText = result.noRecipients
    ? 'ERROR: no team Discord IDs configured'
    : result.ok
      ? 'OK'
      : 'ERROR: failed to send';
  historyRows.push([
    nowStr,
    invoice.docNr,
    'Team Discord escalation',
    reminderCase.phone,
    resultText,
    result.ok
      ? format(
          addDays(invoice.dueDate, SCHEDULE.managerNotificationAfterDueDays),
          'yyyy-MM-dd',
        )
      : todayStr,
  ]);
  log(
    `Team escalation ${result.ok ? 'sent' : 'FAILED'}: ${invoice.docNr}`,
  );
}

async function executeManagementAction(context) {
  const {
    action,
    invoice,
    reminderCase,
    overdueDays,
    today,
    todayStr,
    nowStr,
    dryRun,
    plannedActions,
    historyRows,
    markChanged,
  } = context;

  if (action.type !== 'NOTIFY_MANAGEMENT') return;

  plannedActions.push(
    `🔴 ${invoice.docNr} (${invoice.client}) — management Discord notification${
      action.includeTeamFallback ? ' + team fallback notification' : ''
    }`,
  );
  if (dryRun) return;

  const result = await sendManagementNotification(
    reminderCase,
    overdueDays,
    action,
  );
  if (!result.managerConfigured) {
    log(`WARNING: ${invoice.docNr} — management Discord IDs are not configured`);
  }
  if (result.managerOk) {
    reminderCase.managementDiscordDate = todayStr;
    if (action.clearReviewDate) reminderCase.nextReviewDate = '';
  }
  if (result.teamReached) {
    reminderCase.discordDate = todayStr;
    if (reminderCase.status === STATUS.REMINDER_3_SENT) {
      reminderCase.status = STATUS.CALL_REQUIRED;
    }
  }
  reminderCase.lastChecked = nowStr;
  markChanged(reminderCase);

  const resultText = result.managerOk
    ? result.teamFallbackOk
      ? 'OK — management and team informed'
      : 'OK — management informed'
    : result.teamFallbackOk
      ? 'PARTIAL — team informed, management not reached'
      : 'ERROR: failed to send';
  historyRows.push([
    nowStr,
    invoice.docNr,
    'Management Discord notification',
    reminderCase.phone,
    resultText,
    result.managerOk
      ? format(addDays(today, SCHEDULE.managerRepeatAfterDays), 'yyyy-MM-dd')
      : todayStr,
  ]);
  log(
    `Management notification ${result.managerOk ? 'sent' : 'FAILED'}: ${invoice.docNr}`,
  );
}

export async function runWorkflow({ dryRun = false } = {}) {
  const today = startOfDay(new Date());
  const todayStr = format(today, 'yyyy-MM-dd');
  const nowStr = format(new Date(), 'yyyy-MM-dd HH:mm');

  log(
    `Starting invoice check (${
      dryRun ? 'DRY-RUN — nothing will be sent/written' : 'live mode'
    })`,
  );

  const sheets = getSheetsClient();
  if (!dryRun) await ensureAuxSheets(sheets);

  const [{ invoices: rawInvoices, sourceDocNumbers }, cases] =
    await Promise.all([readInvoiceSnapshot(sheets), readCases(sheets)]);
  const {
    invoices,
    duplicateDocNumbers,
  } = deduplicateInvoices(rawInvoices);
  if (duplicateDocNumbers.length) {
    log(
      `WARNING: duplicate document numbers (only the first row will be processed): ${
        duplicateDocNumbers.join(', ')
      }`,
    );
  }

  const overdue = invoices.filter(
    (invoice) => differenceInCalendarDays(today, invoice.dueDate) >= 1,
  );
  log(
    `${invoices.length} unique invoices in the list, overdue: ${
      overdue.length
    }; active cases: ${cases.length}`,
  );

  const casesByDocNr = new Map(cases.map((item) => [item.docNr, item]));
  const changedCasesByDocNr = new Map();
  const historyRows = [];
  const plannedActions = [];
  const markChanged = (reminderCase) => {
    changedCasesByDocNr.set(reminderCase.docNr, reminderCase);
  };

  for (const reminderCase of cases) {
    if (!shouldMarkPaid(reminderCase, sourceDocNumbers)) continue;

    const hadActivity =
      smsSentCount(reminderCase) > 0 ||
      !!reminderCase.discordDate ||
      !!reminderCase.managementDiscordDate;
    plannedActions.push(`✅ ${reminderCase.docNr} — paid, closing the case`);
    if (dryRun) continue;

    reminderCase.status = STATUS.PAID;
    reminderCase.lastChecked = nowStr;
    markChanged(reminderCase);
    historyRows.push([
      nowStr,
      reminderCase.docNr,
      'PAID — case closed',
      reminderCase.phone,
      'OK',
      '',
    ]);

    if (hadActivity) {
      await sendDiscordToMany(
        teamEscalationRecipients(reminderCase.docNr),
        '✅ **Invoice paid**',
        `Invoice ${reminderCase.docNr} (${reminderCase.client}) has been paid. No further contact is needed.`,
      );
    }
  }

  for (const invoice of overdue) {
    const overdueDays = differenceInCalendarDays(today, invoice.dueDate);
    const validPhone = normalizePhone(invoice.phoneRaw);
    let reminderCase = casesByDocNr.get(invoice.docNr);

    if (!reminderCase) {
      reminderCase = newReminderCase(invoice, validPhone);
      casesByDocNr.set(invoice.docNr, reminderCase);
      if (!dryRun) markChanged(reminderCase);
    } else if (refreshReminderCase(reminderCase, invoice, validPhone) && !dryRun) {
      markChanged(reminderCase);
    }

    const sharedContext = {
      invoice,
      reminderCase,
      overdueDays,
      validPhone,
      today,
      todayStr,
      nowStr,
      dryRun,
      plannedActions,
      historyRows,
      markChanged,
    };
    const operationalAction = decideOperationalAction(
      invoice,
      reminderCase,
      today,
      validPhone,
    );
    await executeOperationalAction({
      ...sharedContext,
      action: operationalAction,
    });

    const managementAction = decideManagementAction(
      invoice,
      reminderCase,
      today,
      validPhone,
    );
    await executeManagementAction({
      ...sharedContext,
      action: managementAction,
    });
  }

  if (dryRun) {
    console.log('\n=== DRY-RUN: planned actions ===');
    for (const line of plannedActions) console.log(line);
    console.log(
      `\nTotal: ${plannedActions.length} entries. Nothing was sent or written.`,
    );
    return;
  }

  const changedCases = [...changedCasesByDocNr.values()];
  await saveCases(sheets, changedCases);
  await appendHistory(sheets, historyRows);
  log(
    `Done. Changes: ${changedCases.length} cases, ${
      historyRows.length
    } history entries.`,
  );
}
