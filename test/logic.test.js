import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CASE_STATUS,
  COMPANIES,
  FINANCE_DISCORD_IDS,
  SCHEDULE,
  STATUS,
} from '../src/config.js';
import {
  decideManagementAction,
  decideOperationalAction,
  teamEscalationRecipients,
} from '../src/logic.js';

const dueDate = new Date(2026, 7, 10);
const invoice = { dueDate };

function date(day) {
  return new Date(2026, 7, day);
}

function reminderCase(overrides = {}) {
  return {
    status: STATUS.REMINDER_3_SENT,
    sms1Date: '2026-08-11',
    sms2Date: '2026-08-13',
    sms3Date: '2026-08-16',
    discordDate: '',
    managementDiscordDate: '',
    caseStatus: '',
    nextReviewDate: '',
    ...overrides,
  };
}

test('invoice prefix selects only the matching park manager and finance', () => {
  const originalJugla = [...COMPANIES.GLJ.discordIds];
  const originalSampeteris = [...COMPANIES.GLS.discordIds];
  const originalFinance = [...FINANCE_DISCORD_IDS];
  try {
    COMPANIES.GLJ.discordIds.splice(0, Infinity, 'jugla');
    COMPANIES.GLS.discordIds.splice(0, Infinity, 'sampeteris');
    FINANCE_DISCORD_IDS.splice(0, Infinity, 'finance');

    assert.deepEqual(
      teamEscalationRecipients('GLJ26_001'),
      ['jugla', 'finance'],
    );
    assert.deepEqual(
      teamEscalationRecipients('GLS26_001'),
      ['sampeteris', 'finance'],
    );
  } finally {
    COMPANIES.GLJ.discordIds.splice(0, Infinity, ...originalJugla);
    COMPANIES.GLS.discordIds.splice(0, Infinity, ...originalSampeteris);
    FINANCE_DISCORD_IDS.splice(0, Infinity, ...originalFinance);
  }
});

test('SMS sequence starts with SMS1', () => {
  const action = decideOperationalAction(
    invoice,
    reminderCase({
      status: STATUS.NEW,
      sms1Date: '',
      sms2Date: '',
      sms3Date: '',
    }),
    date(11),
    true,
  );
  assert.deepEqual(action, { type: 'SEND_SMS', step: 1 });
});

test('team escalation is sent once after SMS3', () => {
  const action = decideOperationalAction(
    invoice,
    reminderCase(),
    date(16 + SCHEDULE.teamEscalationAfterSms3Days),
    true,
  );
  assert.equal(action.type, 'ESCALATE_TEAM');
});

test('missing phone escalates to team immediately', () => {
  const action = decideOperationalAction(
    invoice,
    reminderCase({
      status: STATUS.NEW,
      sms1Date: '',
      sms2Date: '',
      sms3Date: '',
    }),
    date(11),
    false,
  );
  assert.equal(action.type, 'ESCALATE_TEAM');
  assert.equal(action.noPhone, true);
});

test('new business status hands the case to collection team', () => {
  const action = decideOperationalAction(
    invoice,
    reminderCase({
      status: STATUS.REMINDER_1_SENT,
      caseStatus: CASE_STATUS.PAYMENT_PROMISED,
    }),
    date(14),
    true,
  );
  assert.equal(action.type, 'ESCALATE_TEAM');
});

test('written off invoice stops operational actions', () => {
  const action = decideOperationalAction(
    invoice,
    reminderCase({ caseStatus: CASE_STATUS.WRITTEN_OFF }),
    date(30),
    true,
  );
  assert.equal(action.type, 'NONE');
});

test('management notification is not sent before overdue day 10', () => {
  const action = decideManagementAction(
    invoice,
    reminderCase({ status: STATUS.NEW }),
    date(19),
    true,
  );
  assert.equal(action.type, 'NONE');
});

test('management notification is guaranteed on overdue day 10 regardless of SMS status', () => {
  for (const status of [STATUS.NEW, STATUS.REMINDER_1_SENT, STATUS.CALL_REQUIRED]) {
    const action = decideManagementAction(
      invoice,
      reminderCase({ status }),
      date(20),
      true,
    );
    assert.equal(action.type, 'NOTIFY_MANAGEMENT');
  }
});

test('management notification includes team fallback if team was not reached', () => {
  const action = decideManagementAction(
    invoice,
    reminderCase(),
    date(20),
    true,
  );
  assert.equal(action.type, 'NOTIFY_MANAGEMENT');
  assert.equal(action.includeTeamFallback, true);
});

test('management notification excludes fallback if team was already reached', () => {
  const action = decideManagementAction(
    invoice,
    reminderCase({ discordDate: '2026-08-17' }),
    date(20),
    true,
  );
  assert.equal(action.includeTeamFallback, false);
});

test('management notification repeats every 7 days', () => {
  const activeCase = reminderCase({
    status: STATUS.CALL_REQUIRED,
    discordDate: '2026-08-17',
    managementDiscordDate: '2026-08-20',
  });
  assert.equal(
    decideManagementAction(invoice, activeCase, date(26), true).type,
    'NONE',
  );
  assert.equal(
    decideManagementAction(invoice, activeCase, date(27), true).type,
    'NOTIFY_MANAGEMENT',
  );
});

test('payment promised pauses actions until review date', () => {
  const activeCase = reminderCase({
    status: STATUS.CALL_REQUIRED,
    discordDate: '2026-08-17',
    managementDiscordDate: '2026-08-20',
    caseStatus: CASE_STATUS.PAYMENT_PROMISED,
    nextReviewDate: '2026-08-28',
  });
  assert.equal(
    decideOperationalAction(invoice, activeCase, date(27), true).type,
    'NONE',
  );
  assert.equal(
    decideManagementAction(invoice, activeCase, date(27), true).type,
    'NONE',
  );
});

test('review date triggers management notification and clears date after success', () => {
  const action = decideManagementAction(
    invoice,
    reminderCase({
      status: STATUS.CALL_REQUIRED,
      discordDate: '2026-08-17',
      managementDiscordDate: '2026-08-26',
      caseStatus: CASE_STATUS.PAYMENT_PROMISED,
      nextReviewDate: '2026-08-27',
    }),
    date(27),
    true,
  );
  assert.equal(action.type, 'NOTIFY_MANAGEMENT');
  assert.equal(action.reviewDue, true);
  assert.equal(action.clearReviewDate, true);
});

test('missing required review date does not stop weekly notifications', () => {
  const action = decideManagementAction(
    invoice,
    reminderCase({
      status: STATUS.CALL_REQUIRED,
      discordDate: '2026-08-17',
      managementDiscordDate: '2026-08-20',
      caseStatus: CASE_STATUS.IN_COLLECTION,
    }),
    date(27),
    true,
  );
  assert.equal(action.type, 'NOTIFY_MANAGEMENT');
  assert.equal(action.missingReviewDate, true);
});

test('terminal business status stops management notifications', () => {
  const action = decideManagementAction(
    invoice,
    reminderCase({ caseStatus: CASE_STATUS.CANCELLED }),
    date(30),
    true,
  );
  assert.equal(action.type, 'NONE');
});
