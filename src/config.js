import 'dotenv/config';

/**
 * Reminder schedule (in days).
 * State machine: the next step only happens after the previous step + interval,
 * so even long-overdue invoices only get SMS1 on the first run.
 */
export const SCHEDULE = {
  // SMS1 — when the invoice is overdue by at least this many days
  firstSmsAfterDueDays: 1, // due 10 August; due + 1 day = 11 August
  // SMS2 — days after SMS1
  secondSmsAfterDays: 2, // SMS1 + 2 days = 13 August
  // SMS3 — days after SMS2
  thirdSmsAfterDays: 3, // SMS2 + 3 days = 16 August
  // One-time operational escalation to the collection team — days after SMS3
  teamEscalationAfterSms3Days: 2, // SMS3 + 2 days = 18 August
  // First management notification — days overdue since the invoice due date
  managerNotificationAfterDueDays: 10,
  // Repeated management notification while the case is unresolved
  managerRepeatAfterDays: 7,
};

export const SMS_SENDER = 'GUNSnLASERS';

/** Parses a comma-separated list of Discord IDs from .env. */
export function parseDiscordIds(value) {
  return [...new Set(
    (value ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
  )];
}

/**
 * Company lookup by document number prefix (e.g. GLJ26_0955 → GLJ).
 * discordIds — Discord IDs of that park's managers, from .env.
 * Park names (Jugla, Mežaparks, Šampēteris, Galerija Centrs) are location names.
 * The GLŠ prefix contains a Latvian letter, so GLS is accepted as an alias.
 */
export const COMPANIES = {
  GLJ: {
    name: 'Jugla',
    responsibleName: 'Jugla park manager',
    discordIds: parseDiscordIds(process.env.JUGLA_MANAGER_DISCORD_IDS),
  },
  GLM: {
    name: 'Mežaparks',
    responsibleName: 'Mežaparks park manager',
    discordIds: parseDiscordIds(process.env.MEZAPARKS_MANAGER_DISCORD_IDS),
  },
  GLŠ: {
    name: 'Šampēteris',
    responsibleName: 'Šampēteris park manager',
    discordIds: parseDiscordIds(process.env.SAMPETERIS_MANAGER_DISCORD_IDS),
  },
  GLS: {
    name: 'Šampēteris',
    responsibleName: 'Šampēteris park manager',
    discordIds: parseDiscordIds(process.env.SAMPETERIS_MANAGER_DISCORD_IDS),
  },
  GLG: {
    name: 'Galerija Centrs',
    responsibleName: 'Galerija Centrs park manager',
    discordIds: parseDiscordIds(
      process.env.GALERIJA_CENTRS_MANAGER_DISCORD_IDS,
    ),
  },
  GNL: {
    name: 'GNL (standard)',
    responsibleName: 'GNL person in charge',
    discordIds: parseDiscordIds(process.env.GNL_MANAGER_DISCORD_IDS),
  },
};

/** Finance contacts — receive ALL escalation and payment notifications. */
export const FINANCE_DISCORD_IDS = parseDiscordIds(
  process.env.FINANCE_DISCORD_IDS,
);

/**
 * Management notification recipients — receive the overdue-day-10 notification
 * and its repeats. Use the manager's personal or the management channel Discord ID.
 */
export const MANAGEMENT_DISCORD_IDS = parseDiscordIds(
  process.env.MANAGEMENT_DISCORD_IDS,
);

/** Google Sheets tab names. */
export const SHEETS = {
  invoices: 'Invoices', // source data (outstanding invoices, maintained by accounting)
  reminders: 'Reminders', // one row per case, created by the program
  history: 'History', // action log, created by the program
};

/** Invoices: data starts on row 5, columns A–J. */
export const INVOICE_DATA_RANGE = `${SHEETS.invoices}!A5:J`;

/** Case status chosen by a colleague (Google Sheets dropdown). */
export const CASE_STATUS = {
  CONTACT_REQUIRED: 'Contact client',
  PAYMENT_PROMISED: 'Payment promised',
  IN_COLLECTION: 'In collection',
  DISPUTED: 'Disputed',
  PAYMENT_PLAN: 'Payment plan agreed',
  WRITTEN_OFF: 'Written off',
  CANCELLED: 'Cancelled',
};

/** These statuses require a "Review Date". */
export const CASE_STATUSES_REQUIRING_REVIEW = [
  CASE_STATUS.PAYMENT_PROMISED,
  CASE_STATUS.IN_COLLECTION,
  CASE_STATUS.DISPUTED,
  CASE_STATUS.PAYMENT_PLAN,
];

/** These are final statuses — no further SMS or Discord notifications are sent. */
export const TERMINAL_CASE_STATUSES = [
  CASE_STATUS.WRITTEN_OFF,
  CASE_STATUS.CANCELLED,
];

const KNOWN_CASE_STATUSES = new Map(
  Object.values(CASE_STATUS).map((status) => [
    status.toLocaleLowerCase('en'),
    status,
  ]),
);

/** Normalizes a value to one of the case statuses allowed by the dropdown. */
export function normalizeCaseStatus(value) {
  const normalized = (value ?? '').trim().toLocaleLowerCase('en');
  if (!normalized) return '';
  return KNOWN_CASE_STATUSES.get(normalized) ?? '';
}

export const STATUS = {
  NEW: 'NEW',
  REMINDER_1_SENT: 'REMINDER_1_SENT',
  REMINDER_2_SENT: 'REMINDER_2_SENT',
  REMINDER_3_SENT: 'REMINDER_3_SENT',
  CALL_REQUIRED: 'CALL_REQUIRED',
  PAID: 'PAID',
};
