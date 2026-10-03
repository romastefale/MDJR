import { API_ORIGIN } from "./config.js";
import { telegramApp } from "./telegram.js";

export function apiOrigin() {
  return API_ORIGIN;
}

// JSON call to the drafts API, authenticated by Telegram initData (validated by bot/server.js).
// Outside Telegram nothing is sent and the result is { ok: false, status: 0 }.
export function apiRequest(method, path, body) {
  const initData = telegramApp()?.initData;
  if (!initData) return Promise.resolve({ ok: false, status: 0, data: null });
  return fetch(`${apiOrigin()}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-telegram-init-data": initData },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async (response) =>
    response.ok ? { ok: true, status: response.status, data: await response.json() } : { ok: false, status: response.status, data: null },
  );
}
