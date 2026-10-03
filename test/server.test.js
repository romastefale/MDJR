// Behavioural conformance tests: the real server on a local port, real HTTP, and the real Bot API
// client (bot/telegram.js) talking to a strict fake of the Bot API (test/fake-bot-api.js) that
// fails on anything the official docs do not allow. Every test cites where its expected behaviour
// comes from: a section of the official docs or one of Pi's decisions — never the current code.
//
// Docs (fetched 2026-10-03): Bot API 10.3 https://core.telegram.org/bots/api,
// https://core.telegram.org/bots/features, https://core.telegram.org/bots/webapps

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createApp } from "../bot/server.js";
import { createTelegram } from "../bot/telegram.js";
import { createFakeBotApi } from "./fake-bot-api.js";

const TOKEN = "123456:TEST-token";
const PUBLIC = "https://mdjr.up.railway.app";
const ENV = { PUBLIC_URL: PUBLIC };
const GH = "https://romastefale.github.io";
const USER = { id: 42, is_bot: false, first_name: "Pi", language_code: "en" };

// Independent implementation of the documented initData signature, for tests only:
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
function signInit(fields, token = TOKEN) {
  const params = new URLSearchParams(fields);
  const check = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(token).digest();
  params.set("hash", crypto.createHmac("sha256", secret).update(check).digest("hex"));
  return params.toString();
}
const now = () => String(Math.floor(Date.now() / 1000));
const initFor = (user, extra = {}, token = TOKEN) => signInit({ auth_date: now(), user: JSON.stringify(user), ...extra }, token);

let nextUpdateId = 1000;
const update = (body) => ({ update_id: nextUpdateId++, ...body });
// A text message as Telegram sends it: commands carry a "bot_command" entity at offset 0
// (https://core.telegram.org/bots/api#messageentity).
function message(text, { from = {}, chat = { id: 42, type: "private" }, ...extra } = {}) {
  const command = text.startsWith("/") ? text.split(/\s/)[0] : null;
  return {
    message_id: nextUpdateId,
    date: Math.floor(Date.now() / 1000),
    from: { ...USER, ...from },
    chat,
    text,
    ...(command ? { entities: [{ type: "bot_command", offset: 0, length: command.length }] } : {}),
    ...extra,
  };
}

async function boot({ env = ENV, token = TOKEN, fake = createFakeBotApi({ token: TOKEN }), start = true } = {}) {
  const lines = [];
  const sleeps = [];
  const telegram = createTelegram(token, { fetch: fake.fetch, sleep: async (ms) => { sleeps.push(ms); }, log: (l) => lines.push(l) });
  const volume = fs.mkdtempSync(path.join(os.tmpdir(), "mdjr-test-"));
  const sink = (...m) => lines.push(m.join(" "));
  const app = createApp({ token, telegram, env, volume, log: sink, info: sink });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const mode = start ? await app.start() : null;
  return {
    app, fake, base, lines, sleeps, mode,
    async close() {
      fake.close();
      app.state.stopping = true;
      if (app.server.listening) await app.stop();
      fs.rmSync(volume, { recursive: true, force: true });
    },
  };
}

// Sends an update through the registered webhook, waits for the bot, returns what it sent.
async function deliver(ctx, body) {
  ctx.fake.clear();
  const res = await ctx.fake.deliver(ctx.base, update(body));
  assert.equal(res.status, 200);
  await ctx.app.idle();
  return ctx.fake.calls.filter((c) => c.method.startsWith("send") || c.method === "leaveChat");
}
const say = (ctx, text, options) => deliver(ctx, { message: message(text, options) });

// What the user reads and taps, from a sendRichMessage or a sendMessage.
function textOf(call) {
  if (call.method === "sendMessage") return call.params.text;
  const out = [];
  const walk = (node) => {
    if (typeof node === "string") out.push(node);
    else if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) if (!["type", "url", "style", "align"].includes(k)) walk(v);
  };
  walk(call.params.rich_message.blocks);
  return out.join("\n");
}
function buttonsOf(call) {
  if (call.method === "sendMessage") return (call.params.reply_markup?.inline_keyboard || []).flat();
  return call.params.rich_message.blocks.filter((b) => b.type === "buttons").flatMap((b) => b.buttons);
}
// Fails instead of hanging when a promise never settles (e.g. the strict fake refused the call).
function within(promise, ms = 3000) {
  let timer;
  const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms); });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}
async function waitFor(check, ms = 3000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
function rawRequest(base, { method = "GET", path: p, headers = {}, body, chunks }) {
  const { port } = new URL(base);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: p, method, headers }, (res) => {
      res.resume();
      resolve(res);
      req.destroy();
    });
    req.on("error", (err) => (err.code === "ECONNRESET" || err.code === "EPIPE" ? null : reject(err)));
    for (const chunk of chunks || []) req.write(chunk);
    if (body !== undefined) req.end(body);
    else if (!headers["content-length"]) req.end();
    else req.flushHeaders(); // only the headers: the declared body never comes
  });
}

// =====================================================================================
describe("Bot setup (commands, descriptions, menu button)", () => {
  let ctx;
  before(async () => { ctx = await boot(); });
  after(() => ctx.close());

  // https://core.telegram.org/bots/features#global-commands (/start and /help must be supported)
  // https://core.telegram.org/bots/api#determining-list-of-commands
  // Decisão do Pi: bot só no chat privado
  test("private chats list /start, /help and /draft; groups get no command list at all", () => {
    const names = (list) => list.map((c) => c.command).sort();
    assert.deepEqual(names(ctx.fake.commandsFor({ chat: "private", language: "en" })), ["draft", "help", "start"]);
    assert.deepEqual(names(ctx.fake.commandsFor({ chat: "private", language: "pt-br" })), ["draft", "help", "start"]);
    // The older default-scope list (/start, /draft) would otherwise still show in groups.
    assert.deepEqual(ctx.fake.commandsFor({ chat: "group", chatId: -100, userId: 42 }), []);
    assert.deepEqual(ctx.fake.commandsFor({ chat: "group", chatId: -100, userId: 42, admin: true }), []);
    ctx.fake.assertConforms();
  });

  // https://core.telegram.org/bots/features#language-support ("Command lists can also be specified
  // for individual languages"; fall back to English) — https://core.telegram.org/bots/api#setmycommands
  test("command descriptions are localized for pt and default to English for everyone else", () => {
    const pt = ctx.fake.commandsFor({ chat: "private", language: "pt" });
    const en = ctx.fake.commandsFor({ chat: "private", language: "en" });
    assert.deepEqual(ctx.fake.commandsFor({ chat: "private", language: "es" }), en);
    assert.deepEqual(ctx.fake.commandsFor({ chat: "private", language: "" }), en);
    assert.notDeepEqual(pt.map((c) => c.description), en.map((c) => c.description));
  });

  // https://core.telegram.org/bots/api#setmydescription, https://core.telegram.org/bots/api#setmyshortdescription
  // https://core.telegram.org/bots/features#language-support ("The bot's Name, Description and About
  // text can be natively localized")
  test("description and short description exist for all users and in a dedicated pt version", () => {
    for (const map of [ctx.fake.state.descriptions, ctx.fake.state.shortDescriptions]) {
      assert.ok(map.get(""), "default (all languages) set");
      assert.ok(map.get("pt"), "pt set");
      assert.notEqual(map.get(""), map.get("pt"));
    }
  });

  // https://core.telegram.org/bots/api#setchatmenubutton, https://core.telegram.org/bots/api#menubuttonwebapp
  // https://core.telegram.org/bots/webapps#launching-mini-apps-from-the-menu-button
  test("the default menu button opens the Mini App over HTTPS at the public origin, same URL as /health", async () => {
    const button = ctx.fake.state.menuButtons.get("default");
    assert.equal(button.type, "web_app");
    assert.equal(new URL(button.web_app.url).origin, PUBLIC);
    const health = await (await fetch(`${ctx.base}/health`)).json();
    assert.equal(button.web_app.url, health.webapp);
  });
});

// =====================================================================================
describe("Private chat", () => {
  let ctx;
  let miniApp;
  before(async () => {
    ctx = await boot();
    miniApp = ctx.fake.state.menuButtons.get("default").web_app.url;
  });
  after(() => ctx.close());

  // https://core.telegram.org/bots/features#global-commands ("/start - begins the interaction with
  // the user, like sending an introductory message")
  test("/start sends an introductory message with a button that opens the Mini App", async () => {
    const [sent, ...rest] = await say(ctx, "/start");
    assert.equal(rest.length, 0);
    assert.equal(sent.method, "sendRichMessage");
    assert.equal(sent.params.chat_id, 42);
    assert.ok(textOf(sent).length > 0);
    assert.deepEqual(buttonsOf(sent).map((b) => b.web_app?.url), [miniApp]);
    ctx.fake.assertConforms();
  });

  // https://core.telegram.org/bots/features#global-commands ("/help - returns a help message, like a
  // short text about what your bot can do and a list of commands")
  test("/help lists every command registered for that user's language", async () => {
    for (const language_code of ["en", "pt-br"]) {
      const [sent] = await say(ctx, "/help", { from: { language_code } });
      const text = textOf(sent);
      for (const { command } of ctx.fake.commandsFor({ chat: "private", language: language_code })) {
        assert.ok(text.includes(`/${command}`), `/${command} missing from /help (${language_code})`);
      }
    }
    ctx.fake.assertConforms();
  });

  // https://core.telegram.org/bots/features#language-support ("The language_code is an optional field
  // ... your code should always fall back to ... English")
  test("replies follow language_code: pt-br gets Portuguese, missing or other languages get English", async () => {
    const reply = async (from) => textOf((await say(ctx, "/help", { from }))[0]);
    const en = await reply({ language_code: "en" });
    const pt = await reply({ language_code: "pt-br" });
    assert.notEqual(pt, en);
    assert.equal(await reply({ language_code: "pt" }), pt);
    assert.equal(await reply({ language_code: undefined }), en);
    assert.equal(await reply({ language_code: "es" }), en);
  });

  // https://core.telegram.org/bots/api#messageentity ("bot_command" entity), https://core.telegram.org/bots/features#privacy-mode
  // ("Commands explicitly meant for them (e.g., /command@this_bot)"); the username comes from getMe
  test("/help@<our username> is answered, /help@OtherBot is not", async () => {
    const username = ctx.fake.state.bot.username;
    assert.equal((await say(ctx, `/help@${username}`)).length, 1);
    assert.equal((await say(ctx, `/help@${username.toLowerCase()}`)).length, 1);
    assert.equal((await say(ctx, "/help@OtherBot")).length, 0);
  });

  // Decisão do Pi (2026-10-03): comando desconhecido e texto solto são ignorados, sem resposta
  // ("ele tem os comandos dele já": /start, /help, /draft) — https://core.telegram.org/bots/features#command-scopes
  // ("they may contain commands that don't exist at all in your bot. Your backend should always verify
  // that received commands are valid")
  test("unknown commands and plain text are ignored silently; the bot's own commands still answer", async () => {
    for (const text of ["/nope", "/settings", "/start2", "hello", "/ start", "  "]) {
      assert.deepEqual(await say(ctx, text), [], `"${text}" got a reply`);
    }
    assert.deepEqual(await say(ctx, "olá", { from: { language_code: "pt-br" } }), []);
    for (const text of ["/start", "/help", "/draft", "/HELP", "/start payload"]) {
      assert.equal((await say(ctx, text)).length, 1, `"${text}" got no reply`);
    }
    ctx.fake.assertConforms();
  });

  // https://core.telegram.org/bots/api#sendrichmessage (message_thread_id: "for forum supergroups and
  // private chats of bots with forum topic mode enabled"), https://core.telegram.org/bots/features#topics-in-private-chats
  test("a message in a private-chat topic is answered in the same topic", async () => {
    const [sent] = await say(ctx, "/start", { is_topic_message: true, message_thread_id: 7 });
    assert.equal(sent.params.message_thread_id, 7);
    const [plain] = await say(ctx, "/start");
    assert.equal(plain.params.message_thread_id, undefined);
  });

  // Decisão do Pi: bot só no chat privado (no group runs commands; the bot leaves) — https://core.telegram.org/bots/api#leavechat
  test("group and supergroup messages never get a reply and the bot leaves each chat once", async () => {
    const group = { id: -500, type: "supergroup" };
    const first = await say(ctx, "/start", { chat: group });
    const second = await say(ctx, "/help", { chat: group });
    assert.deepEqual(first.map((c) => [c.method, c.params.chat_id]), [["leaveChat", -500]]);
    assert.deepEqual(second, []);
    const small = await say(ctx, "hello", { chat: { id: -501, type: "group" } });
    assert.deepEqual(small.map((c) => c.method), ["leaveChat"]);
    ctx.fake.assertConforms();
  });

  // https://core.telegram.org/bots/api#chatmemberupdated, https://core.telegram.org/bots/api#update (my_chat_member)
  // Decisão do Pi: bot só no chat privado
  test("being added to a group or channel makes the bot leave; leaving or private changes do nothing", async () => {
    const change = (chat, status) => ({ my_chat_member: { chat, from: { id: 42, is_bot: false, first_name: "Pi" }, date: 0, old_chat_member: { status: "left", user: { id: 1, is_bot: true, first_name: "Math DJ" } }, new_chat_member: { status, user: { id: 1, is_bot: true, first_name: "Math DJ" } } } });
    assert.deepEqual((await deliver(ctx, change({ id: -600, type: "group" }, "member"))).map((c) => c.params.chat_id), [-600]);
    assert.deepEqual((await deliver(ctx, change({ id: -700, type: "channel" }, "administrator"))).map((c) => c.params.chat_id), [-700]);
    assert.deepEqual(await deliver(ctx, change({ id: -800, type: "group" }, "left")), []);
    assert.deepEqual(await deliver(ctx, change({ id: 42, type: "private" }, "member")), []);
    ctx.fake.assertConforms();
  });

  // https://core.telegram.org/bots/features#loop-prevention-requirements ("Your bot must remain stable
  // even if another bot intentionally responds instantly and continuously")
  test("messages from other bots get no reply", async () => {
    assert.deepEqual(await say(ctx, "/help", { from: { is_bot: true } }), []);
    assert.deepEqual(await say(ctx, "hello", { from: { is_bot: true } }), []);
  });
});

// =====================================================================================
describe("Delivery problems", () => {
  // Escolha técnica do PR #1: sendRichMessage só existe desde a Bot API 10.1
  // (https://core.telegram.org/bots/api#sendrichmessage); se ele for recusado, a mesma resposta vai por
  // https://core.telegram.org/bots/api#sendmessage com https://core.telegram.org/bots/api#inlinekeyboardbutton (web_app)
  test("when sendRichMessage is refused, the same reply goes out as sendMessage with an inline web_app button", async () => {
    const ctx = await boot();
    try {
      const miniApp = ctx.fake.state.menuButtons.get("default").web_app.url;
      const [rich] = await say(ctx, "/start", { is_topic_message: true, message_thread_id: 3 });
      ctx.fake.on("sendRichMessage", () => ({ ok: false, error_code: 400, description: "Bad Request: rich messages are not supported" }));
      const sent = await say(ctx, "/start", { is_topic_message: true, message_thread_id: 3 });
      assert.deepEqual(sent.map((c) => c.method), ["sendRichMessage", "sendMessage"]);
      const plain = sent[1];
      assert.equal(plain.params.chat_id, 42);
      assert.equal(plain.params.message_thread_id, 3);
      assert.deepEqual(buttonsOf(plain).map((b) => b.web_app?.url), [miniApp]);
      const words = textOf({ ...rich, params: { rich_message: { blocks: rich.params.rich_message.blocks.filter((b) => b.type !== "buttons") } } });
      for (const line of words.split("\n")) assert.ok(plain.params.text.includes(line), `fallback lost "${line}"`);
      ctx.fake.assertConforms();
    } finally {
      await ctx.close();
    }
  });

  // https://core.telegram.org/bots/api#responseparameters ("retry_after: ... the number of seconds left
  // to wait before the request can be repeated")
  test("a 429 with retry_after is waited out and the reply is sent once, without an error log", async () => {
    const ctx = await boot();
    try {
      let n = 0;
      ctx.fake.on("sendRichMessage", () => (++n === 1 ? { ok: false, error_code: 429, description: "Too Many Requests: retry after 3", parameters: { retry_after: 3 } } : undefined));
      ctx.lines.length = 0;
      const sent = await say(ctx, "/start");
      assert.deepEqual(sent.map((c) => c.method), ["sendRichMessage", "sendRichMessage"]);
      assert.deepEqual(ctx.sleeps.filter((ms) => ms === 3000), [3000]);
      assert.deepEqual(ctx.lines, []);
    } finally {
      await ctx.close();
    }
  });

  // Decisão do Pi: logs nunca mostram o token — a failed Bot API call is logged once, redacted
  test("a failed Bot API call is logged once, with Telegram's description and without the token", async () => {
    const ctx = await boot();
    try {
      ctx.fake.on("sendRichMessage", () => ({ ok: false, error_code: 400, description: "Bad Request: chat not found" }));
      ctx.fake.on("sendMessage", () => ({ ok: false, error_code: 400, description: "Bad Request: chat not found" }));
      ctx.lines.length = 0;
      await say(ctx, "/start");
      assert.equal(ctx.lines.filter((l) => l.includes("sendRichMessage")).length, 1);
      assert.equal(ctx.lines.filter((l) => l.includes("sendMessage")).length, 1);
      assert.ok(ctx.lines.every((l) => l.includes("chat not found") && !l.includes(TOKEN) && !l.includes("TEST-token")));
    } finally {
      await ctx.close();
    }
  });
});

// =====================================================================================
describe("Webhook", () => {
  let ctx;
  before(async () => { ctx = await boot(); });
  after(() => ctx.close());

  // https://core.telegram.org/bots/api#setwebhook (HTTPS URL, supported port, secret_token,
  // allowed_updates) — https://core.telegram.org/bots/api#getupdates ("This method will not work if an
  // outgoing webhook is set up") — Decisão do Pi: webhook no lugar do polling em produção
  test("start() registers an HTTPS webhook with a secret and the handled update types, and never polls", () => {
    assert.equal(ctx.mode, "webhook");
    const hook = ctx.fake.state.webhook;
    assert.equal(new URL(hook.url).origin, PUBLIC);
    assert.ok(hook.secret_token);
    assert.deepEqual([...hook.allowed_updates].sort(), ["message", "my_chat_member"]);
    assert.equal(ctx.fake.named("getUpdates").length, 0);
    assert.equal(ctx.fake.named("deleteWebhook").length, 0);
    ctx.fake.assertConforms();
  });

  // https://core.telegram.org/bots/api#setwebhook ("the request will contain a header
  // “X-Telegram-Bot-Api-Secret-Token” with the secret token as content")
  test("only requests carrying the registered secret token are handled", async () => {
    const send = async (secret) => {
      ctx.fake.clear();
      const res = await ctx.fake.deliver(ctx.base, update({ message: message("/start") }), { secret });
      await ctx.app.idle();
      return { status: res.status, sent: ctx.fake.named("sendRichMessage").length };
    };
    assert.deepEqual(await send(undefined), { status: 200, sent: 1 });
    for (const bad of ["wrong", `${ctx.fake.state.webhook.secret_token}x`, ""]) {
      const { status, sent } = await send(bad);
      assert.ok(status >= 400 && status < 500, `secret "${bad}" got ${status}`);
      assert.equal(sent, 0);
    }
  });

  // https://core.telegram.org/bots/api#setwebhook ("we will send an HTTPS POST request to the specified
  // URL, containing a JSON-serialized Update")
  test("anything that is not a POSTed JSON Update is refused and not handled", async () => {
    const secret = ctx.fake.state.webhook.secret_token;
    const path = new URL(ctx.fake.state.webhook.url).pathname;
    const h = { "x-telegram-bot-api-secret-token": secret };
    ctx.fake.clear();
    const attempts = [
      fetch(`${ctx.base}${path}`, { headers: h }),
      fetch(`${ctx.base}${path}`, { method: "PUT", headers: { ...h, "content-type": "application/json" }, body: JSON.stringify(update({ message: message("/start") })) }),
      fetch(`${ctx.base}${path}`, { method: "POST", headers: { ...h, "content-type": "text/plain" }, body: JSON.stringify(update({ message: message("/start") })) }),
      fetch(`${ctx.base}${path}`, { method: "POST", headers: { ...h, "content-type": "application/json" }, body: "{not json" }),
      fetch(`${ctx.base}${path}`, { method: "POST", headers: { ...h, "content-type": "application/json" }, body: JSON.stringify({ message: message("/start") }) }),
    ];
    for (const res of await Promise.all(attempts)) assert.ok(res.status >= 400 && res.status < 500, `got ${res.status}`);
    await ctx.app.idle();
    assert.equal(ctx.fake.calls.length, 0);
    const get = await fetch(`${ctx.base}${path}`, { headers: h });
    assert.equal(get.status, 405);
    assert.equal(get.headers.get("allow"), "POST");
  });

  // https://core.telegram.org/bots/api#setwebhook ("In case of an unsuccessful request (a request with
  // response HTTP status code different from 2XY), we will repeat the request")
  test("the update is acknowledged with 2XX before slow Bot API calls finish", async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let started;
    const handling = new Promise((resolve) => { started = resolve; });
    ctx.fake.on("sendRichMessage", async () => { started(); await gate; });
    try {
      const res = await ctx.fake.deliver(ctx.base, update({ message: message("/start") }));
      assert.equal(res.status, 200);
      assert.equal(await res.text(), "");
      await within(handling);
    } finally {
      release();
      ctx.fake.off("sendRichMessage");
      await ctx.app.idle();
    }
    ctx.fake.assertConforms();
  });

  // https://core.telegram.org/bots/api#setwebhook (non-2XY responses are repeated): a bug while handling
  // one update must not make Telegram resend it forever
  test("an update that breaks the handler is still acknowledged with 2XX and the error is logged", async () => {
    ctx.lines.length = 0;
    const broken = { ...message("/start"), entities: "not-an-array" };
    const res = await ctx.fake.deliver(ctx.base, update({ message: broken }));
    assert.equal(res.status, 200);
    await ctx.app.idle();
    assert.ok(ctx.lines.some((l) => l.startsWith("update")));
  });

  // https://core.telegram.org/bots/api#update ("update_id ... allows you to ignore repeated updates")
  test("the same update delivered twice is handled once", async () => {
    const same = update({ message: message("/start") });
    ctx.fake.clear();
    assert.equal((await ctx.fake.deliver(ctx.base, same)).status, 200);
    assert.equal((await ctx.fake.deliver(ctx.base, same)).status, 200);
    await ctx.app.idle();
    assert.equal(ctx.fake.named("sendRichMessage").length, 1);
  });
});

// =====================================================================================
describe("Start modes", () => {
  // https://core.telegram.org/bots/api#getupdates ("This method will not work if an outgoing webhook is
  // set up"), https://core.telegram.org/bots/api#deletewebhook — Decisão do Pi: polling só para
  // desenvolvimento local (USE_POLLING=1)
  test("USE_POLLING=1 removes the webhook first, then receives and answers updates with getUpdates", async () => {
    const fake = createFakeBotApi({ token: TOKEN });
    fake.state.webhook = { url: `${PUBLIC}/telegram/webhook`, secret_token: "old" }; // left by production
    fake.queueUpdate(update({ message: message("/help") }));
    const ctx = await boot({ env: { USE_POLLING: "1" }, fake });
    try {
      assert.equal(ctx.mode, "polling");
      await waitFor(() => fake.named("sendRichMessage").length === 1);
      const order = fake.calls.map((c) => c.method).filter((m) => m === "deleteWebhook" || m === "getUpdates");
      assert.equal(order[0], "deleteWebhook");
      assert.ok(order.includes("getUpdates"));
      assert.equal(fake.state.webhook, null);
      assert.equal(fake.named("setWebhook").length, 0);
      fake.assertConforms();
    } finally {
      await ctx.close();
      await ctx.app.state.polling;
    }
  });

  // https://core.telegram.org/bots/api#setwebhook ("HTTPS URL"), https://core.telegram.org/bots/api#webappinfo
  // ("An HTTPS URL of a Web App") — Decisão do Pi: polling só para desenvolvimento local (USE_POLLING=1)
  // — Escolha técnica do PR #2: sem URL pública, avisar no log em vez de ficar mudo
  test("without a public HTTPS URL nothing receives updates, the log says how to run locally, Mini App links stay HTTPS", async () => {
    for (const env of [{}, { PUBLIC_URL: "http://localhost:3000" }]) {
      const ctx = await boot({ env });
      try {
        assert.equal(ctx.mode, "off");
        assert.equal(new URL(ctx.fake.state.menuButtons.get("default").web_app.url).protocol, "https:");
        assert.equal(ctx.fake.named("setWebhook").length, 0);
        assert.equal(ctx.fake.named("getUpdates").length, 0);
        assert.ok(ctx.lines.some((l) => l.includes("USE_POLLING=1")));
        ctx.fake.assertConforms();
      } finally {
        await ctx.close();
      }
    }
  });

  // https://docs.railway.com/reference/variables#railway-provided-variables (RAILWAY_PUBLIC_DOMAIN: "The
  // public service or customer domain"; RAILWAY_ENVIRONMENT_ID is always provided) — Escolha técnica do
  // PR #2: sem domínio informado, usar a origem que o Mini App já usa (https://mdjr.up.railway.app)
  test("on Railway without PUBLIC_URL the webhook uses RAILWAY_PUBLIC_DOMAIN, else the app's Railway origin", async () => {
    for (const [env, origin] of [[{ RAILWAY_PUBLIC_DOMAIN: "other.up.railway.app" }, "https://other.up.railway.app"], [{ RAILWAY_ENVIRONMENT_ID: "e1" }, PUBLIC]]) {
      const ctx = await boot({ env });
      try {
        assert.equal(ctx.mode, "webhook");
        assert.equal(new URL(ctx.fake.state.webhook.url).origin, origin);
        ctx.fake.assertConforms();
      } finally {
        await ctx.close();
      }
    }
  });

  // https://core.telegram.org/bots/api#setwebhook (secret_token: "1-256 characters. Only characters A-Z,
  // a-z, 0-9, _ and - are allowed") — Escolha técnica do PR #2: o segredo é derivado do token, então é o
  // mesmo a cada deploy sem configurar nada, e WEBHOOK_SECRET (opcional) tem prioridade se for válido
  test("the webhook secret survives restarts without configuration, differs per token, and WEBHOOK_SECRET overrides it", async () => {
    const secretOf = async (env, token = TOKEN) => {
      const fake = createFakeBotApi({ token });
      const ctx = await boot({ env, token, fake });
      try {
        fake.assertConforms();
        return { secret: fake.state.webhook.secret_token, lines: ctx.lines };
      } finally {
        await ctx.close();
      }
    };
    const a = (await secretOf(ENV)).secret;
    assert.equal((await secretOf(ENV)).secret, a);
    assert.notEqual((await secretOf(ENV, "999:other-token")).secret, a);
    assert.equal((await secretOf({ ...ENV, WEBHOOK_SECRET: "my_Secret-1" })).secret, "my_Secret-1");
    const invalid = await secretOf({ ...ENV, WEBHOOK_SECRET: "bad secret!" });
    assert.equal(invalid.secret, a, "an invalid WEBHOOK_SECRET is not sent to Telegram");
    assert.ok(invalid.lines.some((l) => l.includes("WEBHOOK_SECRET")));
  });

  // https://core.telegram.org/bots/api#responseparameters (retry_after)
  test("setWebhook rate-limited with 429 is retried after retry_after", async () => {
    const fake = createFakeBotApi({ token: TOKEN });
    let n = 0;
    fake.on("setWebhook", () => (++n === 1 ? { ok: false, error_code: 429, description: "Too Many Requests: retry after 5", parameters: { retry_after: 5 } } : undefined));
    const ctx = await boot({ fake });
    try {
      assert.equal(ctx.mode, "webhook");
      assert.ok(ctx.sleeps.includes(5000));
      assert.ok(fake.state.webhook);
    } finally {
      await ctx.close();
    }
  });

  // https://core.telegram.org/bots/api#making-requests (the token is part of every request URL: without it
  // there is no Bot API) and https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
  // (initData is checked with a key derived from the token: without it nothing can be verified)
  test("without BOT_TOKEN no Bot API call is made and the log says what is missing", async () => {
    const ctx = await boot({ token: "", env: { RAILWAY_PUBLIC_DOMAIN: "mdjr.up.railway.app" } });
    try {
      assert.equal(ctx.mode, "off");
      assert.equal(ctx.fake.calls.length, 0);
      assert.ok(ctx.lines.some((l) => l.includes("BOT_TOKEN")));
      const res = await fetch(`${ctx.base}/telegram/webhook`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      assert.equal(res.status, 503);
    } finally {
      await ctx.close();
    }
  });

  // https://core.telegram.org/bots/api#deletewebhook ("Use this method to remove webhook integration if
  // you decide to switch back to getUpdates") — Escolha técnica do PR #2: no deploy (SIGTERM → stop()) o
  // servidor termina os updates em andamento e não apaga o webhook, que a nova instância atende no mesmo endereço
  test("stop() waits for in-flight updates, closes the server and leaves the webhook registered", async () => {
    const ctx = await boot();
    let release;
    ctx.fake.on("sendRichMessage", () => new Promise((resolve) => { release = () => resolve(undefined); }));
    await ctx.fake.deliver(ctx.base, update({ message: message("/start") }));
    try {
      await waitFor(() => release);
    } catch (err) {
      ctx.fake.off("sendRichMessage");
      await ctx.close();
      ctx.fake.assertConforms();
      throw err;
    }
    let stopped = false;
    const stopping = ctx.app.stop().then(() => { stopped = true; });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(stopped, false, "still waiting for the update");
    release();
    await stopping;
    assert.equal(ctx.app.server.listening, false);
    assert.equal(ctx.fake.named("deleteWebhook").length, 0);
    assert.ok(ctx.fake.state.webhook);
    await ctx.close();
  });
});

// =====================================================================================
describe("Mini App API", () => {
  let ctx;
  before(async () => { ctx = await boot(); });
  after(() => ctx.close());
  const json = (init, body) => ({ method: "POST", headers: { "x-telegram-init-data": init, "content-type": "application/json" }, body: JSON.stringify(body) });

  // https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app (hash check; "you
  // can additionally check the auth_date field") — https://core.telegram.org/bots/webapps#webappinitdata
  test("/drafts only accepts initData signed with the bot token, fresh, and with a user", async () => {
    const status = async (init) => (await fetch(`${ctx.base}/drafts`, { headers: { "x-telegram-init-data": init } })).status;
    assert.equal(await status(initFor({ id: 42 })), 200);
    assert.equal(await status(""), 401);
    assert.equal(await status(initFor({ id: 42 }, {}, "999:other-token")), 401, "signed with another token");
    assert.equal(await status(initFor({ id: 42 }).replace("42", "43")), 401, "tampered");
    assert.equal(await status(new URLSearchParams({ auth_date: now(), user: JSON.stringify({ id: 42 }) }).toString()), 401, "no hash");
    assert.equal(await status(signInit({ auth_date: String(Math.floor(Date.now() / 1000) - 2 * 86400), user: JSON.stringify({ id: 42 }) })), 401, "two days old");
    assert.equal(await status(signInit({ auth_date: now(), chat: JSON.stringify({ id: -100, type: "group" }) })), 401, "no user");
  });

  // Decisão do Pi (2026-10-03): até 8 rascunhos por usuário — https://core.telegram.org/bots/api#inputrichblockbuttons
  test("drafts are per user, capped at 8, and /draft lists them as buttons that open each one", async () => {
    const init = initFor({ id: 42 });
    const ids = [];
    for (let i = 1; i <= 9; i++) {
      const res = await fetch(`${ctx.base}/drafts`, json(init, { name: `Beat ${i}`, rows: [{ y: "sin(t)", on: true }] }));
      assert.equal(res.status, 200);
      ids.push((await res.json()).id);
    }
    const list = await (await fetch(`${ctx.base}/drafts`, { headers: { "x-telegram-init-data": init } })).json();
    assert.equal(list.length, 8);
    const one = await (await fetch(`${ctx.base}/drafts/${list[0].id}`, { headers: { "x-telegram-init-data": init } })).json();
    assert.equal(one.rows[0].y, "sin(t)");
    assert.deepEqual(await (await fetch(`${ctx.base}/drafts`, { headers: { "x-telegram-init-data": initFor({ id: 43 }) } })).json(), []);

    const [sent] = await say(ctx, "/draft");
    const buttons = buttonsOf(sent);
    assert.deepEqual(buttons.map((b) => b.text).sort(), list.map((d) => d.name).sort());
    assert.deepEqual(buttons.map((b) => new URL(b.web_app.url).searchParams.get("draft")).sort(), list.map((d) => d.id).sort());
    ctx.fake.assertConforms();

    const [empty] = await say(ctx, "/draft", { from: { id: 77 }, chat: { id: 77, type: "private" } });
    assert.equal(buttonsOf(empty).length, 1, "nothing saved: just the button that opens the app");
    ctx.fake.assertConforms();
  });

  // Decisão do Pi (2026-10-03): o limite de tamanho acompanha o tamanho real de um rascunho. The largest
  // draft the app can send (what web/app.js POSTs: name, 5 rows of { id, y, on, color, bpm, vol }, seconds,
  // the knob object; 500-character formulas, every character a 3-byte UTF-8 symbol, every number at its
  // longest) is accepted; bodies far beyond any draft are refused, declared or chunked.
  test("/drafts accepts the largest real draft and refuses bodies far beyond it", async () => {
    const init = initFor({ id: 42 });
    const F = -0.12345678901234568;
    const symbol = "\u2212"; // "−", 3 bytes in UTF-8
    const largest = {
      name: symbol.repeat(32),
      rows: Array.from({ length: 5 }, () => ({ id: Number.MAX_SAFE_INTEGER, y: symbol.repeat(500), on: false, color: "#bf5af2", bpm: 180, vol: F })),
      seconds: 1200,
      patch: { mode: "custom", presetId: "percussion_kick", formula: "sin(2*PI*(220*y)*t)*exp(-6*z*((t*(bpm/60)*x)%1))", engine: "raw", x: F, y: F, z: F, w: F, a: F, b: F, g: F, d: F, bpm: 180, vol: F, lpf: 16000, res: F, pan: F, seconds: 1200, muted: true },
    };
    const saved = await fetch(`${ctx.base}/drafts`, json(init, largest));
    assert.equal(saved.status, 200);
    const { id } = await saved.json();
    const back = await (await fetch(`${ctx.base}/drafts/${id}`, { headers: { "x-telegram-init-data": init } })).json();
    assert.equal(back.rows.length, 5);
    assert.equal(back.rows[0].y, symbol.repeat(500));

    const tooBig = Buffer.byteLength(JSON.stringify(largest)) * 3;
    const big = await fetch(`${ctx.base}/drafts/progress`, json(init, { ...largest, name: "x".repeat(tooBig) }));
    assert.equal(big.status, 413);
    const chunked = await rawRequest(ctx.base, { method: "POST", path: "/drafts/progress", headers: { "x-telegram-init-data": init, "transfer-encoding": "chunked" }, chunks: Array(6).fill("x".repeat(Math.ceil(tooBig / 6))), body: "" });
    assert.equal(chunked.statusCode, 413);
  });

  // https://core.telegram.org/bots/api#sendaudio (multipart audio, title, performer, duration "in
  // seconds", caption 0-1024), https://core.telegram.org/bots/api#sendchataction (documented actions),
  // https://core.telegram.org/bots/features#language-support — Decisão do Pi: bot só no chat privado (o MP3
  // vai para o chat privado do usuário, nunca para um grupo). The filename format is the app's (web/app.js, unchanged).
  test("/song uploads the MP3 to the user's private chat with a documented chat action and localized caption", async () => {
    const upload = async (user) => {
      ctx.fake.clear();
      const init = initFor(user, { chat: JSON.stringify({ id: -100123, type: "supergroup" }) });
      const res = await fetch(`${ctx.base}/song`, {
        method: "POST",
        headers: { "x-telegram-init-data": init, "x-filename": "math-dj-1m00.mp3", "content-type": "audio/mpeg" },
        body: new Uint8Array([0xff, 0xfb, 0x90, 0x00]),
      });
      assert.equal(res.status, 200);
      assert.deepEqual(ctx.fake.calls.map((c) => c.method), ["sendChatAction", "sendAudio"]);
      const [action, audio] = ctx.fake.calls;
      assert.equal(action.params.chat_id, user.id);
      assert.equal(audio.multipart, true);
      assert.equal(audio.params.chat_id, user.id);
      assert.equal(audio.params.audio.size, 4);
      assert.equal(audio.params.duration, 60);
      assert.ok(audio.params.title.includes("Math DJ"));
      return audio.params.caption;
    };
    const pt = await upload({ id: 42, first_name: "Pi", language_code: "pt-br" });
    const en = await upload({ id: 43, first_name: "Al", language_code: "en" });
    assert.ok(pt && en && pt !== en);
    ctx.fake.assertConforms();
  });

  // https://core.telegram.org/bots/api#sending-files ("Post the file using multipart/form-data ... 50 MB
  // for other files") — https://core.telegram.org/bots/api#sendaudio ("up to 50 MB in size")
  test("/song refuses files over the 50 MB upload limit before calling Telegram", async () => {
    ctx.fake.clear();
    const res = await rawRequest(ctx.base, { method: "POST", path: "/song", headers: { "x-telegram-init-data": initFor({ id: 42 }), "content-length": String(50 * 1024 * 1024 + 1) } });
    assert.equal(res.statusCode, 413);
    assert.equal(ctx.fake.calls.length, 0);
  });

  // https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app ("Validate data
  // from this field before using it on the bot's server")
  test("/song without valid initData is refused and nothing is sent", async () => {
    ctx.fake.clear();
    assert.equal((await fetch(`${ctx.base}/song`, { method: "POST", body: "x" })).status, 401);
    assert.equal((await fetch(`${ctx.base}/song`, { method: "POST", headers: { "x-telegram-init-data": initFor({ id: 42 }, {}, "999:x") }, body: "x" })).status, 401);
    assert.equal(ctx.fake.calls.length, 0);
  });

  // Contrato do web/app.js (que este PR não altera): the app shows "sent" only when /song answers 2XX
  // (`lt.ok?"sent":"failed"`), so a Telegram refusal must not look like success
  test("/song answers non-2XX when Telegram refuses the audio", async () => {
    ctx.fake.on("sendAudio", () => ({ ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" }));
    try {
      const res = await fetch(`${ctx.base}/song`, { method: "POST", headers: { "x-telegram-init-data": initFor({ id: 42 }) }, body: "abc" });
      assert.equal(res.status, 502);
    } finally {
      ctx.fake.off("sendAudio");
    }
  });

  // https://fetch.spec.whatwg.org/#http-cors-protocol (a site can only read a cross-origin response the
  // server allows) — Escolha técnica do PR #1: liberar só as origens do app (GitHub Pages e Railway); o
  // /health não expõe nada do bot
  test("/health and preflights send CORS only to the app's origins and reveal no bot details", async () => {
    const res = await fetch(`${ctx.base}/health`, { headers: { origin: GH } });
    assert.equal(res.headers.get("access-control-allow-origin"), GH);
    assert.match(res.headers.get("vary") || "", /origin/i);
    const body = await res.json();
    assert.deepEqual(Object.keys(body).sort(), ["ok", "service", "webapp"]);
    assert.ok(!JSON.stringify(body).includes("TEST-token"));
    assert.equal((await fetch(`${ctx.base}/health`, { headers: { origin: PUBLIC } })).headers.get("access-control-allow-origin"), PUBLIC);
    assert.equal((await fetch(`${ctx.base}/health`, { headers: { origin: "https://evil.example" } })).headers.get("access-control-allow-origin"), null);
    const pre = await fetch(`${ctx.base}/drafts`, { method: "OPTIONS", headers: { origin: "https://evil.example" } });
    assert.equal(pre.headers.get("access-control-allow-origin"), null);
    const ok = await fetch(`${ctx.base}/song`, { method: "OPTIONS", headers: { origin: GH } });
    assert.equal(ok.headers.get("access-control-allow-origin"), GH);
    assert.match(ok.headers.get("access-control-allow-headers"), /x-telegram-init-data/);
    assert.match(ok.headers.get("access-control-allow-headers"), /x-filename/);
  });

  // Decisão do Pi (2026-10-03): o app também funciona no navegador (PWA): app e manifest servidos —
  // Escolha técnica: nada fora de web/ é servido
  test("the PWA files are served and paths outside web/ are not", async () => {
    const index = await fetch(`${ctx.base}/`);
    assert.equal(index.status, 200);
    assert.match(index.headers.get("content-type"), /text\/html/);
    assert.equal((await fetch(`${ctx.base}/manifest.webmanifest`)).headers.get("content-type"), "application/manifest+json");
    for (const p of ["/../package.json", "/%2e%2e/package.json", "/..%2fpackage.json", "/../bot/server.js"]) {
      assert.equal((await rawRequest(ctx.base, { path: p })).statusCode, 404, p);
    }
  });

  // https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app: the check key is
  // HMAC_SHA256(<bot_token>, "WebAppData"); without a token nothing can be validated, so the routes that
  // need a verified user refuse even initData "signed" with an empty token
  test("without BOT_TOKEN the Mini App routes answer 503 and /health stays up", async () => {
    const off = await boot({ token: "", start: false });
    try {
      for (const init of [initFor({ id: 42 }), initFor({ id: 42 }, {}, ""), ""]) {
        assert.equal((await fetch(`${off.base}/drafts`, { headers: { "x-telegram-init-data": init } })).status, 503);
        assert.equal((await fetch(`${off.base}/drafts`, { method: "POST", headers: { "x-telegram-init-data": init }, body: "{}" })).status, 503);
        assert.equal((await fetch(`${off.base}/song`, { method: "POST", headers: { "x-telegram-init-data": init }, body: "x" })).status, 503);
      }
      assert.equal((await fetch(`${off.base}/health`)).status, 200);
      assert.equal(off.fake.calls.length, 0);
    } finally {
      await off.close();
    }
  });
});
