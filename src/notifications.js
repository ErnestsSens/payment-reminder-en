import { normalizeCaseStatus } from './config.js';
import { sendDiscordToMany } from './discord.js';
import {
  companyForDocNr,
  managementRecipients,
  smsSentCount,
  teamEscalationRecipients,
} from './logic.js';
import { parseSheetDate } from './sheets.js';

function lastAction(reminderCase) {
  const actions = [
    { label: 'SMS1 sent', date: reminderCase.sms1Date },
    { label: 'SMS2 sent', date: reminderCase.sms2Date },
    { label: 'SMS3 sent', date: reminderCase.sms3Date },
    {
      label: 'Team escalation sent',
      date: reminderCase.discordDate,
    },
    {
      label: 'Management notification sent',
      date: reminderCase.managementDiscordDate,
    },
  ]
    .map((action) => ({
      ...action,
      parsedDate: parseSheetDate((action.date ?? '').slice(0, 10)),
    }))
    .filter((action) => action.parsedDate)
    .sort((a, b) => b.parsedDate.getTime() - a.parsedDate.getTime());

  if (!actions.length) return 'No recorded actions';
  return `${actions[0].label} ${actions[0].date}`;
}

export function buildTeamEscalationMessage(
  reminderCase,
  overdueDays,
  noPhone,
) {
  const company = companyForDocNr(reminderCase.docNr);
  const lines = [
    `Invoice: ${reminderCase.docNr} (${company.name})`,
    `Client: ${reminderCase.client}`,
    `Amount: ${reminderCase.amount} €`,
    `Overdue: ${overdueDays} days`,
    `SMS sent: ${smsSentCount(reminderCase)}`,
    `Phone: ${reminderCase.phone || 'NO VALID NUMBER'}`,
  ];
  if (noPhone) {
    lines.push('⚠️ SMS cannot be sent — no valid phone number!');
  }
  return {
    title: '📞 **The team needs to contact the client about an unpaid invoice**',
    text: lines.join('\n'),
  };
}

export function buildManagementMessage(reminderCase, overdueDays, action) {
  const company = companyForDocNr(reminderCase.docNr);
  const normalizedCaseStatus = normalizeCaseStatus(reminderCase.caseStatus);
  const displayedCaseStatus =
    normalizedCaseStatus || reminderCase.caseStatus || 'Not specified';
  const lines = [
    `Client: ${reminderCase.client}`,
    `Invoice: ${reminderCase.docNr} (${company.name})`,
    `Amount: ${reminderCase.amount} €`,
    `Responsible: ${company.responsibleName}`,
    `Last action: ${lastAction(reminderCase)}`,
    `Case status: ${displayedCaseStatus}`,
    `Call result: ${reminderCase.callResult || 'Not specified'}`,
    `Review date: ${reminderCase.nextReviewDate || 'Not specified'}`,
    `Phone: ${reminderCase.phone || 'NO VALID NUMBER'}`,
    `SMS sent: ${smsSentCount(reminderCase)}`,
  ];
  if (reminderCase.notes) lines.push(`Notes: ${reminderCase.notes}`);
  if (action.noPhone) {
    lines.push('⚠️ SMS cannot be sent — no valid phone number!');
  }
  if (action.missingReviewDate) {
    lines.push('⚠️ No review date has been set for this case status.');
  }
  if (action.invalidCaseStatus) {
    lines.push('⚠️ Case status not recognized. Choose a value from the dropdown.');
  }
  if (!normalizedCaseStatus) {
    lines.push('The next action needs to be specified.');
  }
  return {
    title: `🔴 **Invoice overdue ${overdueDays} days**`,
    text: lines.join('\n'),
  };
}

export async function sendTeamEscalation(
  reminderCase,
  overdueDays,
  action,
  send = sendDiscordToMany,
) {
  const recipients = teamEscalationRecipients(reminderCase.docNr);
  if (!recipients.length) return { ok: false, noRecipients: true };

  const { title, text } = buildTeamEscalationMessage(
    reminderCase,
    overdueDays,
    action.noPhone,
  );
  return {
    ok: await send(recipients, title, text),
    noRecipients: false,
  };
}

export function managementRecipientGroups(
  managerIds,
  allTeamIds,
  includeTeamFallback,
) {
  const uniqueManagerIds = [...new Set(managerIds)];
  const uniqueTeamIds = [...new Set(allTeamIds)];
  return {
    managerIds: uniqueManagerIds,
    teamFallbackIds: includeTeamFallback
      ? uniqueTeamIds.filter((id) => !uniqueManagerIds.includes(id))
      : [],
    teamIdsReachedViaManagement: includeTeamFallback
      ? uniqueTeamIds.filter((id) => uniqueManagerIds.includes(id))
      : [],
  };
}

export async function sendManagementNotification(
  reminderCase,
  overdueDays,
  action,
  send = sendDiscordToMany,
) {
  const {
    managerIds,
    teamFallbackIds,
    teamIdsReachedViaManagement,
  } = managementRecipientGroups(
    managementRecipients(),
    teamEscalationRecipients(reminderCase.docNr),
    action.includeTeamFallback,
  );
  const { title, text } = buildManagementMessage(
    reminderCase,
    overdueDays,
    action,
  );

  const managerOk = managerIds.length
    ? await send(managerIds, title, text)
    : false;
  const teamFallbackOk = teamFallbackIds.length
    ? await send(teamFallbackIds, title, text)
    : false;

  return {
    managerOk,
    managerConfigured: managerIds.length > 0,
    teamFallbackOk,
    teamReached:
      teamFallbackOk ||
      (managerOk && teamIdsReachedViaManagement.length > 0),
  };
}
