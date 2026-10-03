import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import http from "node:http";
import path from "node:path";
import {
  ALLOWED_UPDATES,
  WEBHOOK_PATH,
  createApp,
  isForThisBot,
  parseCommand,
  plainMessage,
  richBlocks,
  sameSecret,
  songDuration,
  validateInitData,
  webhookOrigin,
  webhookParams,
  webhookSecret,
} from "../bot/server.js";
import { createTelegram } from "../bot/telegram.js";
import { pickLang, texts } from "../bot/i18n.js";

const TOKEN = "123456:TEST-token";
const GH = "https://romastefale.github.io";
const ENV = { PUBLIC_URL: "https://mdjr.up.railway.app" };

// Independent implementation of the documented initData signing (for tests only).
function signInit(fields, token = TOKEN) {
  const params = new URLSearchParams(fields);
  const check = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(token).digest();
  params.set("hash", crypto.createHmac("sha256", secret).update(check).digest("hex"));
  return params.toString();
}

function initFor(user, extra = {}) {
  return signInit({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify(user), ...extra });
}

function fakeTelegram(overrides = {}) {
  const calls = [];
  return {
    calls,
    named: (method) => calls.filter((c) => c.method === method),
    async call(method, params = {}) {
      calls.push({ method, params });
      if (overrides[method]) return overrides[method](params);
      if (method === "getMe") return { ok: true, result: { id: 1, is_bot: true, username: "MDJRbot" } };
      return { ok: true, result: true };
    },
  };
}

async function startApp(options) {
  const volume = fs.mkdtempSync(path.join(os.tmpdir(), "mdjr-test-"));
  const app = createApp({ env: ENV, volume, log: () => {}, info: () => {}, ...options });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  return {
    app,
    base,
    async close() {
      if (app.server.listening) await new Promise((resolve) => app.server.close(resolve));
      fs.rmSync(volume, { recursive: true, force: true });
    },
  };
}

const privateMsg = (text, from = {}, extra = {}) => ({
  message_id: 1,
  from: { id: 42, is_bot: false, first_name: "Pi", language_code: "en", ...from },
  chat: { id: 42, type: "private" },
  text,
  ...(text.startsWith("/") ? { entities: [{ type: "bot_command", offset: 0, length: text.split(/\s/)[0].length }] } : {}),
  ...extra,
});

describe("i18n", () => {
  test("pickLang maps Portuguese tags to pt and falls back to English", () => {
    assert.equal(pickLang("pt-br"), "pt");
    assert.equal(pickLang("pt-BR"), "pt");
    assert.equal(pickLang("pt"), "pt");
    assert.equal(pickLang("en"), "en");
    assert.equal(pickLang("es"), "en");
    assert.equal(pickLang("ptx"), "en");
    assert.equal(pickLang(undefined), "en");
  });

  test("texts respect Bot API limits and both languages have the same commands", () => {
    for (const lang of ["en", "pt"]) {
      const tx = texts(lang);
      assert.ok(tx.description.length <= 512);
      assert.ok(tx.shortDescription.length <= 120);
      for (const c of tx.commands) {
        assert.match(c.command, /^[a-z0-9_]{1,32}$/);
        assert.ok(c.description.length >= 1 && c.description.length <= 256);
      }
    }
    assert.deepEqual(texts("en").commands.map((c) => c.command), texts("pt").commands.map((c) => c.command));
    assert.ok(texts("en").commands.some((c) => c.command === "help"));
  });
});

describe("helpers", () => {
  test("parseCommand uses the bot_command entity and keeps the @target", () => {
    assert.deepEqual(parseCommand(privateMsg("/Help@MDJRbot now")), { name: "help", target: "MDJRbot", args: "now" });
    assert.deepEqual(parseCommand(privateMsg("/start abc")), { name: "start", target: "", args: "abc" });
    assert.equal(parseCommand({ text: "hello" }), null);
  });

  test("isForThisBot compares the @username with getMe", () => {
    assert.equal(isForThisBot({ target: "" }, "MDJRbot"), true);
    assert.equal(isForThisBot({ target: "mdjrbot" }, "MDJRbot"), true);
    assert.equal(isForThisBot({ target: "OtherBot" }, "MDJRbot"), false);
    assert.equal(isForThisBot({ target: "MDJRbot" }, null), false);
  });

  test("validateInitData accepts signed data and fails closed", () => {
    const init = initFor({ id: 42, first_name: "Pi" });
    assert.equal(validateInitData(init, TOKEN).id, 42);
    assert.equal(validateInitData(init, ""), null, "no token => reject");
    assert.equal(validateInitData(init, "999:other"), null, "wrong token => reject");
    assert.equal(validateInitData(init.replace("Pi", "Px"), TOKEN), null, "tampered => reject");
    const old = signInit({ auth_date: String(Math.floor(Date.now() / 1000) - 90000), user: JSON.stringify({ id: 42 }) });
    assert.equal(validateInitData(old, TOKEN), null, "older than 24h => reject");
    const noUser = signInit({ auth_date: String(Math.floor(Date.now() / 1000)), chat: JSON.stringify({ id: -100 }) });
    assert.equal(validateInitData(noUser, TOKEN), null, "no user => reject");
  });

  test("songDuration reads the app filename", () => {
    assert.equal(songDuration("math-dj-1m00.mp3"), 60);
    assert.equal(songDuration("math-dj-20m00.mp3"), 1200);
    assert.equal(songDuration("math-dj-0m30.mp3"), 30);
    assert.equal(songDuration("song.mp3"), null);
  });

  test("replies render as rich blocks and as a plain fallback", () => {
    const reply = { title: "T", paragraphs: ["p"], list: ["/help — x"], buttons: [{ label: "Open", url: "https://a/" }] };
    const blocks = richBlocks(reply);
    assert.deepEqual(blocks[0], { type: "paragraph", text: [{ type: "bold", text: "T" }] });
    assert.equal(blocks.find((b) => b.type === "list").items.length, 1);
    assert.deepEqual(blocks.at(-1).buttons[0], { text: "Open", style: "success", web_app: { url: "https://a/" } });
    const plain = plainMessage(reply);
    assert.equal(plain.text, "T\n\np\n\n• /help — x");
    assert.deepEqual(plain.reply_markup.inline_keyboard, [[{ text: "Open", style: "success", web_app: { url: "https://a/" } }]]);
  });
});

describe("telegram client", () => {
  test("retries after 429 using parameters.retry_after and logs failures once", async () => {
    const waits = [];
    const logs = [];
    let n = 0;
    const tg = createTelegram(TOKEN, {
      sleep: async (ms) => waits.push(ms),
      log: (m) => logs.push(m),
      fetch: async () => ({
        status: 200,
        json: async () => (++n === 1
          ? { ok: false, error_code: 429, description: "Too Many Requests", parameters: { retry_after: 2 } }
          : { ok: true, result: true }),
      }),
    });
    assert.equal((await tg.call("sendMessage", {})).ok, true);
    assert.deepEqual(waits, [2000]);
    assert.equal(logs.length, 0);

    const failing = createTelegram(TOKEN, {
      log: (m) => logs.push(m),
      fetch: async () => ({ status: 400, json: async () => ({ ok: false, error_code: 400, description: "Bad Request" }) }),
    });
    assert.equal((await failing.call("sendMessage", {})).ok, false);
    assert.deepEqual(logs, ["telegram sendMessage: 400 Bad Request"]);
  });

  test("network errors become a failed response instead of throwing", async () => {
    const tg = createTelegram(TOKEN, { log: () => {}, fetch: async () => { throw new Error("down"); } });
    assert.deepEqual(await tg.call("getMe"), { ok: false, description: "Error: down" });
  });
});

describe("bot updates (private chat only)", () => {
  let ctx;
  let tg;
  before(async () => {
    tg = fakeTelegram();
    ctx = await startApp({ token: TOKEN, telegram: tg });
    await ctx.app.setup();
  });
  after(() => ctx.close());

  test("setup registers private-chat commands in en and pt, and descriptions", () => {
    assert.equal(ctx.app.state.username, "MDJRbot");
    assert.deepEqual(tg.named("deleteMyCommands")[0].params, {});
    const cmds = tg.named("setMyCommands").map((c) => c.params);
    assert.equal(cmds.length, 2);
    for (const c of cmds) assert.deepEqual(c.scope, { type: "all_private_chats" });
    assert.equal(cmds[0].language_code, undefined);
    assert.equal(cmds[1].language_code, "pt");
    assert.deepEqual(tg.named("setMyDescription").map((c) => c.params.language_code), [undefined, "pt"]);
    assert.deepEqual(tg.named("setMyShortDescription").map((c) => c.params.language_code), [undefined, "pt"]);
    assert.equal(tg.named("setChatMenuButton")[0].params.menu_button.type, "web_app");
  });

  test("/help answers in Portuguese for pt-br users", async () => {
    tg.calls.length = 0;
    await ctx.app.handleUpdate({ update_id: 1, message: privateMsg("/help", { language_code: "pt-br" }) });
    const [sent] = tg.named("sendRichMessage");
    assert.equal(sent.params.chat_id, 42);
    const all = JSON.stringify(sent.params.rich_message.blocks);
    assert.ok(all.includes("/help — esta mensagem"));
    assert.ok(all.includes("Abrir"));
  });

  test("/help@MDJRbot works, /help@OtherBot is ignored", async () => {
    tg.calls.length = 0;
    await ctx.app.handleUpdate({ update_id: 2, message: privateMsg("/help@MDJRbot") });
    await ctx.app.handleUpdate({ update_id: 3, message: privateMsg("/help@OtherBot") });
    assert.equal(tg.named("sendRichMessage").length, 1);
  });

  test("unknown commands and plain text get a helpful reply", async () => {
    tg.calls.length = 0;
    await ctx.app.handleUpdate({ update_id: 4, message: privateMsg("/nope") });
    await ctx.app.handleUpdate({ update_id: 5, message: privateMsg("hello") });
    const [unknown, plain] = tg.named("sendRichMessage").map((c) => JSON.stringify(c.params.rich_message.blocks));
    assert.ok(unknown.includes(texts("en").unknownCommand));
    assert.ok(plain.includes(texts("en").plainText));
  });

  test("replies stay in the same private topic", async () => {
    tg.calls.length = 0;
    await ctx.app.handleUpdate({ update_id: 6, message: privateMsg("/start", {}, { is_topic_message: true, message_thread_id: 7 }) });
    assert.equal(tg.named("sendRichMessage")[0].params.message_thread_id, 7);
  });

  test("group messages never run commands and the bot leaves the group once", async () => {
    tg.calls.length = 0;
    const group = { ...privateMsg("/start"), chat: { id: -500, type: "supergroup" } };
    await ctx.app.handleUpdate({ update_id: 7, message: group });
    await ctx.app.handleUpdate({ update_id: 8, message: { ...group, text: "/help" } });
    assert.equal(tg.named("sendRichMessage").length, 0);
    assert.equal(tg.named("sendMessage").length, 0);
    assert.deepEqual(tg.named("leaveChat").map((c) => c.params.chat_id), [-500]);
  });

  test("being added to a group or channel triggers leaveChat; private updates do not", async () => {
    tg.calls.length = 0;
    const update = (chat, status) => ({ my_chat_member: { chat, from: { id: 42 }, date: 0, old_chat_member: { status: "left" }, new_chat_member: { status, user: { id: 1 } } } });
    await ctx.app.handleUpdate(update({ id: -600, type: "group" }, "member"));
    await ctx.app.handleUpdate(update({ id: -700, type: "channel" }, "administrator"));
    await ctx.app.handleUpdate(update({ id: -800, type: "group" }, "left"));
    await ctx.app.handleUpdate(update({ id: 42, type: "private" }, "member"));
    assert.deepEqual(tg.named("leaveChat").map((c) => c.params.chat_id), [-600, -700]);
  });

  test("messages from other bots are ignored", async () => {
    tg.calls.length = 0;
    await ctx.app.handleUpdate({ update_id: 9, message: privateMsg("/help", { is_bot: true }) });
    assert.equal(tg.calls.length, 0);
  });
});

describe("sendRichMessage fallback", () => {
  test("falls back to sendMessage with an inline web_app keyboard", async () => {
    const tg = fakeTelegram({ sendRichMessage: () => ({ ok: false, error_code: 400, description: "Bad Request" }) });
    const ctx = await startApp({ token: TOKEN, telegram: tg });
    try {
      await ctx.app.handleUpdate({ update_id: 1, message: privateMsg("/start") });
      const [fallback] = tg.named("sendMessage");
      assert.equal(fallback.params.chat_id, 42);
      assert.ok(fallback.params.text.includes(texts("en").tagline));
      assert.equal(fallback.params.reply_markup.inline_keyboard[0][0].web_app.url, "https://mdjr.up.railway.app/?v=36");
      assert.deepEqual(fallback.params.link_preview_options, { is_disabled: true });
    } finally {
      await ctx.close();
    }
  });

  test("does not fall back when the user blocked the bot (403)", async () => {
    const tg = fakeTelegram({ sendRichMessage: () => ({ ok: false, error_code: 403, description: "Forbidden" }) });
    const ctx = await startApp({ token: TOKEN, telegram: tg });
    try {
      await ctx.app.handleUpdate({ update_id: 1, message: privateMsg("/start") });
      assert.equal(tg.named("sendMessage").length, 0);
    } finally {
      await ctx.close();
    }
  });
});

describe("HTTP routes", () => {
  describe("without BOT_TOKEN (fail closed)", () => {
    let ctx;
    before(async () => { ctx = await startApp({ token: "", telegram: fakeTelegram() }); });
    after(() => ctx.close());

    test("/drafts answers 503 even with initData signed by an empty key", async () => {
      const forged = initFor({ id: 42 }, {});
      const forgedEmpty = signInit({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: 42 }) }, "");
      for (const init of [forged, forgedEmpty, ""]) {
        const get = await fetch(`${ctx.base}/drafts`, { headers: { "x-telegram-init-data": init } });
        assert.equal(get.status, 503);
        const post = await fetch(`${ctx.base}/drafts`, { method: "POST", headers: { "x-telegram-init-data": init }, body: "{}" });
        assert.equal(post.status, 503);
      }
      assert.equal((await fetch(`${ctx.base}/drafts/progress`)).status, 503);
    });

    test("/song answers 503", async () => {
      assert.equal((await fetch(`${ctx.base}/song`, { method: "POST", body: "x" })).status, 503);
    });

    test("/health stays up", async () => {
      assert.equal((await fetch(`${ctx.base}/health`)).status, 200);
    });
  });

  describe("with BOT_TOKEN", () => {
    let ctx;
    let tg;
    before(async () => {
      tg = fakeTelegram();
      ctx = await startApp({ token: TOKEN, telegram: tg });
    });
    after(() => ctx.close());

    test("/health sends CORS for GitHub Pages and hides bot details", async () => {
      const res = await fetch(`${ctx.base}/health`, { headers: { origin: GH } });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("access-control-allow-origin"), GH);
      assert.match(res.headers.get("vary") || "", /origin/i);
      const body = await res.json();
      assert.deepEqual(Object.keys(body).sort(), ["ok", "service", "webapp"]);
      assert.equal(new URL(body.webapp).searchParams.get("v"), "36");
      assert.equal(new URL(body.webapp).origin, "https://mdjr.up.railway.app");
    });

    test("unknown origins get no CORS header (incl. preflight)", async () => {
      const res = await fetch(`${ctx.base}/health`, { headers: { origin: "https://evil.example" } });
      assert.equal(res.headers.get("access-control-allow-origin"), null);
      const pre = await fetch(`${ctx.base}/drafts`, { method: "OPTIONS", headers: { origin: "https://evil.example" } });
      assert.equal(pre.status, 204);
      assert.equal(pre.headers.get("access-control-allow-origin"), null);
      const ok = await fetch(`${ctx.base}/drafts`, { method: "OPTIONS", headers: { origin: GH } });
      assert.equal(ok.headers.get("access-control-allow-origin"), GH);
      assert.match(ok.headers.get("access-control-allow-headers"), /x-telegram-init-data/);
    });

    test("/drafts requires valid initData with a user", async () => {
      assert.equal((await fetch(`${ctx.base}/drafts`)).status, 401);
      const chatOnly = signInit({ auth_date: String(Math.floor(Date.now() / 1000)), chat: JSON.stringify({ id: -100 }) });
      assert.equal((await fetch(`${ctx.base}/drafts`, { headers: { "x-telegram-init-data": chatOnly } })).status, 401);
    });

    test("/drafts saves, lists and reads per user", async () => {
      const init = initFor({ id: 42 });
      const headers = { "x-telegram-init-data": init, "content-type": "application/json" };
      const save = await fetch(`${ctx.base}/drafts`, { method: "POST", headers, body: JSON.stringify({ name: "Beat", rows: [{ y: "sin(t)", on: true }] }) });
      assert.equal(save.status, 200);
      const { id } = await save.json();
      assert.match(id, /^[a-f0-9]{8}$/);
      const list = await (await fetch(`${ctx.base}/drafts`, { headers })).json();
      assert.deepEqual(list.map((d) => d.name), ["Beat"]);
      const one = await (await fetch(`${ctx.base}/drafts/${id}`, { headers })).json();
      assert.equal(one.rows[0].y, "sin(t)");
      const other = await (await fetch(`${ctx.base}/drafts`, { headers: { "x-telegram-init-data": initFor({ id: 43 }) } })).json();
      assert.deepEqual(other, []);
    });

    test("/drafts rejects bodies over 100 KB while reading", async () => {
      const res = await fetch(`${ctx.base}/drafts/progress`, {
        method: "POST",
        headers: { "x-telegram-init-data": initFor({ id: 42 }), "content-type": "application/json" },
        body: JSON.stringify({ name: "x".repeat(120_000) }),
      });
      assert.equal(res.status, 413);
    });

    test("/drafts also stops chunked bodies (no content-length) at 100 KB", async () => {
      const { port } = new URL(ctx.base);
      const status = await new Promise((resolve, reject) => {
        const req = http.request({ host: "127.0.0.1", port, path: "/drafts/progress", method: "POST", headers: { "x-telegram-init-data": initFor({ id: 42 }), "transfer-encoding": "chunked" } }, (res) => {
          res.resume();
          resolve(res.statusCode);
        });
        req.on("error", reject);
        for (let i = 0; i < 12; i++) req.write("x".repeat(10_000));
        req.end();
      });
      assert.equal(status, 413);
    });

    test("/song sends audio to the user's private chat, never to a group", async () => {
      tg.calls.length = 0;
      const init = initFor({ id: 42, language_code: "pt-br" }, { chat: JSON.stringify({ id: -100123, type: "supergroup" }) });
      const res = await fetch(`${ctx.base}/song`, {
        method: "POST",
        headers: { "x-telegram-init-data": init, "x-filename": "math-dj-1m00.mp3", "content-type": "audio/mpeg" },
        body: new Uint8Array([0xff, 0xfb, 0x90, 0x00]),
      });
      assert.equal(res.status, 200);
      assert.deepEqual(tg.calls.map((c) => c.method), ["sendChatAction", "sendAudio"]);
      assert.deepEqual(tg.calls[0].params, { chat_id: 42, action: "upload_document" });
      const form = tg.calls[1].params;
      assert.ok(form instanceof FormData);
      assert.equal(form.get("chat_id"), "42");
      assert.equal(form.get("performer"), "MDJR");
      assert.equal(form.get("title"), "Math DJ 1:00");
      assert.equal(form.get("duration"), "60");
      assert.equal(form.get("caption"), texts("pt").songCaption);
      assert.equal(form.get("audio").name, "math-dj-1m00.mp3");
      assert.equal(form.get("audio").size, 4);
    });

    test("/song rejects missing initData and empty bodies", async () => {
      assert.equal((await fetch(`${ctx.base}/song`, { method: "POST", body: "x" })).status, 401);
      const res = await fetch(`${ctx.base}/song`, { method: "POST", headers: { "x-telegram-init-data": initFor({ id: 42 }) } });
      assert.equal(res.status, 400);
    });

    test("/song reports Telegram failures as 502", async () => {
      const failing = fakeTelegram({ sendAudio: () => ({ ok: false, error_code: 403, description: "Forbidden" }) });
      const c2 = await startApp({ token: TOKEN, telegram: failing });
      try {
        const res = await fetch(`${c2.base}/song`, { method: "POST", headers: { "x-telegram-init-data": initFor({ id: 42 }) }, body: "abc" });
        assert.equal(res.status, 502);
      } finally {
        await c2.close();
      }
    });

    test("static files and path traversal", async () => {
      assert.equal((await fetch(`${ctx.base}/`)).status, 200);
      assert.equal((await fetch(`${ctx.base}/manifest.webmanifest`)).headers.get("content-type"), "application/manifest+json");
      assert.equal((await fetch(`${ctx.base}/%2e%2e/package.json`)).status, 404);
    });
  });
});

describe("webhook configuration", () => {
  test("derived secret is stable, per token and inside the allowed charset", () => {
    const a = webhookSecret(TOKEN, {});
    assert.equal(a, webhookSecret(TOKEN, {}));
    assert.match(a, /^[A-Za-z0-9_-]{1,256}$/);
    assert.equal(a.length, 64);
    assert.notEqual(a, webhookSecret("999:other", {}));
    assert.ok(!a.includes(TOKEN.split(":")[1]), "secret does not contain the token");
    assert.equal(webhookSecret("", {}), "");
  });

  test("WEBHOOK_SECRET is used when valid, ignored when invalid", () => {
    assert.equal(webhookSecret(TOKEN, { WEBHOOK_SECRET: "my_Secret-1" }), "my_Secret-1");
    assert.equal(webhookSecret(TOKEN, { WEBHOOK_SECRET: "bad secret!" }), webhookSecret(TOKEN, {}));
    assert.equal(webhookSecret(TOKEN, { WEBHOOK_SECRET: "x".repeat(257) }), webhookSecret(TOKEN, {}));
  });

  test("sameSecret compares exactly", () => {
    assert.equal(sameSecret("abc", "abc"), true);
    assert.equal(sameSecret("abd", "abc"), false);
    assert.equal(sameSecret("abcd", "abc"), false);
    assert.equal(sameSecret(undefined, "abc"), false);
    assert.equal(sameSecret("", ""), false);
  });

  test("webhookOrigin follows PUBLIC_URL / RAILWAY_PUBLIC_DOMAIN and is null locally", () => {
    assert.equal(webhookOrigin({ PUBLIC_URL: "https://x.example/" }), "https://x.example");
    assert.equal(webhookOrigin({ RAILWAY_PUBLIC_DOMAIN: "mdjr.up.railway.app" }), "https://mdjr.up.railway.app");
    assert.equal(webhookOrigin({ RAILWAY_ENVIRONMENT_ID: "e1" }), "https://mdjr.up.railway.app");
    assert.equal(webhookOrigin({}), null);
    assert.equal(webhookOrigin({ PUBLIC_URL: "http://localhost:3000" }), null, "webhooks need HTTPS");
  });

  test("setWebhook params: url, secret_token, allowed_updates, no drop_pending_updates", () => {
    const params = webhookParams(TOKEN, { RAILWAY_PUBLIC_DOMAIN: "mdjr.up.railway.app" });
    assert.deepEqual(params, {
      url: `https://mdjr.up.railway.app${WEBHOOK_PATH}`,
      secret_token: webhookSecret(TOKEN, {}),
      allowed_updates: ["message", "my_chat_member"],
    });
    assert.equal("drop_pending_updates" in params, false);
    assert.deepEqual(ALLOWED_UPDATES, ["message", "my_chat_member"]);
    assert.equal(webhookParams(TOKEN, {}), null);
    assert.equal(webhookParams("", { RAILWAY_PUBLIC_DOMAIN: "mdjr.up.railway.app" }), null);
  });
});

describe("start()", () => {
  test("sets the webhook (and never polls) when a public URL exists", async () => {
    const tg = fakeTelegram();
    const env = { RAILWAY_PUBLIC_DOMAIN: "mdjr.up.railway.app" };
    const ctx = await startApp({ token: TOKEN, telegram: tg, env });
    try {
      assert.equal(await ctx.app.start(), "webhook");
      const [set] = tg.named("setWebhook");
      assert.deepEqual(set.params, webhookParams(TOKEN, env));
      assert.equal(tg.named("getUpdates").length, 0);
      assert.equal(tg.named("deleteWebhook").length, 0);
      assert.ok(tg.named("setMyCommands").length === 2, "PR #1 setup still runs");
    } finally {
      await ctx.close();
    }
  });

  test("retries setWebhook until it succeeds", async () => {
    let n = 0;
    const tg = fakeTelegram({ setWebhook: () => (++n === 1 ? { ok: false, error_code: 502 } : { ok: true, result: true }) });
    const ctx = await startApp({ token: TOKEN, telegram: tg, env: { PUBLIC_URL: "https://mdjr.up.railway.app" } });
    try {
      // real timers: the first retry waits 2 s
      assert.equal(await ctx.app.start(), "webhook");
      assert.equal(tg.named("setWebhook").length, 2);
    } finally {
      await ctx.close();
    }
  });

  test("without a public URL: no webhook, no silent polling, clear log", async () => {
    const tg = fakeTelegram();
    const logs = [];
    const ctx = await startApp({ token: TOKEN, telegram: tg, env: {}, log: (...m) => logs.push(m.join(" ")) });
    try {
      assert.equal(await ctx.app.start(), "off");
      assert.equal(tg.named("setWebhook").length, 0);
      assert.equal(tg.named("getUpdates").length, 0);
      assert.ok(logs.some((l) => l.includes("USE_POLLING=1")));
    } finally {
      await ctx.close();
    }
  });

  test("USE_POLLING=1 deletes the webhook first, then polls and handles updates", async () => {
    let ctx;
    let polls = 0;
    const tg = fakeTelegram({
      getUpdates: () => {
        polls += 1;
        if (polls === 1) return { ok: true, result: [{ update_id: 10, message: privateMsg("/help") }] };
        ctx.app.state.stopping = true;
        return { ok: true, result: [] };
      },
    });
    ctx = await startApp({ token: TOKEN, telegram: tg, env: { USE_POLLING: "1" } });
    try {
      assert.equal(await ctx.app.start(), "polling");
      await ctx.app.state.polling;
      const order = tg.calls.map((c) => c.method).filter((m) => ["deleteWebhook", "getUpdates"].includes(m));
      assert.deepEqual(order, ["deleteWebhook", "getUpdates", "getUpdates"]);
      assert.deepEqual(tg.named("deleteWebhook")[0].params, {});
      assert.deepEqual(tg.named("getUpdates")[0].params.allowed_updates, ALLOWED_UPDATES);
      assert.equal(tg.named("sendRichMessage").length, 1);
      assert.equal(tg.named("setWebhook").length, 0);
    } finally {
      await ctx.close();
    }
  });

  test("without BOT_TOKEN nothing is called", async () => {
    const tg = fakeTelegram();
    const ctx = await startApp({ token: "", telegram: tg, env: { RAILWAY_PUBLIC_DOMAIN: "mdjr.up.railway.app" } });
    try {
      assert.equal(await ctx.app.start(), "off");
      assert.equal(tg.calls.length, 0);
    } finally {
      await ctx.close();
    }
  });
});

describe("webhook route", () => {
  let ctx;
  let tg;
  let release;
  const SECRET = webhookSecret(TOKEN, ENV);
  const post = (body, headers = {}) => fetch(`${ctx.base}${WEBHOOK_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": SECRET, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

  before(async () => {
    tg = fakeTelegram();
    ctx = await startApp({ token: TOKEN, telegram: tg });
  });
  after(() => ctx.close());

  test("correct secret: 200 with an empty body, update handled by the bot", async () => {
    tg.calls.length = 0;
    const res = await post({ update_id: 100, message: privateMsg("/help", { language_code: "pt-br" }) });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "");
    await ctx.app.idle();
    const [sent] = tg.named("sendRichMessage");
    assert.equal(sent.params.chat_id, 42);
    assert.ok(JSON.stringify(sent.params.rich_message.blocks).includes("esta mensagem"));
  });

  test("answers before the handler finishes", async () => {
    tg.calls.length = 0;
    let started;
    const handlerStarted = new Promise((resolve) => { started = resolve; });
    const slow = fakeTelegram({
      sendRichMessage: () => new Promise((resolve) => { started(); release = () => resolve({ ok: true }); }),
    });
    const c2 = await startApp({ token: TOKEN, telegram: slow });
    try {
      const res = await fetch(`${c2.base}${WEBHOOK_PATH}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": SECRET },
        body: JSON.stringify({ update_id: 1, message: privateMsg("/start") }),
      });
      assert.equal(res.status, 200);
      await handlerStarted;
      assert.equal(slow.named("sendRichMessage").length, 1, "handler is still running after the 200");
      release();
      await c2.app.idle();
    } finally {
      await c2.close();
    }
  });

  test("wrong or missing secret is rejected with 401 and not handled", async () => {
    tg.calls.length = 0;
    assert.equal((await post({ update_id: 101, message: privateMsg("/help") }, { "x-telegram-bot-api-secret-token": "wrong" })).status, 401);
    const missing = await fetch(`${ctx.base}${WEBHOOK_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ update_id: 102, message: privateMsg("/help") }),
    });
    assert.equal(missing.status, 401);
    await ctx.app.idle();
    assert.equal(tg.calls.length, 0);
  });

  test("non-POST is rejected (405 with Allow: POST)", async () => {
    const res = await fetch(`${ctx.base}${WEBHOOK_PATH}`, { headers: { "x-telegram-bot-api-secret-token": SECRET } });
    assert.equal(res.status, 405);
    assert.equal(res.headers.get("allow"), "POST");
    const anon = await fetch(`${ctx.base}${WEBHOOK_PATH}`);
    assert.equal(anon.status, 401, "without the secret even GET learns nothing");
  });

  test("non-JSON, invalid JSON and updates without update_id are rejected", async () => {
    assert.equal((await post("{}", { "content-type": "text/plain" })).status, 415);
    assert.equal((await post("{not json")).status, 400);
    assert.equal((await post({ message: {} })).status, 400);
  });

  test("bodies over 1 MB are rejected with 413", async () => {
    const res = await post({ update_id: 103, message: privateMsg("x".repeat(1024 * 1024 + 10)) });
    assert.equal(res.status, 413);
  });

  test("the same update_id is handled once", async () => {
    tg.calls.length = 0;
    const update = { update_id: 104, message: privateMsg("/start") };
    assert.equal((await post(update)).status, 200);
    assert.equal((await post(update)).status, 200);
    await ctx.app.idle();
    assert.equal(tg.named("sendRichMessage").length, 1);
  });

  test("handler errors still answer 200 (no Telegram retries) and are logged", async () => {
    const logs = [];
    const broken = fakeTelegram({ sendRichMessage: () => { throw new Error("boom"); } });
    const c2 = await startApp({ token: TOKEN, telegram: broken, log: (...m) => logs.push(m.join(" ")) });
    try {
      const res = await fetch(`${c2.base}${WEBHOOK_PATH}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": SECRET },
        body: JSON.stringify({ update_id: 1, message: privateMsg("/start") }),
      });
      assert.equal(res.status, 200);
      await c2.app.idle();
      assert.ok(logs.some((l) => l.includes("boom")));
    } finally {
      await c2.close();
    }
  });

  test("group updates via webhook still never run commands (PR #1 behaviour)", async () => {
    tg.calls.length = 0;
    const group = { ...privateMsg("/start"), chat: { id: -900, type: "group" } };
    assert.equal((await post({ update_id: 105, message: group })).status, 200);
    await ctx.app.idle();
    assert.deepEqual(tg.calls.map((c) => c.method), ["leaveChat"]);
  });

  test("without BOT_TOKEN the webhook answers 503", async () => {
    const c2 = await startApp({ token: "", telegram: fakeTelegram() });
    try {
      const res = await fetch(`${c2.base}${WEBHOOK_PATH}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      assert.equal(res.status, 503);
    } finally {
      await c2.close();
    }
  });
});

describe("shutdown", () => {
  test("stop() waits for in-flight updates and closes the server", async () => {
    let finish;
    const tg = fakeTelegram({ sendRichMessage: () => new Promise((resolve) => { finish = () => resolve({ ok: true }); }) });
    const ctx = await startApp({ token: TOKEN, telegram: tg });
    const job = ctx.app.dispatch({ update_id: 1, message: privateMsg("/start") });
    let stopped = false;
    const stopping = ctx.app.stop().then(() => { stopped = true; });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(stopped, false, "still waiting for the update");
    finish();
    await job;
    await stopping;
    assert.equal(stopped, true);
    assert.equal(ctx.app.server.listening, false);
    await ctx.close();
  });
});
