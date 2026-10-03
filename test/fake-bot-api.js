// Strict, spec-driven fake of the Telegram Bot API, used through the real bot/telegram.js client
// (it replaces fetch only). Every request is checked against test/bot-api-schema.js, which is
// transcribed from https://core.telegram.org/bots/api (Bot API 10.3). Unknown methods, unknown /
// missing / wrong-type / out-of-limit parameters are recorded as violations and answered with a
// 400 like the real API; tests call assertConforms() so any violation fails the test.

import assert from "node:assert/strict";
import { METHODS, TYPES, RESULTS } from "./bot-api-schema.js";

const API = "https://api.telegram.org";
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isFile = (v) => typeof Blob !== "undefined" && v instanceof Blob;

export function createFakeBotApi({ token, bot = { id: 777000111, username: "MDJRbot", first_name: "Math DJ" }, commands = {} } = {}) {
  const violations = [];
  const calls = [];
  const interceptors = new Map();
  const waiters = new Set();
  const state = {
    bot: { ...bot, nextMessageId: 1 },
    // Commands per scope + language. Seeded with what earlier versions of the bot registered
    // (default scope, no language: /start and /draft) so tests see what users would really see.
    commands: new Map(Object.entries({ "default|": [{ command: "start", description: "Open Math DJ" }, { command: "draft", description: "Your drafts" }], ...commands })),
    descriptions: new Map(),
    shortDescriptions: new Map(),
    menuButtons: new Map(),
    webhook: null,
    queue: [],
    chats: new Map(),
    closed: false,
  };

  function violation(method, message) {
    violations.push(`${method}: ${message}`);
  }

  // ---------- schema checking ----------
  function check(value, type, where, ctx, rule = {}) {
    const fail = (msg) => ctx.errors.push(`${where}: ${msg}${rule.rule ? ` (docs: "${rule.rule}")` : ""}`);
    if (type.startsWith("Array of ")) {
      if (!Array.isArray(value)) return fail(`expected ${type}`);
      if (rule.minItems !== undefined && value.length < rule.minItems) fail(`at least ${rule.minItems} items`);
      if (rule.maxItems !== undefined && value.length > rule.maxItems) fail(`at most ${rule.maxItems} items, got ${value.length}`);
      const inner = type.slice("Array of ".length);
      value.forEach((item, i) => {
        if (rule.itemsEnum && !rule.itemsEnum.includes(item)) ctx.errors.push(`${where}[${i}]: "${item}" is not a documented value`);
        check(item, inner, `${where}[${i}]`, ctx);
      });
      return;
    }
    if (type.includes(" or ")) {
      const options = type.split(" or ");
      if (type === "Integer or String") return Number.isSafeInteger(value) || typeof value === "string" ? scalar(value, rule, fail) : fail(`expected ${type}`);
      if (type === "InputFile or String") {
        if (isFile(value)) return file(value, rule, fail);
        if (typeof value === "string") return;
        return fail(`expected ${type}`);
      }
      // reply_markup: only the members transcribed in the schema may be sent.
      const modeled = options.filter((o) => TYPES[o]);
      if (!modeled.length) return fail(`none of ${type} is transcribed in the schema`);
      const errs = [];
      for (const option of modeled) {
        const sub = { ...ctx, errors: [] };
        check(value, option, where, sub);
        if (!sub.errors.length) return;
        errs.push(...sub.errors);
      }
      ctx.errors.push(...errs);
      return;
    }
    switch (type) {
      case "Integer":
        if (!Number.isSafeInteger(value)) return fail(`expected Integer, got ${JSON.stringify(value)}`);
        return scalar(value, rule, fail);
      case "String":
        if (typeof value !== "string") return fail(`expected String, got ${typeof value}`);
        return scalar(value, rule, fail);
      case "Boolean":
        return typeof value === "boolean" ? undefined : fail(`expected Boolean, got ${JSON.stringify(value)}`);
      case "True":
        return value === true ? undefined : fail("expected True");
      case "InputFile":
        return isFile(value) ? file(value, rule, fail) : fail("expected InputFile (multipart upload)");
      default:
        return object(value, type, where, ctx, rule, fail);
    }
  }

  function scalar(value, rule, fail) {
    if (rule.const !== undefined && value !== rule.const) return fail(`must be "${rule.const}"`);
    if (rule.enum && !rule.enum.includes(value)) return fail(`"${value}" is not one of ${rule.enum.join(", ")}`);
    if (typeof value === "string") {
      if (rule.minLength !== undefined && value.length < rule.minLength) fail(`at least ${rule.minLength} characters`);
      if (rule.maxLength !== undefined && value.length > rule.maxLength) fail(`at most ${rule.maxLength} characters, got ${value.length}`);
      const bytes = Buffer.byteLength(value);
      if (rule.minBytes !== undefined && bytes < rule.minBytes) fail(`at least ${rule.minBytes} bytes`);
      if (rule.maxBytes !== undefined && bytes > rule.maxBytes) fail(`at most ${rule.maxBytes} bytes`);
      if (rule.pattern && !rule.pattern.test(value)) fail(`"${value.slice(0, 40)}" does not match ${rule.pattern}`);
      if (rule.https && !/^https:\/\/[^/\s]+/i.test(value)) fail("must be an HTTPS URL");
      if (rule.httpsOrEmpty && value !== "") {
        let url;
        try { url = new URL(value); } catch { return fail("must be an HTTPS URL or an empty string"); }
        if (url.protocol !== "https:") fail("must be an HTTPS URL or an empty string");
        const port = Number(url.port || 443);
        if (rule.ports && !rule.ports.includes(port)) fail(`port ${port} is not supported for webhooks`);
      }
    }
    if (typeof value === "number") {
      if (rule.min !== undefined && value < rule.min) fail(`must be >= ${rule.min}`);
      if (rule.max !== undefined && value > rule.max) fail(`must be <= ${rule.max}`);
    }
  }

  function file(blob, rule, fail) {
    if (rule.maxBytes !== undefined && blob.size > rule.maxBytes) fail(`file is ${blob.size} bytes, limit ${rule.maxBytes}`);
    if (rule.extensions && blob.name && !rule.extensions.some((ext) => blob.name.toLowerCase().endsWith(ext))) fail(`file "${blob.name}" is not ${rule.extensions.join("/")}`);
    if (!blob.size) fail("empty file");
  }

  function object(value, type, where, ctx, rule, fail) {
    const schema = TYPES[type];
    if (!schema) return fail(`type ${type} is not transcribed in test/bot-api-schema.js; transcribe it from the docs before sending it`);
    if (schema.richText) return richText(value, where, ctx, rule);
    if (schema.union) {
      if (!isObject(value)) return fail(`expected ${type} object`);
      const member = schema.union.find((name) => TYPES[name]?.fields?.type?.const === value.type);
      if (!member) {
        const wanted = `${type}${String(value.type).replace(/_/g, "")}`.toLowerCase();
        const known = schema.union.some((name) => name.toLowerCase() === wanted);
        return fail(known ? `${type} "${value.type}" is not transcribed in the schema` : `"${value.type}" is not a documented ${type} type`);
      }
      return object(value, member, where, ctx, rule, fail);
    }
    if (!isObject(value)) return fail(`expected ${type} object`);
    for (const key of Object.keys(value)) {
      if (!schema.fields[key]) ctx.errors.push(`${where}.${key}: not a field of ${type} (${schema.doc})`);
    }
    for (const [key, field] of Object.entries(schema.fields)) {
      if (value[key] === undefined) {
        if (field.required) ctx.errors.push(`${where}.${key}: required field of ${type} is missing`);
        continue;
      }
      check(value[key], field.type, `${where}.${key}`, ctx, field);
      if (field.privateChatOnly && !ctx.privateChat) ctx.errors.push(`${where}.${key}: ${field.rule}`);
    }
    if (schema.exactlyOneOf) {
      const used = schema.exactlyOneOf.filter((k) => value[k] !== undefined);
      if (used.length !== 1) ctx.errors.push(`${where}: exactly one of ${schema.exactlyOneOf.join(", ")} must be used, got [${used.join(", ")}] (${schema.doc})`);
    }
    if (schema.linkStyleOnlyFor && value.style === "link" && value[schema.linkStyleOnlyFor] === undefined) {
      ctx.errors.push(`${where}.style: "link" is allowed only for callback buttons (${schema.doc})`);
    }
    if (schema.richLimits) richLimits(value, where, ctx, schema.richLimits);
  }

  function richText(value, where, ctx, rule) {
    if (typeof value === "string") return;
    if (Array.isArray(value)) return value.forEach((v, i) => richText(v, `${where}[${i}]`, ctx, rule));
    if (!isObject(value)) return ctx.errors.push(`${where}: RichText must be a String, an Array of RichText or a RichText object (${TYPES.RichText.doc})`);
    if (rule.plainOnly && !["custom_emoji", "date_time"].includes(value.type)) return ctx.errors.push(`${where}: ${rule.rule}`);
    const member = TYPES.RichText.union.find((n) => TYPES[n]?.fields?.type?.const === value.type);
    if (!member) {
      const documented = TYPES.RichText.union.some((n) => n.toLowerCase() === `richtext${String(value.type).replace(/_/g, "")}`);
      return ctx.errors.push(`${where}: RichText "${value.type}" ${documented ? "is not transcribed in the schema" : "is not a documented RichText type"}`);
    }
    object(value, member, where, ctx, {}, (msg) => ctx.errors.push(`${where}: ${msg}`));
  }

  // https://core.telegram.org/bots/api#rich-message-limits — characters, blocks (including nested
  // blocks and list items) and nesting levels, for the block types the schema models.
  function richLimits(message, where, ctx, limits) {
    let chars = 0;
    let blocks = 0;
    let deepest = 0;
    const text = (t, depth) => {
      deepest = Math.max(deepest, depth);
      if (typeof t === "string") chars += [...t].length;
      else if (Array.isArray(t)) t.forEach((x) => text(x, depth));
      else if (isObject(t)) text(t.text, depth + 1);
    };
    const walk = (list, depth) => {
      for (const block of Array.isArray(list) ? list : []) {
        blocks += 1;
        deepest = Math.max(deepest, depth);
        if (block?.type === "paragraph") text(block.text, depth + 1);
        if (block?.type === "list") {
          for (const item of block.items || []) {
            blocks += 1;
            walk(item?.blocks, depth + 2);
          }
        }
        if (block?.type === "buttons") for (const b of block.buttons || []) text(b?.text, depth + 1);
      }
    };
    walk(message.blocks, 1);
    if (typeof message.html === "string") chars += [...message.html].length;
    if (typeof message.markdown === "string") chars += [...message.markdown].length;
    if (chars > limits.maxChars) ctx.errors.push(`${where}: ${chars} characters, limit ${limits.maxChars} (${limits.doc})`);
    if (blocks > limits.maxBlocks) ctx.errors.push(`${where}: ${blocks} blocks, limit ${limits.maxBlocks} (${limits.doc})`);
    if (deepest > limits.maxDepth) ctx.errors.push(`${where}: ${deepest} nesting levels, limit ${limits.maxDepth} (${limits.doc})`);
  }

  // ---------- request decoding ----------
  // multipart/form-data values are strings (or files); decode them per the documented type,
  // the way the Bot API does: Integers as digits, Booleans as true/false, objects as JSON.
  function fromMultipart(method, raw, schema) {
    const out = {};
    for (const [key, value] of raw) {
      if (key in out) violation(method, `multipart field "${key}" sent twice`);
      const type = schema.params[key]?.type;
      if (isFile(value) || !type) { out[key] = value; continue; }
      if (type === "Integer") out[key] = /^-?\d+$/.test(value) ? Number(value) : value;
      else if (type === "Integer or String") out[key] = /^-?\d+$/.test(value) ? Number(value) : value;
      else if (type === "Boolean" || type === "True") out[key] = value === "true" ? true : value === "false" ? false : value;
      else if (type === "String" || type === "InputFile or String") out[key] = value;
      else {
        try { out[key] = JSON.parse(value); } catch { out[key] = value; }
      }
    }
    // A file part must be referenced by its own parameter name (we never use attach://).
    for (const [key, value] of Object.entries(out)) {
      if (isFile(value) && !schema.params[key]?.type.includes("InputFile")) violation(method, `file uploaded in "${key}", which does not accept InputFile`);
    }
    return out;
  }

  async function decode(method, init, schema) {
    const body = init?.body;
    if (body instanceof FormData) {
      // Serialise and parse again, as on the wire.
      const req = new Request(`${API}/x`, { method: "POST", body });
      const type = req.headers.get("content-type") || "";
      if (!type.startsWith("multipart/form-data")) violation(method, `multipart body sent as ${type}`);
      return { params: fromMultipart(method, await req.formData(), schema), multipart: true };
    }
    const headers = new Headers(init?.headers || {});
    const type = headers.get("content-type") || "";
    if (body === undefined || body === null || body === "") return { params: {}, multipart: false };
    if (!/^application\/json\b/i.test(type)) {
      violation(method, `body sent with content-type "${type}"; the client must use application/json or multipart/form-data`);
      return { params: {}, multipart: false };
    }
    try {
      const parsed = JSON.parse(String(body));
      if (!isObject(parsed)) violation(method, "JSON body is not an object");
      return { params: isObject(parsed) ? parsed : {}, multipart: false };
    } catch {
      violation(method, "body is not valid JSON");
      return { params: {}, multipart: false };
    }
  }

  function validate(method, params, multipart) {
    const schema = METHODS[method];
    const privateChat = params.chat_id === undefined || chatType(params.chat_id) === "private";
    const ctx = { errors: [], privateChat };
    for (const key of Object.keys(params)) {
      if (!schema.params[key]) ctx.errors.push(`${key}: not a parameter of ${method} (${schema.doc})`);
    }
    for (const [key, rule] of Object.entries(schema.params)) {
      if (params[key] === undefined) {
        if (rule.required) ctx.errors.push(`${key}: required parameter of ${method} is missing (${schema.doc})`);
        continue;
      }
      check(params[key], rule.type, key, ctx, rule);
    }
    // "application/json (except for uploading files)"
    if (!multipart && Object.values(params).some(isFile)) ctx.errors.push("files can only be uploaded with multipart/form-data");
    for (const e of ctx.errors) violation(method, e);
    return ctx.errors;
  }

  function chatType(chatId) {
    if (state.chats.has(Number(chatId))) return state.chats.get(Number(chatId));
    return Number(chatId) > 0 ? "private" : "group";
  }

  // ---------- behaviour ----------
  const ok = (result) => ({ ok: true, result });
  const err = (code, description, parameters) => ({ ok: false, error_code: code, description, ...(parameters ? { parameters } : {}) });
  const scopeKey = (scope = { type: "default" }) => [scope.type, scope.chat_id, scope.user_id].filter((v) => v !== undefined).join(":");

  async function behave(method, params) {
    switch (method) {
      case "getMe":
        return ok(RESULTS.User(state.bot));
      case "setMyCommands":
        state.commands.set(`${scopeKey(params.scope)}|${params.language_code || ""}`, params.commands);
        return ok(true);
      case "deleteMyCommands":
        state.commands.delete(`${scopeKey(params.scope)}|${params.language_code || ""}`);
        return ok(true);
      case "setMyDescription":
        state.descriptions.set(params.language_code || "", params.description ?? "");
        return ok(true);
      case "setMyShortDescription":
        state.shortDescriptions.set(params.language_code || "", params.short_description ?? "");
        return ok(true);
      case "setChatMenuButton":
        state.menuButtons.set(params.chat_id ?? "default", params.menu_button ?? { type: "default" });
        return ok(true);
      case "setWebhook":
        state.webhook = params.url ? { url: params.url, secret_token: params.secret_token, allowed_updates: params.allowed_updates } : null;
        return ok(true);
      case "deleteWebhook":
        state.webhook = null;
        if (params.drop_pending_updates) state.queue.length = 0;
        return ok(true);
      case "getUpdates": {
        // https://core.telegram.org/bots/api#getupdates — "will not work if an outgoing webhook is set up"
        if (state.webhook) return err(409, "Conflict: can't use getUpdates method while webhook is active; use deleteWebhook to delete the webhook first");
        if (params.offset) state.queue = state.queue.filter((u) => u.update_id >= params.offset);
        if (!state.queue.length && params.timeout && !state.closed) {
          await new Promise((resolve) => {
            const timer = setTimeout(done, params.timeout * 1000);
            function done() { clearTimeout(timer); waiters.delete(done); resolve(); }
            waiters.add(done);
          });
        }
        return ok(state.queue.slice(0, params.limit || 100));
      }
      case "leaveChat":
        state.chats.set(Number(params.chat_id), "left");
        return ok(true);
      case "sendChatAction":
        return ok(true);
      default:
        return ok(RESULTS[METHODS[method].returns](state.bot, params));
    }
  }

  async function fetch(url, init = {}) {
    const href = String(url);
    const match = /^https:\/\/api\.telegram\.org\/bot([^/]*)\/([A-Za-z]+)$/.exec(href);
    const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (!match) {
      violation("request", `URL is not https://api.telegram.org/bot<token>/METHOD_NAME (https://core.telegram.org/bots/api#making-requests)`);
      return reply(404, err(404, "Not Found"));
    }
    const [, sentToken, rawMethod] = match;
    if ((init.method || "GET") !== "POST" && (init.method || "GET") !== "GET") violation(rawMethod, `HTTP method ${init.method} (only GET and POST are supported)`);
    if (sentToken !== token) return reply(401, err(401, "Unauthorized"));
    // "All methods in the Bot API are case-insensitive."
    const method = Object.keys(METHODS).find((m) => m.toLowerCase() === rawMethod.toLowerCase());
    if (!method) {
      violation(rawMethod, "method is not in test/bot-api-schema.js (unknown or not transcribed)");
      return reply(404, err(404, "Not Found: method not found"));
    }
    const { params, multipart } = await decode(method, init, METHODS[method]);
    const call = { method, params, multipart };
    calls.push(call);
    const errors = validate(method, params, multipart);
    if (errors.length) return reply(400, err(400, `Bad Request: ${errors[0]}`));
    const intercept = interceptors.get(method);
    if (intercept) {
      const custom = await intercept(params, call);
      if (custom) return reply(custom.ok ? 200 : custom.error_code || 400, custom);
    }
    return reply(200, await behave(method, params));
  }

  return {
    fetch,
    calls,
    violations,
    state,
    named: (method) => calls.filter((c) => c.method === method),
    clear() { calls.length = 0; },
    // Override a method's answer: handler(params) returns a Bot API response or undefined.
    on(method, handler) { interceptors.set(method, handler); },
    off(method) { interceptors.delete(method); },
    queueUpdate(update) {
      state.queue.push(update);
      for (const done of [...waiters]) done();
    },
    close() {
      state.closed = true;
      for (const done of [...waiters]) done();
    },
    assertConforms() {
      assert.deepEqual(violations, [], `Bot API violations:\n${violations.join("\n")}`);
    },

    // https://core.telegram.org/bots/api#determining-list-of-commands — the first list that is
    // set is the one the user sees.
    commandsFor({ chat = "private", language = "", chatId, userId, admin = false }) {
      const lang = language.slice(0, 2).toLowerCase();
      const order = chat === "private"
        ? [`chat:${chatId}`, "all_private_chats", "default"]
        : [`chat_member:${chatId}:${userId}`, ...(admin ? [`chat_administrators:${chatId}`] : []), `chat:${chatId}`, ...(admin ? ["all_chat_administrators"] : []), "all_group_chats", "default"];
      for (const scope of order) {
        for (const key of [`${scope}|${lang}`, `${scope}|`]) {
          if (state.commands.has(key)) return state.commands.get(key);
        }
      }
      return [];
    },

    // Delivers an update the way Telegram does for a webhook set with setWebhook: HTTPS POST of a
    // JSON-serialized Update with the "X-Telegram-Bot-Api-Secret-Token" header
    // (https://core.telegram.org/bots/api#setwebhook). `base` is the local server standing in for
    // the registered public origin.
    async deliver(base, update, { secret } = {}) {
      assert.ok(state.webhook, "no webhook registered with setWebhook");
      const path = new URL(state.webhook.url).pathname;
      const kind = Object.keys(update).find((k) => k !== "update_id");
      if (state.webhook.allowed_updates?.length && !state.webhook.allowed_updates.includes(kind)) return null; // Telegram would not send it
      const chat = update.message?.chat || update.my_chat_member?.chat;
      if (chat) state.chats.set(chat.id, chat.type);
      const headers = { "content-type": "application/json" };
      const token = secret === undefined ? state.webhook.secret_token : secret;
      if (token) headers["x-telegram-bot-api-secret-token"] = token;
      return globalThis.fetch(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(update) });
    },
    // Records the chat type for privateChatOnly checks when updates are injected directly.
    seeChat(chat) { state.chats.set(chat.id, chat.type); },
  };
}
