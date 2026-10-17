import test from 'node:test';
import assert from 'node:assert/strict';
import { CASE_STATUS, STATUS } from '../src/config.js';
import {
  deduplicateInvoices,
  shouldMarkPaid,
} from '../src/invoices.js';

test('duplicate document numbers are processed only once', () => {
  const first = { docNr: 'GLJ26_001', amount: 10 };
  const second = { docNr: 'GLJ26_001', amount: 20 };
  const unique = { docNr: 'GLM26_002', amount: 30 };

  const result = deduplicateInvoices([first, second, unique]);

  assert.deepEqual(result.invoices, [first, unique]);
  assert.deepEqual(result.duplicateDocNumbers, ['GLJ26_001']);
});

test('case is not marked paid while document still exists in source', () => {
  const reminderCase = {
    docNr: 'GLJ26_001',
    status: STATUS.REMINDER_1_SENT,
    caseStatus: '',
  };
  assert.equal(
    shouldMarkPaid(reminderCase, new Set(['GLJ26_001'])),
    false,
  );
});

test('missing active document is marked paid', () => {
  const reminderCase = {
    docNr: 'GLJ26_001',
    status: STATUS.REMINDER_1_SENT,
    caseStatus: '',
  };
  assert.equal(shouldMarkPaid(reminderCase, new Set()), true);
});

test('written off or cancelled case is not changed to paid', () => {
  for (const caseStatus of [
    CASE_STATUS.WRITTEN_OFF,
    CASE_STATUS.CANCELLED,
  ]) {
    assert.equal(
      shouldMarkPaid(
        {
          docNr: 'GLJ26_001',
          status: STATUS.CALL_REQUIRED,
          caseStatus,
        },
        new Set(),
      ),
      false,
    );
  }
});
