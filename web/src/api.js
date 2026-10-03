import { telegramApp } from "./telegram.js";

// GitHub Pages only hosts the page, so there the API (drafts, /song, /health) is the Railway server.
// Everywhere else the page comes from bot/server.js itself, which is also the API.
const RAILWAY = "https://mdjr.up.railway.app";

export function onPages() {
  return location.hostname.endsWith(".github.io");
}

export function apiOrigin() {
  return onPages() ? RAILWAY : location.origin;
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
