/**
 * Sends a message via the GNL Discord bot (the same mechanism used by
 * gunsnlasers-keystone `sendDiscordMessage`).
 */
export async function sendDiscordMessage(discordid, title, text) {
  const message = `${title}\n${text}`;

  if (process.env.DISCORD_MOCK_MESSAGES === 'true') {
    console.log(`[DISCORD MOCK] → ${discordid}:\n${message}`);
    return { status: 'success', message: 'Discord message sent (mocked)' };
  }

  if (!process.env.DISCORD_BOT_URL || !process.env.DISCORD_BOT_KEY) {
    throw new Error('DISCORD_BOT_URL or DISCORD_BOT_KEY is not configured');
  }

  const response = await fetch(process.env.DISCORD_BOT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.DISCORD_BOT_KEY}`,
    },
    body: JSON.stringify({ discordid, message }),
  });

  const responseText = await response.text();
  let responseBody;
  try {
    responseBody = responseText ? JSON.parse(responseText) : {};
  } catch {
    return {
      status: 'error',
      message: responseText
        ? `Bot returned invalid JSON: ${responseText.slice(0, 300)}`
        : 'Bot returned an empty response',
      httpStatus: response.status,
    };
  }

  const status = responseBody.status ?? (response.ok ? 'success' : 'error');
  return {
    status,
    message:
      responseBody.message ??
      (response.ok
        ? 'Discord message sent'
        : `Discord bot HTTP error ${response.status}`),
    httpStatus: response.status,
  };
}

/**
 * Sends a message to several recipients; a failure for one doesn't stop the others.
 * Returns true if it was sent to at least one recipient.
 */
export async function sendDiscordToMany(discordIds, title, text) {
  let anyOk = false;
  for (const id of discordIds) {
    try {
      const res = await sendDiscordMessage(id, title, text);
      if (res.status === 'success') {
        anyOk = true;
      } else {
        console.error(
          `Discord message to ${id} failed: HTTP ${
            res.httpStatus ?? 'unknown'
          }; status=${res.status}; ${res.message}`,
        );
      }
    } catch (e) {
      console.error(
        `Discord message to ${id} failed: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }
  return anyOk;
}
