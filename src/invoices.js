import {
  normalizeCaseStatus,
  STATUS,
  TERMINAL_CASE_STATUSES,
} from './config.js';

/**
 * Within one run, each document number is processed only once.
 * The first valid row wins; duplicates are returned so a warning can be shown.
 */
export function deduplicateInvoices(invoices) {
  const uniqueByDocNr = new Map();
  const duplicateDocNumbers = new Set();

  for (const invoice of invoices) {
    if (uniqueByDocNr.has(invoice.docNr)) {
      duplicateDocNumbers.add(invoice.docNr);
      continue;
    }
    uniqueByDocNr.set(invoice.docNr, invoice);
  }

  return {
    invoices: [...uniqueByDocNr.values()],
    duplicateDocNumbers: [...duplicateDocNumbers],
  };
}

/**
 * A document missing from the source means "paid", except for manually closed cases.
 * sourceDocNumbers also includes rows with a zero amount or an invalid date.
 */
export function shouldMarkPaid(reminderCase, sourceDocNumbers) {
  if (reminderCase.status === STATUS.PAID) return false;
  if (sourceDocNumbers.has(reminderCase.docNr)) return false;

  const caseStatus = normalizeCaseStatus(reminderCase.caseStatus);
  return !TERMINAL_CASE_STATUSES.includes(caseStatus);
}
