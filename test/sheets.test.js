import test from 'node:test';
import assert from 'node:assert/strict';
import { CASE_STATUS } from '../src/config.js';
import {
  ensureAuxSheets,
  readCases,
  readInvoiceSnapshot,
} from '../src/sheets.js';

test('existing reminder sheet receives new headers and validation rules', async () => {
  process.env.SPREADSHEET_ID = 'test-sheet';
  const valueUpdates = [];
  const batchUpdates = [];
  const metadata = {
    data: {
      sheets: [
        { properties: { sheetId: 11, title: 'Reminders' } },
        { properties: { sheetId: 12, title: 'History' } },
      ],
    },
  };
  const sheets = {
    spreadsheets: {
      get: async () => metadata,
      batchUpdate: async (request) => {
        batchUpdates.push(request);
        return {};
      },
      values: {
        update: async (request) => {
          valueUpdates.push(request);
          return {};
        },
      },
    },
  };

  await ensureAuxSheets(sheets);

  const reminderHeader = valueUpdates.find(
    (request) => request.range === 'Reminders!A1',
  );
  assert.equal(reminderHeader.requestBody.values[0][9], 'Team Discord Date');
  assert.equal(reminderHeader.requestBody.values[0][10], 'Case Status');
  assert.equal(reminderHeader.requestBody.values[0][14], 'Review Date');
  assert.equal(reminderHeader.requestBody.values[0][15], 'Management Discord Date');

  const validationRequests = batchUpdates.at(-1).requestBody.requests;
  const statusValidation = validationRequests[0].setDataValidation;
  const reviewDateValidation = validationRequests[1].setDataValidation;
  assert.equal(statusValidation.range.startColumnIndex, 10);
  assert.equal(statusValidation.rule.strict, true);
  assert.deepEqual(
    statusValidation.rule.condition.values.map((item) => item.userEnteredValue),
    Object.values(CASE_STATUS),
  );
  assert.equal(reviewDateValidation.range.startColumnIndex, 14);
  assert.equal(reviewDateValidation.rule.condition.type, 'DATE_IS_VALID');
});

test('case reader supports status and new review date column', async () => {
  process.env.SPREADSHEET_ID = 'test-sheet';
  const row = [
    'GLJ_TEST_001',
    'Test client',
    '+37120000000',
    '10.00',
    '2026-08-10',
    'CALL_REQUIRED',
    '2026-08-11',
    '2026-08-13',
    '2026-08-16',
    '2026-08-20',
    CASE_STATUS.DISPUTED,
    '',
    '',
    '2026-08-20 10:00',
    '2026-08-30',
    '2026-08-27',
  ];
  const sheets = {
    spreadsheets: {
      values: {
        get: async () => ({ data: { values: [row] } }),
      },
    },
  };

  const cases = await readCases(sheets);

  assert.equal(cases[0].caseStatus, CASE_STATUS.DISPUTED);
  assert.equal(cases[0].nextReviewDate, '2026-08-30');
  assert.equal(cases[0].managementDiscordDate, '2026-08-27');
});

test('invoice snapshot keeps all source document numbers for paid detection', async () => {
  process.env.SPREADSHEET_ID = 'test-sheet';
  const rows = [
    ['', '', 'Valid', 'GLJ26_001', '', '', '10.00', '10.08.2026', '', '20000000'],
    ['', '', 'Zero amount', 'GLJ26_002', '', '', '0', '10.08.2026', '', ''],
    ['', '', 'Invalid date', 'GLJ26_003', '', '', '15', 'no date', '', ''],
  ];
  const sheets = {
    spreadsheets: {
      values: {
        get: async () => ({ data: { values: rows } }),
      },
    },
  };

  const snapshot = await readInvoiceSnapshot(sheets);

  assert.equal(snapshot.invoices.length, 1);
  assert.deepEqual(
    [...snapshot.sourceDocNumbers],
    ['GLJ26_001', 'GLJ26_002', 'GLJ26_003'],
  );
});
