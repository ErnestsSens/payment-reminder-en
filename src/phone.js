import {
  parsePhoneNumberWithError,
  isValidPhoneNumber,
} from 'libphonenumber-js';

/**
 * Normalizes a phone number to E.164 (e.g. 29376262 → +37129376262).
 * Numbers without a country code are treated as Latvian (LV) by default.
 * Returns null if the number is not valid.
 */
export function normalizePhone(phoneNumber, defaultCountry = 'LV') {
  if (!phoneNumber || typeof phoneNumber !== 'string') return null;
  const trimmed = phoneNumber.trim();
  if (!trimmed) return null;
  try {
    if (!isValidPhoneNumber(trimmed, defaultCountry)) return null;
    const parsed = parsePhoneNumberWithError(trimmed, defaultCountry);
    return parsed?.format('E.164') ?? null;
  } catch {
    return null;
  }
}
