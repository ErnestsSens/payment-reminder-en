import { google } from 'googleapis';
import { parse, isValid } from 'date-fns';
import {
  SHEETS,
  INVOICE_DATA_RANGE,
  CASE_STATUS,
} from './config.js';

const REMINDER_HEADERS = [
  'Doc No', // A
  'Client', // B
  'Phone', // C
  'Amount', // D
  'Due Date', // E
  'Status', // F (technical, managed by the program)
  'SMS1 Date', // G
  'SMS2 Date', // H
  'SMS3 Date', // I
  'Team Discord Date', // J
  'Case Status', // K (dropdown, filled in by staff)
  'Call Result', // L
  'Notes', // M
  'Last Checked', // N
  'Review Date', // O
  'Management Discord Date', // P
];

const HISTORY_HEADERS = [
  'Date',
  'Doc No',
  'Action',
  'Phone',
  'Result',
  'Next Check',
];

export function getSheetsClient() {
  if (!process.env.GOOGLE_CREDENTIALS) {
    throw new Error('GOOGLE_CREDENTIALS is not configured');
  }
  if (!process.env.SPREADSHEET_ID) {
    throw new Error('SPREADSHEET_ID is not configured');
  }
  const auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

/** "2026-07-05" or "05.07.2026" → Date (00:00), otherwise null. */
export function parseSheetDate(value) {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  for (const fmt of ['yyyy-MM-dd', 'dd.MM.yyyy', 'd.M.yyyy']) {
    const parsed = parse(trimmed, fmt, new Date());
    if (isValid(parsed)) return parsed;
  }
  return null;
}

/** "1,425.00", "5 753.90", "963,00" → number; otherwise null. */
export function parseAmount(value) {
  if (typeof value === 'number') return value;
  if (!value || typeof value !== 'string') return null;
  let s = value.replace(/[\s €]/g, '');
  if (s.includes(',') && s.includes('.')) {
    // "1,425.00" — the comma is a thousands separator
    s = s.replace(/,/g, '');
  } else if (s.includes(',')) {
    // "963,00" — the comma is the decimal separator
    s = s.replace(',', '.');
  }
  const n = parseFloat(s);
  return Number.isNaN(n) ? null : n;
}

/**
 * Reads overdue invoices from the Invoices sheet.
 * Columns: B transaction date, C client, D document no., G remaining amount,
 * H actual payment due date, J phone.
 */
export async function readInvoiceSnapshot(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: INVOICE_DATA_RANGE,
  });
  const rows = res.data.values ?? [];
  const invoices = [];
  const sourceDocNumbers = new Set();
  for (const row of rows) {
    const docNr = (row[3] ?? '').trim();
    if (!docNr) continue;
    sourceDocNumbers.add(docNr);
    const dueDate = parseSheetDate(row[7]);
    const amount = parseAmount(row[6]);
    if (!dueDate || amount === null || amount <= 0) continue;
    invoices.push({
      client: (row[2] ?? '').trim(),
      docNr,
      amount,
      dueDateRaw: (row[7] ?? '').trim(),
      dueDate,
      phoneRaw: (row[9] ?? '').trim(),
    });
  }
  return { invoices, sourceDocNumbers };
}

/** Creates the Reminders / History sheets with headers if they don't exist yet. */
export async function ensureAuxSheets(sheets) {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: process.env.SPREADSHEET_ID,
    fields: 'sheets.properties(sheetId,title)',
  });
  const existing = meta.data.sheets.map((s) => s.properties.title);
  const definitions = [
    { title: SHEETS.reminders, headers: REMINDER_HEADERS },
    { title: SHEETS.history, headers: HISTORY_HEADERS },
  ];
  const toCreate = definitions.filter((s) => !existing.includes(s.title));

  if (toCreate.length) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: process.env.SPREADSHEET_ID,
      requestBody: {
        requests: toCreate.map((s) => ({
          addSheet: { properties: { title: s.title } },
        })),
      },
    });
  }

  // Also refreshes existing headers so that schema additions reach the sheet.
  for (const s of definitions) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: `${s.title}!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [s.headers] },
    });
    if (toCreate.some((created) => created.title === s.title)) {
      console.log(`Created sheet "${s.title}"`);
    }
  }

  const refreshedMeta = await sheets.spreadsheets.get({
    spreadsheetId: process.env.SPREADSHEET_ID,
    fields: 'sheets.properties(sheetId,title)',
  });
  const reminderSheet = refreshedMeta.data.sheets.find(
    (s) => s.properties.title === SHEETS.reminders,
  );
  if (!reminderSheet) return;

  // Column K: only predefined case statuses. Column O: a valid date.
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: process.env.SPREADSHEET_ID,
    requestBody: {
      requests: [
        {
          setDataValidation: {
            range: {
              sheetId: reminderSheet.properties.sheetId,
              startRowIndex: 1,
              startColumnIndex: 10,
              endColumnIndex: 11,
            },
            rule: {
              condition: {
                type: 'ONE_OF_LIST',
                values: Object.values(CASE_STATUS).map((value) => ({
                  userEnteredValue: value,
                })),
              },
              strict: true,
              showCustomUi: true,
            },
          },
        },
        {
          setDataValidation: {
            range: {
              sheetId: reminderSheet.properties.sheetId,
              startRowIndex: 1,
              startColumnIndex: 14,
              endColumnIndex: 15,
            },
            rule: {
              condition: { type: 'DATE_IS_VALID' },
              strict: true,
              showCustomUi: true,
            },
          },
        },
      ],
    },
  });
}

function rowToCase(row, rowNumber) {
  return {
    rowNumber, // actual row number in the sheet (1-based)
    docNr: (row[0] ?? '').trim(),
    client: row[1] ?? '',
    phone: row[2] ?? '',
    amount: row[3] ?? '',
    dueDate: row[4] ?? '',
    status: (row[5] ?? '').trim(),
    sms1Date: (row[6] ?? '').trim(),
    sms2Date: (row[7] ?? '').trim(),
    sms3Date: (row[8] ?? '').trim(),
    discordDate: (row[9] ?? '').trim(),
    caseStatus: (row[10] ?? '').trim(),
    callResult: row[11] ?? '',
    notes: row[12] ?? '',
    lastChecked: row[13] ?? '',
    nextReviewDate: (row[14] ?? '').trim(),
    managementDiscordDate: (row[15] ?? '').trim(),
  };
}

function caseToRow(reminderCase) {
  return [
    reminderCase.docNr,
    reminderCase.client,
    reminderCase.phone,
    reminderCase.amount,
    reminderCase.dueDate,
    reminderCase.status,
    reminderCase.sms1Date,
    reminderCase.sms2Date,
    reminderCase.sms3Date,
    reminderCase.discordDate,
    reminderCase.caseStatus,
    reminderCase.callResult,
    reminderCase.notes,
    reminderCase.lastChecked,
    reminderCase.nextReviewDate,
    reminderCase.managementDiscordDate,
  ];
}

/** Reads all cases from the Reminders sheet. If the sheet doesn't exist — empty list. */
export async function readCases(sheets) {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: `${SHEETS.reminders}!A2:P`,
    });
    const rows = res.data.values ?? [];
    return rows
      .map((row, i) => rowToCase(row, i + 2))
      .filter((c) => c.docNr);
  } catch (e) {
    if (e.code === 400) return []; // sheet doesn't exist yet
    throw e;
  }
}

/** Saves changed cases (update for existing rows, append for new ones). */
export async function saveCases(sheets, changedCases) {
  const updates = changedCases.filter((c) => c.rowNumber);
  const appends = changedCases.filter((c) => !c.rowNumber);

  if (updates.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: process.env.SPREADSHEET_ID,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data: updates.map((c) => ({
          range: `${SHEETS.reminders}!A${c.rowNumber}:P${c.rowNumber}`,
          values: [caseToRow(c)],
        })),
      },
    });
  }
  if (appends.length) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: `${SHEETS.reminders}!A2:P`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: appends.map(caseToRow) },
    });
  }
}

/** Appends rows to the History log. */
export async function appendHistory(sheets, historyRows) {
  if (!historyRows.length) return;
  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: `${SHEETS.history}!A2:F`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: historyRows },
  });
}
