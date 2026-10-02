import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TOKEN = process.env.BOT_TOKEN || "";
const WEBAPP = (process.env.WEBAPP_URL || "https://romastefale.github.io/MDJR/").replace(/\/$/, "") + "/";
const PORT = Number(process.env.PORT || 3000);
const MAX_SONG = 22 * 1024 * 1024;
const VOLUME = process.env.MDJR_VOLUME || "/mdjr-volume";
const ALLOW = new Set(["https://romastefale.github.io", "https://mdjr.up.railway.app"]);

function publicOrigin() {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, "");
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  return "https://mdjr.up.railway.app";
}

function launchUrl() {
  return `${publicOrigin()}/`;
}

async function api(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({ ok: false, description: "json" }));
  if (!data.ok) console.error(method, data.description || data);
  return data;
}

function openKeyboard() {
  return {
    keyboard: [[{ text: "Open Math DJ", web_app: { url: launchUrl() } }]],
    resize_keyboard: true,
    is_persistent: true,
  };
}

async function setup() {
  const url = launchUrl();
  await api("setMyCommands", {
    commands: [
      { command: "start", description: "Open Math DJ" },
      { command: "draft", description: "Your drafts" },
    ],
  });
  await api("setChatMenuButton", {
    menu_button: { type: "web_app", text: "Math DJ", web_app: { url } },
  });
  await api("setMyShortDescription", { short_description: "A formula becomes a song." });
  console.log("mini app", url);
}

function identityFromInit(initData) {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash") || "";
  params.delete("hash");
  const check = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(TOKEN).digest();
  const calc = crypto.createHmac("sha256", secret).update(check).digest("hex");
  const a = Buffer.from(calc);
  const b = Buffer.from(hash);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const authDate = Number(params.get("auth_date") || 0);
  if (!authDate || Math.abs(Date.now() / 1000 - authDate) > 86400) return null;
  let userId = null;
  let chatId = null;
  try {
    if (params.get("user")) userId = JSON.parse(params.get("user")).id;
    if (params.get("chat")) chatId = JSON.parse(params.get("chat")).id;
  } catch {
    return null;
  }
  if (!userId && !chatId) return null;
  return { userId: userId || chatId, chatId: chatId || userId };
}

function chatFromInit(initData) {
  return identityFromInit(initData)?.chatId ?? null;
}

function userDir(userId) {
  const id = String(userId).replace(/[^\d]/g, "");
  if (!id) return null;
  try {
    const dir = path.join(VOLUME, "users", id);
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
  })) : [];
  const updated = Date.now();
  return {
    id,
    name: id === "progress" ? "Progress" : when(updated),
    updated,
    seconds: Math.min(1200, Math.max(1, Number(body?.seconds) || 60)),
    patch: body?.patch && typeof body.patch === "object" ? body.patch : {},
    rows,
  };
}

function writeProject(userId, id, body) {
  const dir = userDir(userId);
  if (!dir) return null;
  const file = id === "progress" ? "progress.json" : `${id}.json`;
  if (id !== "progress" && !/^[a-f0-9]{8}$/.test(id)) return null;
  const project = projectFrom(body, id);
  fs.writeFileSync(path.join(dir, file), JSON.stringify(project));
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
        return { id: data.id, name: when(data.updated || Date.now()), updated: data.updated || 0 };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.updated - a.updated)
    .slice(0, 12);
}

function htmlEscape(value) {
  return String(value).replace(/[&<>"]/g, (ch) => {
    if (ch === "&") return "&" + "amp;";
    if (ch === "<") return "&" + "lt;";
    if (ch === ">") return "&" + "gt;";
    return "&" + "quot;";
  });
}

function when(ms) {
  return new Date(ms).toLocaleString("en", {
    timeZone: "America/Sao_Paulo",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function appUrl(draftId) {
  const base = publicOrigin();
  return draftId ? `${base}/?draft=${encodeURIComponent(draftId)}` : `${base}/`;
}

function linkButton(label, url) {
  return { text: label, style: "success", web_app: { url } };
}

function buttonRow(label, url) {
  return { type: "buttons", align: "center", buttons: [linkButton(label, url)] };
}

async function say(chatId, blocks) {
  const sent = await api("sendRichMessage", {
    chat_id: chatId,
    rich_message: { blocks },
  });
  if (!sent.ok) console.error("sendRichMessage", sent.description || sent);
  return sent;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_SONG) {
        reject(new Error("size"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../web");
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

function serveWeb(res, urlPath, head) {
  const rel = (urlPath === "/" ? "index.html" : urlPath).replace(/^\/+/, "");
  const file = path.resolve(WEB_DIR, rel);
  if (file !== WEB_DIR && !file.startsWith(WEB_DIR + path.sep)) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end(head ? undefined : "not found");
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end(head ? undefined : "not found");
      return;
    }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
    res.end(head ? undefined : data);
  });
}

function cors(req, res) {
  const origin = req.headers.origin || "";
  res.setHeader("access-control-allow-origin", ALLOW.has(origin) ? origin : "https://romastefale.github.io");
  res.setHeader("access-control-allow-headers", "content-type, x-telegram-init-data, x-filename");
  res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  res.setHeader("vary", "origin");
}

async function onMessage(message) {
  const text = message.text || "";
  const command = text.split(/\s|@/)[0];
  const userId = message.from?.id;
  if (!userId) return;
  if (command === "/start") {
    await say(message.chat.id, [
      { type: "paragraph", text: [{ type: "bold", text: "Math DJ" }] },
      { type: "paragraph", text: "A formula becomes a song." },
      buttonRow("Open", appUrl()),
    ]);
    return;
  }
  if (command !== "/draft") return;
  const drafts = listDrafts(userId);
  const blocks = drafts.length
    ? [
        { type: "paragraph", text: [{ type: "bold", text: "Drafts" }] },
        ...drafts.map((draft) => buttonRow(draft.name, appUrl(draft.id))),
      ]
    : [
        { type: "paragraph", text: [{ type: "bold", text: "Drafts" }] },
        { type: "paragraph", text: "Nothing saved yet." },
        buttonRow("Open", appUrl()),
      ];
  await say(message.chat.id, blocks);
}

async function poll() {
  let offset = 0;
  for (;;) {
    try {
      const data = await api("getUpdates", { offset, timeout: 25, allowed_updates: ["message"] });
      for (const update of data.result || []) {
        offset = update.update_id + 1;
        if (update.message) await onMessage(update.message);
      }
    } catch (err) {
      console.error("poll", err instanceof Error ? err.message : err);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}

const server = http.createServer(async (req, res) => {
  const urlPath = (req.url || "/").split("?")[0];
  if (req.method === "OPTIONS") {
    cors(req, res);
    res.writeHead(204);
    res.end();
    return;
  }
  if (urlPath === "/health") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, service: "mdjr-bot", bot: Boolean(TOKEN), webapp: launchUrl() }));
    return;
  }
  if (urlPath === "/song" && req.method === "POST") {
    cors(req, res);
    if (!TOKEN) {
      res.writeHead(503, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false }));
      return;
    }
    try {
      const chatId = chatFromInit(req.headers["x-telegram-init-data"] || "");
      if (!chatId) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false }));
        return;
      }
      const body = await readBody(req);
      const rawName = String(req.headers["x-filename"] || "math-dj.mp3");
      const filename = rawName.replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 80) || "math-dj.mp3";
      const form = new FormData();
      form.append("chat_id", String(chatId));
      form.append("document", new Blob([body], { type: "audio/mpeg" }), filename.endsWith(".mp3") ? filename : `${filename}.mp3`);
      const sent = await fetch(`https://api.telegram.org/bot${TOKEN}/sendDocument`, { method: "POST", body: form });
      const data = await sent.json().catch(() => ({ ok: false }));
      res.writeHead(data.ok ? 200 : 502, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: Boolean(data.ok) }));
    } catch (err) {
      console.error("song", err instanceof Error ? err.message : err);
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false }));
    }
    return;
  }
  if (urlPath === "/drafts" || urlPath === "/drafts/progress" || /^\/drafts\/[a-f0-9]{8}$/.test(urlPath)) {
    cors(req, res);
    const who = identityFromInit(req.headers["x-telegram-init-data"] || "");
    if (!who) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false }));
      return;
    }
    if (req.method === "GET" && urlPath === "/drafts") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(listDrafts(who.userId)));
      return;
    }
    if (req.method === "GET") {
      const id = urlPath === "/drafts/progress" ? "progress" : urlPath.slice("/drafts/".length);
      const project = readProject(who.userId, id);
      res.writeHead(project ? 200 : 404, { "content-type": "application/json" });
      res.end(JSON.stringify(project || { ok: false }));
      return;
    }
    if (req.method === "POST") {
      try {
        const raw = await readBody(req);
        if (raw.length > 100000) throw new Error("size");
        const body = JSON.parse(raw.toString("utf8"));
        const id = urlPath === "/drafts/progress"
          ? "progress"
          : /^\/drafts\/[a-f0-9]{8}$/.test(urlPath)
            ? urlPath.slice("/drafts/".length)
            : crypto.randomBytes(4).toString("hex");
        const saved = writeProject(who.userId, id, body);
        res.writeHead(saved ? 200 : 400, { "content-type": "application/json" });
        res.end(JSON.stringify(saved || { ok: false }));
      } catch {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false }));
      }
      return;
    }
  }
  if (req.method === "GET" || req.method === "HEAD") {
    serveWeb(res, urlPath, req.method === "HEAD");
    return;
  }
  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("not found");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`mdjr-bot na porta ${PORT}`);
  if (!TOKEN) {
    console.error("BOT_TOKEN ausente. Crie a variável no Railway e faça redeploy.");
    return;
  }
  setup()
    .then(() => poll())
    .catch((err) => console.error("setup", err));
});
