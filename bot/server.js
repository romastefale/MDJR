import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTelegram } from "./telegram.js";
import { LANGS, pickLang, texts } from "./i18n.js";

const MAX_SONG = 22 * 1024 * 1024;
const MAX_DRAFT = 100_000;
const APP_VERSION = "36"; // keep in sync with web/index.html (?v=) and the app bundle
const KNOWN_ORIGINS = ["https://romastefale.github.io", "https://mdjr.up.railway.app"];
const PRIVATE_SCOPE = { type: "all_private_chats" };
const MEMBER_STATUSES = new Set(["creator", "administrator", "member", "restricted"]);

export function publicOrigin(env = process.env) {
  if (env.PUBLIC_URL) return env.PUBLIC_URL.replace(/\/$/, "");
  if (env.RAILWAY_PUBLIC_DOMAIN) return `https://${env.RAILWAY_PUBLIC_DOMAIN}`;
  return "https://mdjr.up.railway.app";
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

export function createApp({ token = "", telegram, volume = "/mdjr-volume", env = process.env, log = console.error } = {}) {
  const origin = publicOrigin(env);
  const allowed = new Set([...KNOWN_ORIGINS, origin]);
  const state = { username: null };
  const leaving = new Set();

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

  function projectFrom(body, id) {
    const rows = Array.isArray(body?.rows) ? body.rows.slice(0, 5).map((row) => ({
      y: String(row?.y || "").slice(0, 500),
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
      patch: body?.patch && typeof body.patch === "object" ? body.patch : {},
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
      for (const item of ranked.slice(5)) fs.unlinkSync(path.join(dir, item.name));
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
      .slice(0, 5);
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
    if (kind === "unknown") return { title: tx.name, paragraphs: [tx.unknownCommand], buttons: [open] };
    if (kind === "text") return { title: tx.name, paragraphs: [tx.plainText], buttons: [open] };
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
    const lang = pickLang(from.language_code);
    const command = parseCommand(message);
    if (command) {
      if (!isForThisBot(command, state.username)) return;
      const kind = ["start", "help", "draft"].includes(command.name) ? command.name : "unknown";
      await send(message, replyFor(kind, lang, from.id));
      return;
    }
    if (typeof message.text === "string" && message.text.trim()) await send(message, replyFor("text", lang, from.id));
  }

  // https://core.telegram.org/bots/api#chatmemberupdated — the bot's own membership changes.
  async function onMyChatMember(update) {
    if (update.chat?.type !== "private" && MEMBER_STATUSES.has(update.new_chat_member?.status)) await leave(update.chat);
  }

  async function handleUpdate(update) {
    if (update.message) await onMessage(update.message);
    else if (update.my_chat_member) await onMyChatMember(update.my_chat_member);
  }

  async function setup() {
    for (let delay = 2000; ; delay = Math.min(delay * 2, 60000)) {
      const me = await telegram.call("getMe");
      if (me.ok && me.result?.username) {
        state.username = me.result.username;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
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
    console.log("mini app", appUrl(origin), "bot", `@${state.username}`);
  }

  async function poll() {
    let offset = 0;
    for (;;) {
      const data = await telegram.call(
        "getUpdates",
        { offset, timeout: 25, allowed_updates: ["message", "my_chat_member"] },
        { retries: 0 },
      );
      if (!data.ok) {
        await new Promise((resolve) => setTimeout(resolve, (Number(data.parameters?.retry_after) || 3) * 1000));
        continue;
      }
      for (const update of data.result || []) {
        offset = update.update_id + 1;
        try {
          await handleUpdate(update);
        } catch (err) {
          log("update", err instanceof Error ? err.message : err);
        }
      }
    }
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
      raw = await readBody(req, MAX_DRAFT);
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
      log("http", err instanceof Error ? err.message : err);
      if (!res.headersSent) json(res, 500, { ok: false });
      else res.end();
    }
  });

  return { server, handleUpdate, setup, poll, state };
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

if (isMain) {
  const token = process.env.BOT_TOKEN || "";
  const port = Number(process.env.PORT || 3000);
  const app = createApp({
    token,
    telegram: createTelegram(token),
    volume: process.env.MDJR_VOLUME || "/mdjr-volume",
  });
  app.server.listen(port, "0.0.0.0", () => {
    console.log(`mdjr-bot na porta ${port}`);
    if (!token) {
      console.error("BOT_TOKEN ausente. Crie a variável no Railway e faça redeploy.");
      return;
    }
    app.setup()
      .then(() => app.poll())
      .catch((err) => console.error("setup", err instanceof Error ? err.message : err));
  });
}
