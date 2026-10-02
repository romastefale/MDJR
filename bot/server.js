import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TOKEN = process.env.BOT_TOKEN || "";
const WEBAPP = (process.env.WEBAPP_URL || "https://romastefale.github.io/MDJR/").replace(/\/$/, "") + "/";
const PORT = Number(process.env.PORT || 3000);
const MAX_SONG = 22 * 1024 * 1024;
const ORIGIN = "https://romastefale.github.io";

function publicOrigin() {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, "");
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  return "https://mdjr.up.railway.app";
}

function launchUrl() {
  const origin = publicOrigin();
  return origin ? `${WEBAPP}?api=${encodeURIComponent(origin)}` : WEBAPP;
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
  const url = launchUrl();
  return {
    keyboard: [[{ text: "Abrir Math DJ", web_app: { url } }]],
    resize_keyboard: true,
    is_persistent: true,
  };
}

async function setup() {
  const url = launchUrl();
  await api("setMyCommands", {
    commands: [
      { command: "start", description: "Abrir o Math DJ" },
      { command: "app", description: "Abrir o Mini App" },
    ],
  });
  await api("setChatMenuButton", {
    menu_button: { type: "web_app", text: "Math DJ", web_app: { url } },
  });
  await api("setMyShortDescription", { short_description: "y = f(x). Mini App." });
  console.log("mini app", url);
}

function chatFromInit(initData) {
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
  try {
    if (params.get("chat")) return JSON.parse(params.get("chat")).id;
    if (params.get("user")) return JSON.parse(params.get("user")).id;
  } catch {
    return null;
  }
  return null;
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

function cors(res) {
  res.setHeader("access-control-allow-origin", ORIGIN);
  res.setHeader("access-control-allow-headers", "content-type, x-telegram-init-data, x-filename");
  res.setHeader("access-control-allow-methods", "POST, OPTIONS");
  res.setHeader("vary", "origin");
}

async function onMessage(message) {
  const text = message.text || "";
  if (!text.startsWith("/start") && !text.startsWith("/app")) return;
  await api("sendMessage", {
    chat_id: message.chat.id,
    text: "Math DJ",
    reply_markup: openKeyboard(),
  });
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
  const path = (req.url || "/").split("?")[0];
  if (req.method === "OPTIONS") {
    cors(res);
    res.writeHead(204);
    res.end();
    return;
  }
  if (path === "/health") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, service: "mdjr-bot", bot: Boolean(TOKEN), webapp: launchUrl() }));
    return;
  }
  if (path === "/song" && req.method === "POST") {
    cors(res);
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
  if (req.method === "GET" || req.method === "HEAD") {
    serveWeb(res, path, req.method === "HEAD");
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
