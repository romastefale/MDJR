import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTelegram } from "./telegram.js";
import { createLogger } from "./log.js";
import { LANGS, pickLang, texts } from "./i18n.js";

const MAX_SONG = 22 * 1024 * 1024;
// Drafts (Decisão do Pi, 2026-10-03): up to 8 per user, with sizes that follow a real draft.
// web/app.js POSTs { name, rows, seconds, patch } to /drafts:
//   name    first formula cut to 32 characters
//   rows    5 rows of { id, y, on, color, bpm, vol }; y is the formula, with NO length cap in the app
//   seconds one of 30…1200
//   patch   the knob object: the app's defaults (mode, presetId, formula, engine, x, y, z, w, a, b,
//           g, d, bpm, vol, lpf, res, pan, seconds) plus muted
// Two different numbers:
// 1. Stored size (what goes to disk) is bounded by projectFrom(): name ≤ 32, 5 rows, formula ≤ 500,
//    color ≤ 40, only the knob fields in patch (strings ≤ 40, patch formula ≤ 500, finite numbers).
//    Measured on this server with JSON.stringify, every field at its cap, every number at its longest
//    text form (-1.7976931348623157e+308):
//      ASCII text                                              about 3.5 KB
//      every character a 3-byte UTF-8 symbol (− ≤ ·)           10,969 bytes
//      every character escaped as \uXXXX (control characters
//      or lone surrogates, 6 bytes each): absolute maximum     21,045 bytes  → bound: 21 KB
// 2. Request cap (what /drafts reads) only protects the server; it is not the draft size. The app does
//    not cap formulas, so longer ones must still be accepted and trimmed to 500, as before this PR.
//    128 KB stays above the 100 KB the server accepted before, so nothing that used to save is now
//    refused; it fits 5 ASCII formulas of ~26,000 characters each, about 6× the stored maximum.
const MAX_DRAFTS = 8;
const MAX_DRAFT_BODY = 128 * 1024;
const MAX_FORMULA = 500;
const PATCH_STRINGS = { mode: 40, presetId: 40, engine: 40, formula: MAX_FORMULA };
const PATCH_NUMBERS = ["x", "y", "z", "w", "a", "b", "g", "d", "bpm", "vol", "lpf", "res", "pan", "seconds"];
const MAX_UPDATE = 1024 * 1024; // webhook body cap; real updates are a few KB
const APP_VERSION = "36"; // keep in sync with web/index.html (?v=) and the app bundle
const DEFAULT_ORIGIN = "https://mdjr.up.railway.app";
const KNOWN_ORIGINS = ["https://romastefale.github.io", DEFAULT_ORIGIN];
const PRIVATE_SCOPE = { type: "all_private_chats" };
const COMMANDS = new Set(["start", "help", "draft"]);
const MEMBER_STATUSES = new Set(["creator", "administrator", "member", "restricted"]);
const SECRET_CHARSET = /^[A-Za-z0-9_-]{1,256}$/; // setWebhook secret_token rules

// Webhook (https://core.telegram.org/bots/api#setwebhook). Only the update types handled in
// handleUpdate() are requested.
export const WEBHOOK_PATH = "/telegram/webhook";
export const ALLOWED_UPDATES = ["message", "my_chat_member"];

export function publicOrigin(env = process.env) {
  if (env.PUBLIC_URL) return env.PUBLIC_URL.replace(/\/$/, "");
  if (env.RAILWAY_PUBLIC_DOMAIN) return `https://${env.RAILWAY_PUBLIC_DOMAIN}`;
  return DEFAULT_ORIGIN;
}

// Mini App links must be HTTPS (https://core.telegram.org/bots/api#webappinfo: "An HTTPS URL of a
// Web App"). With a plain-HTTP PUBLIC_URL (local development) the buttons keep opening the public app.
export function miniAppOrigin(env = process.env) {
  const origin = publicOrigin(env);
  return /^https:\/\/[^/]+$/i.test(origin) ? origin : DEFAULT_ORIGIN;
}

// Public HTTPS origin Telegram can reach for the webhook, or null (e.g. local dev).
// Same sources as publicOrigin(); on Railway without a domain variable it uses the same
// default origin the Mini App already uses.
export function webhookOrigin(env = process.env) {
  const onRailway = Boolean(env.RAILWAY_ENVIRONMENT_ID || env.RAILWAY_PROJECT_ID || env.RAILWAY_SERVICE_ID);
  if (!env.PUBLIC_URL && !env.RAILWAY_PUBLIC_DOMAIN && !onRailway) return null;
  const origin = publicOrigin(env);
  return /^https:\/\/[^/]+$/i.test(origin) ? origin : null;
}

export function isValidSecret(value) {
  return typeof value === "string" && SECRET_CHARSET.test(value);
}

// WEBHOOK_SECRET if valid; otherwise a stable secret derived from the bot token
// (64 hex chars, inside the allowed A-Z a-z 0-9 _ - charset), so redeploys need no new variable.
export function webhookSecret(token, env = process.env) {
  if (isValidSecret(env.WEBHOOK_SECRET)) return env.WEBHOOK_SECRET;
  if (!token) return "";
  return crypto.createHmac("sha256", token).update("mdjr-webhook-secret-v1").digest("hex");
}

// Parameters for setWebhook. drop_pending_updates is deliberately not sent (defaults to false):
// updates queued while the service restarts are real user messages and should still be answered.
export function webhookParams(token, env = process.env) {
  const origin = webhookOrigin(env);
  const secret = webhookSecret(token, env);
  if (!origin || !secret) return null;
  return { url: `${origin}${WEBHOOK_PATH}`, secret_token: secret, allowed_updates: ALLOWED_UPDATES };
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest();
}

// Constant-time comparison that also hides the length of the expected value.
export function sameSecret(received, expected) {
  if (!expected || typeof received !== "string" || !received) return false;
  return crypto.timingSafeEqual(sha256(received), sha256(expected));
}

export function appUrl(origin, draftId) {
  const base = `${origin}/?v=${APP_VERSION}`;
  return draftId ? `${base}&draft=${encodeURIComponent(draftId)}` : base;
}

// Validates Telegram.WebApp.initData as documented in
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
// Returns the verified WebAppUser (with a numeric id) or null. Fails closed without a token.
export function validateInitData(initData, token, nowMs = Date.now()) {
  if (!token || typeof initData !== "string" || !initData) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash") || "";
  params.delete("hash");
  const check = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(token).digest();
  const calc = Buffer.from(crypto.createHmac("sha256", secret).update(check).digest("hex"));
  const got = Buffer.from(hash);
  if (calc.length !== got.length || !crypto.timingSafeEqual(calc, got)) return null;
  const authDate = Number(params.get("auth_date") || 0);
  if (!authDate || Math.abs(nowMs / 1000 - authDate) > 86400) return null;
  try {
    const user = JSON.parse(params.get("user") || "null");
    return user && Number.isSafeInteger(user.id) && user.id > 0 ? user : null;
  } catch {
    return null;
  }
}

// Reads the bot command at the start of a message from its "bot_command" entity.
// https://core.telegram.org/bots/api#messageentity
export function parseCommand(message) {
  const text = message?.text || "";
  const entity = (message?.entities || []).find((e) => e.type === "bot_command" && e.offset === 0);
  if (!entity) return null;
  const [name, target = ""] = text.slice(1, entity.length).split("@");
  return { name: name.toLowerCase(), target, args: text.slice(entity.length).trim() };
}

// "/cmd@SomeBot" is only for us when SomeBot is our own username (from getMe).
export function isForThisBot(command, username) {
  if (!command.target) return true;
  return Boolean(username) && command.target.toLowerCase() === String(username).toLowerCase();
}

export function songDuration(filename) {
  const match = /(\d{1,2})m(\d{2})/.exec(filename);
  if (!match) return null;
  const seconds = Number(match[1]) * 60 + Number(match[2]);
  return seconds >= 1 && seconds <= 1200 ? seconds : null;
}

function formatTime(seconds) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

// A reply is { title, paragraphs, list, buttons:[{ label, url }] }, rendered either as a
// rich message (Bot API 10.3) or, as a fallback, as a plain sendMessage with an inline keyboard.
export function richBlocks(reply) {
  const blocks = [{ type: "paragraph", text: [{ type: "bold", text: reply.title }] }];
  for (const text of reply.paragraphs || []) blocks.push({ type: "paragraph", text });
  if (reply.list?.length) {
    blocks.push({ type: "list", items: reply.list.map((text) => ({ blocks: [{ type: "paragraph", text }] })) });
  }
  for (const button of reply.buttons || []) {
    blocks.push({ type: "buttons", align: "center", buttons: [{ text: button.label, style: "success", web_app: { url: button.url } }] });
  }
  return blocks;
}

export function plainMessage(reply) {
  const parts = [reply.title, ...(reply.paragraphs || [])];
  if (reply.list?.length) parts.push(reply.list.map((line) => `• ${line}`).join("\n"));
  const message = { text: parts.join("\n\n") };
  if (reply.buttons?.length) {
    message.reply_markup = {
      inline_keyboard: reply.buttons.map((b) => [{ text: b.label, style: "success", web_app: { url: b.url } }]),
    };
  }
  return message;
}

export function createApp({
  token = "",
  telegram,
  volume = "/mdjr-volume",
  env = process.env,
  log = console.error,
  info = console.log,
} = {}) {
  const origin = miniAppOrigin(env);
  const allowed = new Set([...KNOWN_ORIGINS, publicOrigin(env)]);
  const secret = webhookSecret(token, env);
  // Every log line from the app is redacted (token, webhook secret, token-shaped strings).
  const logger = createLogger({ secrets: [token, secret, env.WEBHOOK_SECRET], sink: { error: log, log: info } });
  const state = { username: null, mode: "off", stopping: false };
  const leaving = new Set();
  const inflight = new Set();
  const seen = new Set();
  const seenOrder = [];

  // ---------- drafts on disk ----------
  function userDir(userId) {
    const id = String(userId).replace(/[^\d]/g, "");
    if (!id) return null;
    try {
      const dir = path.join(volume, "users", id);
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    } catch {
      return null;
    }
  }

  function cleanName(value) {
    const name = String(value || "").replace(/\s+/g, " ").trim().slice(0, 32);
    return name || "Untitled";
  }

  // Only the knob fields the app reads back ({ ...defaults, ...patch }), each bounded.
  function patchFrom(value) {
    const patch = {};
    if (!value || typeof value !== "object" || Array.isArray(value)) return patch;
    for (const [key, max] of Object.entries(PATCH_STRINGS)) {
      if (typeof value[key] === "string") patch[key] = value[key].slice(0, max);
    }
    for (const key of PATCH_NUMBERS) {
      if (typeof value[key] === "number" && Number.isFinite(value[key])) patch[key] = value[key];
    }
    if (typeof value.muted === "boolean") patch.muted = value.muted;
    return patch;
  }

  function projectFrom(body, id) {
    const rows = Array.isArray(body?.rows) ? body.rows.slice(0, 5).map((row) => ({
      y: String(row?.y || "").slice(0, MAX_FORMULA),
      on: Boolean(row?.on),
      color: String(row?.color || "").slice(0, 40),
      bpm: Math.min(180, Math.max(80, Math.round(Number(row?.bpm) || 120))),
      vol: Math.min(1, Math.max(0, Number.isFinite(Number(row?.vol)) ? Number(row.vol) : 0.75)),
    })) : [];
    return {
      id,
      name: id === "progress" ? "Progress" : cleanName(body?.name),
      updated: Date.now(),
      seconds: Math.min(1200, Math.max(1, Number(body?.seconds) || 60)),
      patch: patchFrom(body?.patch),
      rows,
    };
  }

  function writeProject(userId, id, body) {
    const dir = userDir(userId);
    if (!dir) return null;
    if (id !== "progress" && !/^[a-f0-9]{8}$/.test(id)) return null;
    const file = id === "progress" ? "progress.json" : `${id}.json`;
    const project = projectFrom(body, id);
    fs.writeFileSync(path.join(dir, file), JSON.stringify(project));
    if (id !== "progress") {
      const ranked = [];
      for (const name of fs.readdirSync(dir)) {
        if (!/^[a-f0-9]{8}\.json$/.test(name)) continue;
        try {
          ranked.push({ name, updated: Number(JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")).updated) || 0 });
        } catch {
          continue;
        }
      }
      ranked.sort((a, b) => b.updated - a.updated);
      for (const item of ranked.slice(MAX_DRAFTS)) fs.unlinkSync(path.join(dir, item.name));
    }
    return { id: project.id, name: project.name, updated: project.updated };
  }

  function readProject(userId, id) {
    const dir = userDir(userId);
    if (!dir) return null;
    const file = id === "progress" ? "progress.json" : /^[a-f0-9]{8}$/.test(id) ? `${id}.json` : "";
    if (!file) return null;
    try {
      return JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    } catch {
      return null;
    }
  }

  function listDrafts(userId) {
    const dir = userDir(userId);
    if (!dir) return [];
    return fs.readdirSync(dir)
      .filter((name) => /^[a-f0-9]{8}\.json$/.test(name))
      .map((name) => {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
          return { id: data.id, name: cleanName(data.name), updated: data.updated || 0 };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => b.updated - a.updated)
      .slice(0, MAX_DRAFTS);
  }

  // ---------- bot side (private chats only) ----------
  async function send(message, reply) {
    const target = { chat_id: message.chat.id };
    if (message.is_topic_message && message.message_thread_id) target.message_thread_id = message.message_thread_id;
    const rich = await telegram.call("sendRichMessage", { ...target, rich_message: { blocks: richBlocks(reply) } });
    if (rich.ok || rich.error_code === 403) return rich; // 403: the user blocked the bot
    return telegram.call("sendMessage", { ...target, ...plainMessage(reply), link_preview_options: { is_disabled: true } });
  }

  function replyFor(kind, lang, userId) {
    const tx = texts(lang);
    const open = { label: tx.open, url: appUrl(origin) };
    if (kind === "start") return { title: tx.name, paragraphs: [tx.tagline], buttons: [open] };
    if (kind === "help") return { title: tx.name, paragraphs: [tx.helpIntro, tx.helpSong], list: tx.helpCommands, buttons: [open] };
    if (kind === "draft") {
      const drafts = listDrafts(userId);
      return drafts.length
        ? { title: tx.drafts, buttons: drafts.map((d) => ({ label: d.name, url: appUrl(origin, d.id) })) }
        : { title: tx.drafts, paragraphs: [tx.noDrafts], buttons: [open] };
    }
    return null;
  }

  async function leave(chat) {
    if (!chat || chat.type === "private" || leaving.has(chat.id)) return;
    leaving.add(chat.id);
    await telegram.call("leaveChat", { chat_id: chat.id });
  }

  async function onMessage(message) {
    const from = message.from;
    if (!from || from.is_bot || !message.chat) return;
    // MDJR is a private-chat bot: commands never run in groups, supergroups or channels.
    if (message.chat.type !== "private") {
      if (message.chat.type === "group" || message.chat.type === "supergroup") await leave(message.chat);
      return;
    }
    // Only the bot's own commands get a reply. Unknown commands and plain text are ignored
    // (Decisão do Pi, 2026-10-03: "ele tem os comandos dele já" — /start, /help, /draft).
    const command = parseCommand(message);
    if (!command || !isForThisBot(command, state.username) || !COMMANDS.has(command.name)) return;
    await send(message, replyFor(command.name, pickLang(from.language_code), from.id));
  }

  // https://core.telegram.org/bots/api#chatmemberupdated — the bot's own membership changes.
  async function onMyChatMember(update) {
    if (update.chat?.type !== "private" && MEMBER_STATUSES.has(update.new_chat_member?.status)) await leave(update.chat);
  }

  async function handleUpdate(update) {
    if (update.message) await onMessage(update.message);
    else if (update.my_chat_member) await onMyChatMember(update.my_chat_member);
  }

  // Telegram may deliver an update again (e.g. after a timeout); handle each update_id once.
  function firstTime(updateId) {
    if (seen.has(updateId)) return false;
    seen.add(updateId);
    seenOrder.push(updateId);
    if (seenOrder.length > 1000) seen.delete(seenOrder.shift());
    return true;
  }

  // Runs an update in the background, tracked so shutdown can wait for it. Never rejects.
  function dispatch(update) {
    const job = Promise.resolve()
      .then(() => handleUpdate(update))
      .catch((err) => logger.error("update", err))
      .finally(() => inflight.delete(job));
    inflight.add(job);
    return job;
  }

  async function idle() {
    while (inflight.size) await Promise.allSettled([...inflight]);
  }

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function setup() {
    for (let delay = 2000; ; delay = Math.min(delay * 2, 60000)) {
      const me = await telegram.call("getMe");
      if (me.ok && me.result?.username) {
        state.username = me.result.username;
        break;
      }
      if (state.stopping) return;
      await wait(delay);
    }
    // Commands only in private chats (BotCommandScopeAllPrivateChats); drop any old default list
    // so nothing is suggested in groups. https://core.telegram.org/bots/api#determining-list-of-commands
    await telegram.call("deleteMyCommands", {});
    for (const lang of LANGS) {
      const tx = texts(lang);
      const language = lang === "en" ? {} : { language_code: lang };
      await telegram.call("setMyCommands", { commands: tx.commands, scope: PRIVATE_SCOPE, ...language });
      await telegram.call("setMyDescription", { description: tx.description, ...language });
      await telegram.call("setMyShortDescription", { short_description: tx.shortDescription, ...language });
    }
    await telegram.call("setChatMenuButton", { menu_button: { type: "web_app", text: "Math DJ", web_app: { url: appUrl(origin) } } });
    logger.info("mini app", appUrl(origin), "bot", `@${state.username}`);
  }

  // Local development only (USE_POLLING=1). Production uses the webhook.
  async function poll() {
    let offset = 0;
    while (!state.stopping) {
      const data = await telegram.call("getUpdates", { offset, timeout: 25, allowed_updates: ALLOWED_UPDATES }, { retries: 0 });
      if (state.stopping) break;
      if (!data.ok) {
        await wait((Number(data.parameters?.retry_after) || 3) * 1000);
        continue;
      }
      for (const update of data.result || []) {
        offset = update.update_id + 1;
        if (firstTime(update.update_id)) await dispatch(update);
      }
    }
  }

  // Configures the bot and starts receiving updates: webhook by default, polling only with
  // USE_POLLING=1. Returns the mode ("webhook", "polling" or "off").
  async function start() {
    if (!token) {
      logger.error("BOT_TOKEN ausente. Crie a variável no Railway e faça redeploy.");
      return (state.mode = "off");
    }
    await setup();
    if (state.stopping) return state.mode;
    if (env.USE_POLLING === "1") {
      // getUpdates does not work while a webhook is set; pending updates are kept.
      await telegram.call("deleteWebhook", {});
      logger.info("USE_POLLING=1: webhook removido, recebendo updates por getUpdates (só para desenvolvimento).");
      state.mode = "polling";
      state.polling = poll();
      return state.mode;
    }
    if (env.WEBHOOK_SECRET && !isValidSecret(env.WEBHOOK_SECRET)) {
      logger.error("WEBHOOK_SECRET inválido (use 1-256 caracteres A-Z a-z 0-9 _ -); usando o segredo derivado do token.");
    }
    const params = webhookParams(token, env);
    if (!params) {
      logger.error(
        "Sem URL pública HTTPS (PUBLIC_URL ou RAILWAY_PUBLIC_DOMAIN): o webhook não foi configurado e o bot não recebe mensagens. " +
          "Para desenvolvimento local, rode com USE_POLLING=1.",
      );
      return (state.mode = "off");
    }
    for (let delay = 2000; !state.stopping; delay = Math.min(delay * 2, 60000)) {
      const done = await telegram.call("setWebhook", params);
      if (done.ok) {
        // Only the public endpoint; never the secret_token or the rest of the payload.
        logger.info("webhook", params.url);
        return (state.mode = "webhook");
      }
      await wait(delay);
    }
    return state.mode;
  }

  async function stop() {
    state.stopping = true;
    await new Promise((resolve) => {
      server.close(() => resolve());
      server.closeIdleConnections?.();
    });
    await idle();
  }

  // ---------- HTTP ----------
  function cors(req, res) {
    res.setHeader("vary", "origin");
    const requestOrigin = req.headers.origin || "";
    if (!allowed.has(requestOrigin)) return;
    res.setHeader("access-control-allow-origin", requestOrigin);
    res.setHeader("access-control-allow-headers", "content-type, x-telegram-init-data, x-filename");
    res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  }

  function json(res, status, body, headers = {}) {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
    res.end(JSON.stringify(body));
  }

  function readBody(req, limit) {
    return new Promise((resolve, reject) => {
      const tooLarge = () => Object.assign(new Error("too large"), { status: 413 });
      if (Number(req.headers["content-length"] || 0) > limit) {
        reject(tooLarge());
        return;
      }
      const chunks = [];
      let size = 0;
      let done = false;
      req.on("data", (chunk) => {
        if (done) return;
        size += chunk.length;
        if (size > limit) {
          done = true;
          reject(tooLarge());
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => {
        if (!done) resolve(Buffer.concat(chunks));
      });
      req.on("error", reject);
    });
  }

  function fail(req, res, err) {
    if (err?.status === 413) {
      json(res, 413, { ok: false }, { connection: "close" });
      res.on("finish", () => req.destroy());
      return;
    }
    json(res, 400, { ok: false });
  }

  const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../web");
  const TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".webmanifest": "application/manifest+json",
    ".woff2": "font/woff2",
  };

  function serveWeb(res, urlPath, head) {
    const rel = (urlPath === "/" ? "index.html" : urlPath).replace(/^\/+/, "");
    const file = path.resolve(WEB_DIR, rel);
    const notFound = () => {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end(head ? undefined : "not found");
    };
    if (file !== WEB_DIR && !file.startsWith(WEB_DIR + path.sep)) return notFound();
    fs.readFile(file, (err, data) => {
      if (err) return notFound();
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": "no-cache" });
      res.end(head ? undefined : data);
    });
  }

  async function onSong(req, res) {
    if (!token) return json(res, 503, { ok: false });
    // Deliver only to the verified user's private chat with the bot, never to a group chat.
    const user = validateInitData(req.headers["x-telegram-init-data"] || "", token);
    if (!user) return json(res, 401, { ok: false });
    let body;
    try {
      body = await readBody(req, MAX_SONG);
    } catch (err) {
      return fail(req, res, err);
    }
    if (!body.length) return json(res, 400, { ok: false });
    const tx = texts(pickLang(user.language_code));
    const raw = String(req.headers["x-filename"] || "math-dj.mp3").replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 80) || "math-dj.mp3";
    const filename = raw.endsWith(".mp3") ? raw : `${raw}.mp3`;
    const duration = songDuration(filename);
    // sendChatAction has no audio action; "upload_document" is the documented one for files.
    await telegram.call("sendChatAction", { chat_id: user.id, action: "upload_document" }, { retries: 0 });
    const form = new FormData();
    form.append("chat_id", String(user.id));
    form.append("audio", new Blob([body], { type: "audio/mpeg" }), filename);
    form.append("title", duration ? `Math DJ ${formatTime(duration)}` : "Math DJ");
    form.append("performer", "MDJR");
    if (duration) form.append("duration", String(duration));
    form.append("caption", tx.songCaption);
    const sent = await telegram.call("sendAudio", form);
    json(res, sent.ok ? 200 : 502, { ok: Boolean(sent.ok) });
  }

  // Telegram webhook: secret header first, then POST + JSON + size checks. The update is
  // acknowledged with an empty 200 right away and handled in the background, so slow Bot API
  // calls never make Telegram time out and resend it; handler errors are logged, never a 5xx.
  async function onWebhook(req, res) {
    if (!token || !secret) return json(res, 503, { ok: false });
    if (!sameSecret(req.headers["x-telegram-bot-api-secret-token"], secret)) return json(res, 401, { ok: false });
    if (req.method !== "POST") return json(res, 405, { ok: false }, { allow: "POST" });
    if (!/^application\/json(?:\s*;|$)/i.test(String(req.headers["content-type"] || ""))) return json(res, 415, { ok: false });
    let raw;
    try {
      raw = await readBody(req, MAX_UPDATE);
    } catch (err) {
      return fail(req, res, err);
    }
    let update;
    try {
      update = JSON.parse(raw.toString("utf8"));
    } catch {
      return json(res, 400, { ok: false });
    }
    if (!update || typeof update !== "object" || !Number.isSafeInteger(update.update_id)) return json(res, 400, { ok: false });
    res.writeHead(200, { "content-length": "0" });
    res.end();
    if (firstTime(update.update_id)) dispatch(update);
  }

  async function onDrafts(req, res, urlPath) {
    if (!token) return json(res, 503, { ok: false });
    const user = validateInitData(req.headers["x-telegram-init-data"] || "", token);
    if (!user) return json(res, 401, { ok: false });
    if (req.method === "GET" && urlPath === "/drafts") return json(res, 200, listDrafts(user.id));
    if (req.method === "GET") {
      const id = urlPath === "/drafts/progress" ? "progress" : urlPath.slice("/drafts/".length);
      const project = readProject(user.id, id);
      return json(res, project ? 200 : 404, project || { ok: false });
    }
    if (req.method !== "POST") return json(res, 405, { ok: false });
    let raw;
    try {
      raw = await readBody(req, MAX_DRAFT_BODY);
    } catch (err) {
      return fail(req, res, err);
    }
    try {
      const body = JSON.parse(raw.toString("utf8"));
      const id = urlPath === "/drafts/progress"
        ? "progress"
        : /^\/drafts\/[a-f0-9]{8}$/.test(urlPath)
          ? urlPath.slice("/drafts/".length)
          : crypto.randomBytes(4).toString("hex");
      const saved = writeProject(user.id, id, body);
      return json(res, saved ? 200 : 400, saved || { ok: false });
    } catch {
      return json(res, 400, { ok: false });
    }
  }

  const server = http.createServer(async (req, res) => {
    const urlPath = (req.url || "/").split("?")[0];
    try {
      if (req.method === "OPTIONS") {
        cors(req, res);
        res.writeHead(204);
        res.end();
        return;
      }
      if (urlPath === WEBHOOK_PATH) return await onWebhook(req, res);
      if (urlPath === "/health") {
        cors(req, res);
        // The app only reads `webapp` (its version check). No bot/token details here.
        return json(res, 200, { ok: true, service: "mdjr-bot", webapp: appUrl(origin) });
      }
      if (urlPath === "/song" && req.method === "POST") {
        cors(req, res);
        return await onSong(req, res);
      }
      if (urlPath === "/drafts" || urlPath === "/drafts/progress" || /^\/drafts\/[a-f0-9]{8}$/.test(urlPath)) {
        cors(req, res);
        return await onDrafts(req, res, urlPath);
      }
      if (req.method === "GET" || req.method === "HEAD") return serveWeb(res, urlPath, req.method === "HEAD");
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("not found");
    } catch (err) {
      logger.error("http", err);
      if (!res.headersSent) json(res, 500, { ok: false });
      else res.end();
    }
  });

  return { server, handleUpdate, dispatch, idle, setup, start, stop, state, logger };
}

function isEntryPoint() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

const isMain = isEntryPoint();

// Last-resort handler for crashes: logs the (redacted) stack instead of Node's raw output.
export function crashHandler(logger, exit = (code) => process.exit(code)) {
  return (kind) => (err) => {
    logger.crash(kind, err);
    exit(1);
  };
}

if (isMain) {
  const token = process.env.BOT_TOKEN || "";
  const port = Number(process.env.PORT || 3000);
  const logger = createLogger({
    secrets: [token, webhookSecret(token, process.env), process.env.WEBHOOK_SECRET],
  });
  const onCrash = crashHandler(logger);
  process.on("uncaughtException", onCrash("uncaughtException"));
  process.on("unhandledRejection", onCrash("unhandledRejection"));
  const app = createApp({
    token,
    telegram: createTelegram(token, { log: logger.error }),
    volume: process.env.MDJR_VOLUME || "/mdjr-volume",
    log: logger.error,
    info: logger.info,
  });
  app.server.listen(port, "0.0.0.0", () => {
    logger.info(`mdjr-bot na porta ${app.server.address().port}`);
    app.start().catch((err) => logger.error("start", err));
  });

  // Graceful shutdown: stop accepting requests and let in-flight updates finish (max 8 s).
  // The webhook is not deleted, so the next deploy keeps receiving updates at the same URL.
  let closing = false;
  const shutdown = (signal) => {
    if (closing) return;
    closing = true;
    logger.info(`${signal}: encerrando`);
    setTimeout(() => process.exit(0), 8000).unref();
    app.stop().finally(() => process.exit(0));
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
