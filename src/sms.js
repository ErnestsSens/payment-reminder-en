import { SMS_SENDER } from './config.js';

/**
 * Sends one SMS via Text2Reach (the same JSON-RPC API used by
 * gunsnlasers-keystone `sendActualMessages`).
 * Returns { ok, result?, error? } — a negative result means a Text2Reach error.
 */
export async function sendSMS(phone, text, options = {}) {
  if (process.env.SMS_MOCK === 'true') {
    console.log(`[SMS MOCK] → ${phone}: ${text}`);
    return { ok: true, result: 0, mocked: true };
  }

  if (!process.env.TEXT2REACH_KEY) {
    console.warn('sendSMS: TEXT2REACH_KEY is not configured');
    return { ok: false, error: 'No SMS key configured' };
  }

  const apiUrl = `https://api.text2reach.com/sms/?api_key=${process.env.TEXT2REACH_KEY}`;
  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: options.id ?? `${Date.now()}`,
        method: 'send',
        params: [
          options.sender ?? SMS_SENDER,
          phone,
          text,
          'txt',
          options.utf8 ?? false,
        ],
      }),
    });
    const data = await response.json();
    const result = data?.result;
    if (typeof result === 'number' && result < 0) {
      return { ok: false, result, error: `Text2Reach error ${result}` };
    }
    return {
      ok: true,
      result: typeof result === 'number' ? result : undefined,
    };
  } catch (e) {
    console.error('sendSMS failed:', e);
    return { ok: false, error: String(e) };
  }
}
