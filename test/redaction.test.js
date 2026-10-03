import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLogger, createRedactor, REDACTED } from "../bot/log.js";
import { createTelegram } from "../bot/telegram.js";
import { createApp, crashHandler, webhookSecret } from "../bot/server.js";

// Decisão do Pi: logs nunca mostram o token nem o segredo do webhook, nem em parte.
const TOKEN = "7234567890:AAHk3x-ExampleTokenForTests_0123456789";
const SECRET = webhookSecret(TOKEN, {});
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function assertNoLeak(text, secrets = [TOKEN, SECRET]) {
  for (const secret of secrets) {
    for (let i = 0; i + 8 <= secret.length; i++) {
      const piece = secret.slice(i, i + 8);
      assert.ok(!text.includes(piece), `log leaked "${piece}" from a secret:\n${text}`);
    }
  }
}

const apiUrl = (method) => `https://api.telegram.org/bot${TOKEN}/${method}`;

describe("Decisão do Pi: logs nunca mostram o token", () => {
  test("redactor removes token, secret, URL-encoded and partial copies, keeps other text", () => {
    const redact = createRedactor([TOKEN, SECRET]);
    const out = redact([
      `POST ${apiUrl("sendMessage")}`,
      `truncated ...bot${TOKEN.slice(0, 20)}`,
      `encoded ${encodeURIComponent(TOKEN)}`,
      `partial ${TOKEN.slice(12, 30)} and ${SECRET.slice(5, 40)}`,
      "other bot111222333:ZZZyyyXXXwww/getMe",
      "telegram sendMessage: 400 Bad Request: chat not found",
    ].join("\n"));
    assertNoLeak(out);
    assert.ok(!out.includes("ZZZyyyXXXwww"), "any /bot<digits>:<chars> is redacted");
    assert.ok(out.includes("400 Bad Request: chat not found"));
    assert.ok(out.includes(REDACTED));
  });

  test("logger redacts every argument, including Error message and cause chain", () => {
    const lines = [];
    const logger = createLogger({ secrets: [TOKEN, SECRET], sink: { error: (l) => lines.push(l), log: (l) => lines.push(l) } });
    const err = new Error(`failed ${apiUrl("getMe")}`, { cause: new Error(`secret was ${SECRET}`) });
    logger.error("x", err, { url: apiUrl("setWebhook"), secret_token: SECRET });
    logger.info("info", apiUrl("getUpdates"));
    logger.crash("crash", Object.assign(new Error("boom"), { stack: `Error: boom\n    at ${apiUrl("x")}` }));
    assert.equal(lines.length, 3);
    assertNoLeak(lines.join("\n"));
  });

  test("Bot API client: network error with the URL in message, cause and stack is logged redacted", async () => {
    const lines = [];
    const tg = createTelegram(TOKEN, {
      log: (l) => lines.push(l),
      fetch: async (url) => {
        const err = new TypeError(`fetch failed ${url}`, { cause: new Error(`ECONNRESET ${url}`) });
        err.stack = `TypeError: fetch failed\n    at ${url}`;
        throw err;
      },
    });
    const res = await tg.call("sendMessage", { chat_id: 1, text: "hi" });
    assert.equal(res.ok, false);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /^telegram sendMessage: /);
    assertNoLeak(lines.join("\n"), [TOKEN]);
  });

  test("Bot API client: an error description echoing the token is logged redacted", async () => {
    const lines = [];
    const tg = createTelegram(TOKEN, {
      log: (l) => lines.push(l),
      fetch: async () => ({ status: 401, json: async () => ({ ok: false, error_code: 401, description: `Unauthorized ${TOKEN}` }) }),
    });
    await tg.call("getMe");
    assertNoLeak(lines.join("\n"), [TOKEN]);
    assert.match(lines[0], /401 Unauthorized/);
  });

  test("server: handler errors carrying token and secret are logged redacted", async () => {
    const lines = [];
    const telegram = {
      async call(method) {
        if (method === "sendRichMessage") throw new Error(`boom ${apiUrl(method)}`, { cause: new Error(`header ${SECRET}`) });
        return { ok: true, result: true };
      },
    };
    const app = createApp({ token: TOKEN, telegram, env: {}, volume: "/nonexistent", log: (l) => lines.push(l), info: (l) => lines.push(l) });
    await app.dispatch({
      update_id: 1,
      message: { message_id: 1, from: { id: 5, is_bot: false, first_name: "A" }, chat: { id: 5, type: "private" }, text: "/start", entities: [{ type: "bot_command", offset: 0, length: 6 }] },
    });
    assert.ok(lines.some((l) => l.startsWith("update")));
    assertNoLeak(lines.join("\n"));
  });

  test("crash handler logs a redacted stack and exits with 1", () => {
    const lines = [];
    const codes = [];
    const logger = createLogger({ secrets: [TOKEN, SECRET], sink: { error: (l) => lines.push(l) } });
    const err = new Error(`unhandled ${apiUrl("getMe")}`);
    err.stack = `Error: unhandled\n    at fetch (${apiUrl("getMe")})\n    secret ${SECRET}`;
    crashHandler(logger, (code) => codes.push(code))("uncaughtException")(err);
    assert.deepEqual(codes, [1]);
    assert.match(lines[0], /uncaughtException/);
    assertNoLeak(lines.join("\n"));
  });
});

// End to end: the real entry point with a preload that makes every Bot API fetch fail
// with the full URL (token) in message, cause and stack. No request leaves the machine.
function runServer(extraEnv, ms) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "./test/fixtures/failing-fetch.mjs", "bot/server.js"], {
      cwd: ROOT,
      env: { PATH: process.env.PATH, BOT_TOKEN: TOKEN, PORT: "0", RAILWAY_PUBLIC_DOMAIN: "mdjr.up.railway.app", MDJR_VOLUME: "/tmp/mdjr-redaction-test", ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { out += d; });
    const timer = setTimeout(() => child.kill("SIGTERM"), ms);
    child.on("error", reject);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, out });
    });
  });
}

describe("Decisão do Pi: logs nunca mostram o token (processo real)", () => {
  test("failing Bot API calls during startup and SIGTERM never print token or secret", async () => {
    const { code, out } = await runServer({}, 2600);
    assert.match(out, /telegram getMe: /, "the failure is logged");
    assert.match(out, /SIGTERM: encerrando/);
    assert.equal(code, 0);
    assertNoLeak(out);
  });

  test("an unhandled rejection with the token in its stack is logged redacted and exits 1", async () => {
    const { code, out } = await runServer({ MDJR_TEST_CRASH: "1" }, 3000);
    assert.match(out, /unhandledRejection/);
    assert.equal(code, 1);
    assertNoLeak(out);
  });

  test("an explicit WEBHOOK_SECRET is never printed either", async () => {
    const custom = "Pi_custom-secret_value_42";
    const { out } = await runServer({ WEBHOOK_SECRET: custom }, 1200);
    assertNoLeak(out, [TOKEN, custom]);
  });
});
