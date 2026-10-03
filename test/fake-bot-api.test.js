// The strict Bot API fake must itself follow the docs: every case below is a request the official
// docs (Bot API 10.3, fetched 2026-10-03) forbid, and the fake must refuse it. Each test name starts
// with the doc section it comes from. A last group checks that valid requests pass untouched.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createTelegram } from "../bot/telegram.js";
import { createFakeBotApi } from "./fake-bot-api.js";

const TOKEN = "123456:TEST-token";
const D = (anchor) => `https://core.telegram.org/bots/api#${anchor}`;

function client() {
  const fake = createFakeBotApi({ token: TOKEN });
  const tg = createTelegram(TOKEN, { fetch: fake.fetch, log: () => {}, sleep: async () => {} });
  return { fake, call: (method, params) => tg.call(method, params, { retries: 0 }) };
}
const cmd = (command, description = "Something") => ({ command, description });
const button = (extra) => ({ text: "Open", ...extra });
const rich = (blocks, extra = {}) => ({ chat_id: 42, rich_message: { blocks, ...extra } });
const para = (text) => ({ type: "paragraph", text });
const app = { web_app: { url: "https://mdjr.up.railway.app/?v=40" } };
function audioForm(fields, file = new Blob([new Uint8Array([0xff, 0xfb, 0x90, 0x00])], { type: "audio/mpeg" }), name = "math-dj-1m00.mp3") {
  const form = new FormData();
  form.append("chat_id", "42");
  if (file) form.append("audio", file, name);
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return form;
}

const INVALID = [
  [D("botcommand"), "command with uppercase letters", "setMyCommands", { commands: [cmd("Start")] }, /does not match/],
  [D("botcommand"), "command longer than 32 characters", "setMyCommands", { commands: [cmd("a".repeat(33))] }, /does not match/],
  [D("botcommand"), "command with a leading slash", "setMyCommands", { commands: [cmd("/start")] }, /does not match/],
  [D("botcommand"), "empty command description", "setMyCommands", { commands: [cmd("start", "")] }, /at least 1/],
  [D("botcommand"), "command description over 256 characters", "setMyCommands", { commands: [cmd("start", "x".repeat(257))] }, /at most 256/],
  [D("botcommand"), "unknown BotCommand field", "setMyCommands", { commands: [{ ...cmd("start"), hidden: true }] }, /not a field of BotCommand/],
  [D("setmycommands"), "more than 100 commands", "setMyCommands", { commands: Array.from({ length: 101 }, (_, i) => cmd(`c${i}`)) }, /at most 100 items/],
  [D("setmycommands"), "missing required commands", "setMyCommands", { scope: { type: "default" } }, /required parameter/],
  [D("setmycommands"), "language_code that is not two-letter ISO 639-1", "setMyCommands", { commands: [cmd("start")], language_code: "pt-BR" }, /ISO 639-1/],
  [D("botcommandscope"), "undocumented scope type", "setMyCommands", { commands: [cmd("start")], scope: { type: "private_chats" } }, /not a documented BotCommandScope/],
  [D("botcommandscopechat"), "chat scope without chat_id", "deleteMyCommands", { scope: { type: "chat" } }, /chat_id: required field/],
  [D("setmydescription"), "description over 512 characters", "setMyDescription", { description: "x".repeat(513) }, /at most 512/],
  [D("setmyshortdescription"), "short description over 120 characters", "setMyShortDescription", { short_description: "x".repeat(121) }, /at most 120/],
  [D("setmyshortdescription"), "parameter of another method", "setMyShortDescription", { description: "x" }, /not a parameter of setMyShortDescription/],
  [D("menubuttonwebapp"), "web_app menu button without text", "setChatMenuButton", { menu_button: { type: "web_app", ...app } }, /text: required/],
  [D("webappinfo"), "Mini App URL that is not HTTPS", "setChatMenuButton", { menu_button: { type: "web_app", text: "Math DJ", web_app: { url: "http://localhost:3000/" } } }, /HTTPS/],
  [D("setchatmenubutton"), "chat_id given as a string", "setChatMenuButton", { chat_id: "42" }, /expected Integer/],
  [D("setwebhook"), "webhook URL over plain HTTP", "setWebhook", { url: "http://mdjr.up.railway.app/telegram/webhook" }, /HTTPS/],
  [D("setwebhook"), "webhook on an unsupported port", "setWebhook", { url: "https://mdjr.up.railway.app:8080/telegram/webhook" }, /port 8080/],
  [D("setwebhook"), "secret_token with a space", "setWebhook", { url: "https://mdjr.up.railway.app/h", secret_token: "bad secret" }, /does not match/],
  [D("setwebhook"), "secret_token over 256 characters", "setWebhook", { url: "https://mdjr.up.railway.app/h", secret_token: "a".repeat(257) }, /does not match/],
  [D("setwebhook"), "empty secret_token", "setWebhook", { url: "https://mdjr.up.railway.app/h", secret_token: "" }, /does not match/],
  [D("setwebhook"), "max_connections over 100", "setWebhook", { url: "https://mdjr.up.railway.app/h", max_connections: 101 }, /<= 100/],
  [D("update"), "allowed_updates with an undocumented update type", "setWebhook", { url: "https://mdjr.up.railway.app/h", allowed_updates: ["messages"] }, /not a documented value/],
  [D("setwebhook"), "drop_pending_updates as a string", "setWebhook", { url: "https://mdjr.up.railway.app/h", drop_pending_updates: "true" }, /expected Boolean/],
  [D("getupdates"), "limit over 100", "getUpdates", { limit: 101 }, /<= 100/],
  [D("getupdates"), "timeout given as a string", "getUpdates", { timeout: "25" }, /expected Integer/],
  [D("sendmessage"), "missing text", "sendMessage", { chat_id: 42 }, /text: required/],
  [D("sendmessage"), "empty text", "sendMessage", { chat_id: 42, text: "" }, /at least 1/],
  [D("sendmessage"), "text over 4096 characters", "sendMessage", { chat_id: 42, text: "x".repeat(4097) }, /at most 4096/],
  [D("sendmessage"), "chat_id that is neither Integer nor String", "sendMessage", { chat_id: 4.2, text: "hi" }, /Integer or String/],
  [D("sendmessage"), "undocumented parameter", "sendMessage", { chat_id: 42, text: "hi", disable_web_page_preview: true }, /not a parameter of sendMessage/],
  [D("linkpreviewoptions"), "undocumented link preview field", "sendMessage", { chat_id: 42, text: "hi", link_preview_options: { disabled: true } }, /not a field of LinkPreviewOptions/],
  [D("inlinekeyboardbutton"), "inline button with two actions", "sendMessage", { chat_id: 42, text: "hi", reply_markup: { inline_keyboard: [[button({ ...app, url: "https://a.b" })]] } }, /exactly one of/],
  [D("inlinekeyboardbutton"), "inline button style \"link\" (only for rich message buttons)", "sendMessage", { chat_id: 42, text: "hi", reply_markup: { inline_keyboard: [[button({ ...app, style: "link" })]] } }, /not one of danger, success, primary/],
  [D("inlinekeyboardbutton"), "web_app inline button outside a private chat", "sendMessage", { chat_id: -100, text: "hi", reply_markup: { inline_keyboard: [[button(app)]] } }, /only in private chats/],
  [D("inlinekeyboardbutton"), "callback_data over 64 bytes", "sendMessage", { chat_id: 42, text: "hi", reply_markup: { inline_keyboard: [[button({ callback_data: "é".repeat(33) })]] } }, /at most 64 bytes/],
  [D("sendmessage"), "reply keyboard type that is not transcribed", "sendMessage", { chat_id: 42, text: "hi", reply_markup: { keyboard: [[{ text: "a" }]] } }, /not a field of InlineKeyboardMarkup|inline_keyboard: required/],
  [D("sendchataction"), "undocumented chat action", "sendChatAction", { chat_id: 42, action: "upload_audio" }, /not one of typing/],
  [D("sendchataction"), "missing action", "sendChatAction", { chat_id: 42 }, /action: required/],
  [D("leavechat"), "missing chat_id", "leaveChat", {}, /chat_id: required/],
  [D("inputrichmessage"), "rich message with both html and blocks", "sendRichMessage", rich([para("a")], { html: "<p>a</p>" }), /exactly one of html, markdown, blocks/],
  [D("inputrichmessage"), "rich message with no content", "sendRichMessage", { chat_id: 42, rich_message: {} }, /exactly one of/],
  [D("inputrichblock"), "undocumented block type", "sendRichMessage", rich([{ type: "heading", text: "a" }]), /not a documented InputRichBlock/],
  [D("inputrichblock"), "documented block type not transcribed yet", "sendRichMessage", rich([{ type: "section_heading", text: "a" }]), /not transcribed/],
  [D("inputrichblockparagraph"), "paragraph without text", "sendRichMessage", rich([{ type: "paragraph" }]), /text: required/],
  [D("richtext"), "RichText that is a number", "sendRichMessage", rich([para(5)]), /RichText must be/],
  [D("richtextbold"), "bold RichText with an extra field", "sendRichMessage", rich([para({ type: "bold", text: "a", size: 2 })]), /not a field of RichTextBold/],
  [D("richtext"), "undocumented RichText type", "sendRichMessage", rich([para({ type: "big", text: "a" })]), /not a documented RichText/],
  [D("inputrichblocklistitem"), "list item label type that is not a/A/i/I/1", "sendRichMessage", rich([{ type: "list", items: [{ blocks: [para("a")], type: "b" }] }]), /not one of a, A, i, I, 1/],
  [D("inputrichblocklistitem"), "list item without blocks", "sendRichMessage", rich([{ type: "list", items: [{}] }]), /blocks: required/],
  [D("inputrichblockbuttons"), "buttons block with 9 buttons", "sendRichMessage", rich([{ type: "buttons", buttons: Array(9).fill(button(app)) }]), /at most 8 items/],
  [D("inputrichblockbuttons"), "buttons block with no buttons", "sendRichMessage", rich([{ type: "buttons", buttons: [] }]), /at least 1 items/],
  [D("inputrichblockbuttons"), "undocumented alignment", "sendRichMessage", rich([{ type: "buttons", align: "middle", buttons: [button(app)] }]), /not one of left, center, right/],
  [D("richmessagebutton"), "button with no action", "sendRichMessage", rich([{ type: "buttons", buttons: [button({})] }]), /exactly one of/],
  [D("richmessagebutton"), "style \"link\" on a web_app button", "sendRichMessage", rich([{ type: "buttons", buttons: [button({ ...app, style: "link" })] }]), /allowed only for callback buttons/],
  [D("richmessagebutton"), "undocumented button style", "sendRichMessage", rich([{ type: "buttons", buttons: [button({ ...app, style: "secondary" })] }]), /not one of danger/],
  [D("richmessagebutton"), "button URL that is not HTTP or tg://", "sendRichMessage", rich([{ type: "buttons", buttons: [button({ url: "ftp://x" })] }]), /does not match/],
  [D("richmessagebutton"), "button text with formatting", "sendRichMessage", rich([{ type: "buttons", buttons: [button({ ...app, text: { type: "bold", text: "Open" } })] }]), /only plain text/],
  [D("richmessagebutton"), "web_app button in a group chat", "sendRichMessage", { ...rich([{ type: "buttons", buttons: [button(app)] }]), chat_id: -100 }, /only in private chats/],
  [D("rich-message-limits"), "more than 500 blocks", "sendRichMessage", rich(Array.from({ length: 501 }, () => para("a"))), /501 blocks, limit 500/],
  [D("rich-message-limits"), "more than 32768 characters", "sendRichMessage", rich([para("x".repeat(32769))]), /32769 characters, limit 32768/],
  [D("rich-message-limits"), "more than 16 nesting levels", "sendRichMessage", rich([[...Array(8)].reduce((b) => ({ type: "list", items: [{ blocks: [b] }] }), para("a"))]), /nesting levels, limit 16/],
  [D("sendaudio"), "multipart duration that is not an Integer", "sendAudio", audioForm({ duration: "1.5" }), /expected Integer/],
  [D("sendaudio"), "caption over 1024 characters", "sendAudio", audioForm({ caption: "x".repeat(1025) }), /at most 1024/],
  [D("sendaudio"), "audio that is not .MP3 or .M4A", "sendAudio", audioForm({}, undefined, "song.wav"), /is not \.mp3\/\.m4a/],
  [D("sendaudio"), "missing audio", "sendAudio", audioForm({}, null), /audio: required/],
  [D("sendaudio"), "undocumented multipart field", "sendAudio", audioForm({ artist: "MDJR" }), /not a parameter of sendAudio/],
  [D("sendaudio"), "file uploaded under a parameter that takes no InputFile", "sendAudio", (() => { const f = audioForm({}); f.append("title", new Blob(["x"]), "t.txt"); return f; })(), /does not accept InputFile|expected String/],
  [D("sending-files"), "multipart upload over 50 MB", "sendAudio", audioForm({}, new Blob([new Uint8Array(50 * 1024 * 1024 + 1)])), /limit 52428800/],
];

describe("Strict fake refuses what the docs forbid", () => {
  for (const [doc, title, method, params, expected] of INVALID) {
    test(`${doc} — refuses ${title}`, async () => {
      const { fake, call } = client();
      const res = await call(method, params);
      assert.equal(res.ok, false);
      assert.equal(res.error_code, 400);
      assert.ok(fake.violations.some((v) => expected.test(v)), `expected ${expected} in:\n${fake.violations.join("\n")}`);
    });
  }

  test(`${D("making-requests")} — refuses unknown methods and bodies that are not JSON or multipart`, async () => {
    const { fake, call } = client();
    assert.equal((await call("sendSong", { chat_id: 1 })).error_code, 404);
    await fake.fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, { method: "POST", headers: { "content-type": "text/plain" }, body: "chat_id=1" });
    assert.ok(fake.violations.some((v) => v.startsWith("sendSong: method is not")), fake.violations.join("\n"));
    assert.ok(fake.violations.some((v) => v.includes('content-type "text/plain"')), fake.violations.join("\n"));
  });

  test(`${D("making-requests")} — a wrong token gets 401 Unauthorized`, async () => {
    const fake = createFakeBotApi({ token: TOKEN });
    const tg = createTelegram("999:other", { fetch: fake.fetch, log: () => {} });
    assert.equal((await tg.call("getMe")).error_code, 401);
  });

  test(`${D("getupdates")} — getUpdates fails with 409 while a webhook is set`, async () => {
    const { call } = client();
    assert.equal((await call("setWebhook", { url: "https://mdjr.up.railway.app/telegram/webhook" })).ok, true);
    assert.equal((await call("getUpdates", {})).error_code, 409);
    assert.equal((await call("deleteWebhook", {})).ok, true);
    assert.equal((await call("getUpdates", {})).ok, true);
  });
});

describe("Strict fake accepts what the docs allow", () => {
  // One fully documented request per method the server uses, with optional fields filled in.
  const VALID = [
    [D("getme"), "getMe", {}],
    [D("getupdates"), "getUpdates", { offset: -1, limit: 100, timeout: 0, allowed_updates: ["message", "my_chat_member"] }],
    [D("setwebhook"), "setWebhook", { url: "https://mdjr.up.railway.app:8443/telegram/webhook", max_connections: 40, allowed_updates: [], drop_pending_updates: false, secret_token: "A-z_0".repeat(51) + "9" }],
    [D("deletewebhook"), "deleteWebhook", { drop_pending_updates: false }],
    [D("setmycommands"), "setMyCommands", { commands: Array.from({ length: 100 }, (_, i) => ({ command: `c_${i}`.padEnd(32, "x"), description: "d".repeat(256), is_ephemeral: false })), scope: { type: "chat_member", chat_id: "@group", user_id: 1 }, language_code: "pt" }],
    [D("deletemycommands"), "deleteMyCommands", { scope: { type: "all_private_chats" }, language_code: "" }],
    [D("setmydescription"), "setMyDescription", { description: "x".repeat(512), language_code: "en" }],
    [D("setmyshortdescription"), "setMyShortDescription", { short_description: "" }],
    [D("setchatmenubutton"), "setChatMenuButton", { chat_id: 42, menu_button: { type: "commands" } }],
    [D("sendmessage"), "sendMessage", { chat_id: "@channel", message_thread_id: 3, text: "x".repeat(4096), link_preview_options: { is_disabled: true }, reply_markup: { inline_keyboard: [[{ text: "a", style: "primary", callback_data: "x".repeat(64) }]], force_reply: true } }],
    [D("sendrichmessage"), "sendRichMessage", { chat_id: 42, rich_message: { blocks: [{ type: "paragraph", text: ["a", { type: "bold", text: ["b"] }] }, { type: "list", items: [{ blocks: [{ type: "paragraph", text: "c" }], type: "I", value: 2, has_checkbox: true, is_checked: true }] }, { type: "buttons", align: "right", buttons: Array(8).fill({ text: "Go", style: "link", callback_data: "go" }) }], is_rtl: false } }],
    [D("sendrichmessage"), "sendRichMessage", { chat_id: 42, rich_message: { markdown: "**bold**" } }],
    [D("sendchataction"), "sendChatAction", { chat_id: 42, message_thread_id: 1, action: "upload_document" }],
    [D("leavechat"), "leaveChat", { chat_id: -100 }],
  ];
  for (const [doc, method, params] of VALID) {
    test(`${doc} — accepts a fully documented ${method}`, async () => {
      const { fake, call } = client();
      const res = await call(method, params);
      assert.equal(res.ok, true, fake.violations.join("\n"));
      fake.assertConforms();
    });
  }

  test(`${D("sendaudio")} — accepts a multipart sendAudio with every documented text field`, async () => {
    const { fake, call } = client();
    const res = await call("sendAudio", audioForm({ caption: "x".repeat(1024), duration: "60", performer: "MDJR", title: "Math DJ 1:00", disable_notification: "true", message_thread_id: "3" }));
    assert.equal(res.ok, true, fake.violations.join("\n"));
    assert.equal(res.result.chat.id, 42);
    fake.assertConforms();
  });
});
