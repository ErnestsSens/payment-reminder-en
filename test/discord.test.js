import test from 'node:test';
import assert from 'node:assert/strict';
import { sendDiscordMessage } from '../src/discord.js';

async function withDiscordEnvironment(fetchMock, callback) {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.DISCORD_BOT_URL;
  const originalKey = process.env.DISCORD_BOT_KEY;
  const originalMock = process.env.DISCORD_MOCK_MESSAGES;

  globalThis.fetch = fetchMock;
  process.env.DISCORD_BOT_URL = 'https://discord-bot.example';
  process.env.DISCORD_BOT_KEY = 'test-key';
  process.env.DISCORD_MOCK_MESSAGES = 'false';

  try {
    return await callback();
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.DISCORD_BOT_URL;
    else process.env.DISCORD_BOT_URL = originalUrl;
    if (originalKey === undefined) delete process.env.DISCORD_BOT_KEY;
    else process.env.DISCORD_BOT_KEY = originalKey;
    if (originalMock === undefined) delete process.env.DISCORD_MOCK_MESSAGES;
    else process.env.DISCORD_MOCK_MESSAGES = originalMock;
  }
}

test('Discord error response includes HTTP status and bot message', async () => {
  const result = await withDiscordEnvironment(
    async () =>
      new Response(
        JSON.stringify({ status: 'error', message: 'Unauthorized' }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    () => sendDiscordMessage('123456789012345678', 'Title', 'Text'),
  );

  assert.deepEqual(result, {
    status: 'error',
    message: 'Unauthorized',
    httpStatus: 401,
  });
});

test('invalid Discord bot response is reported without JSON parse crash', async () => {
  const result = await withDiscordEnvironment(
    async () => new Response('upstream unavailable', { status: 502 }),
    () => sendDiscordMessage('123456789012345678', 'Title', 'Text'),
  );

  assert.deepEqual(result, {
    status: 'error',
    message: 'Bot returned invalid JSON: upstream unavailable',
    httpStatus: 502,
  });
});
