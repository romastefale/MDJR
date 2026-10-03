// Runs the original bundle (parity/legacy-app.js) and the build of web/src (web/app.js) side by
// side in headless Chromium, both served by `node bot/server.js` (no BOT_TOKEN: it only serves web/).
// Everything outside the box is stubbed so both builds see exactly the same world:
//  - https://telegram.org/js/telegram-web-app.js -> a recording Telegram.WebApp double
//  - https://mdjr.up.railway.app/* (health, drafts, song) -> a recording API double
//  - Math.random -> seeded, so the background hues and the hits.js voices are the same on both sides
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { APP_VERSION } from "../web/src/config.js";
import { LEGACY_BUNDLE } from "./legacy.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LEGACY_CODE = fs.readFileSync(LEGACY_BUNDLE, "utf8");
export const API = "https://mdjr.up.railway.app";
export const BUILDS = ["legacy", "source"];

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

export async function startServer() {
  const port = await freePort();
  const volume = fs.mkdtempSync(path.join(os.tmpdir(), "mdjr-parity-"));
  const child = spawn(process.execPath, ["bot/server.js"], {
    cwd: root,
    env: { ...process.env, BOT_TOKEN: "", PORT: String(port), MDJR_VOLUME: volume },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server did not start")), 10000);
    const onData = (chunk) => {
      if (String(chunk).includes("mdjr-bot na porta")) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", (code) => reject(new Error(`server exited ${code}`)));
  });
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => {
      child.kill();
      fs.rmSync(volume, { recursive: true, force: true });
    },
  };
}

export function launch() {
  return chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required", "--font-render-hinting=none"] });
}

// Telegram.WebApp double. `tg` null = a normal browser (telegram-web-app.js reports platform "unknown").
function telegramScript(tg) {
  return `(() => {
  const cfg = ${JSON.stringify(tg)};
  const log = (window.__tgLog = []);
  if (!cfg) { window.Telegram = { WebApp: { platform: "unknown", initData: "", initDataUnsafe: {} } }; return; }
  const handlers = {};
  window.__tgEmit = (name) => (handlers[name] || []).forEach((fn) => fn());
  window.Telegram = { WebApp: {
    platform: cfg.platform || "ios", initData: cfg.initData || "", initDataUnsafe: cfg.initDataUnsafe || {},
    viewportHeight: cfg.viewportHeight || 0, safeAreaInset: cfg.safeAreaInset, contentSafeAreaInset: cfg.contentSafeAreaInset,
    ready() { log.push(["ready"]); }, expand() { log.push(["expand"]); },
    disableVerticalSwipes() { log.push(["disableVerticalSwipes"]); },
    setHeaderColor(c) { log.push(["setHeaderColor", c]); }, setBackgroundColor(c) { log.push(["setBackgroundColor", c]); },
    setBottomBarColor(c) { log.push(["setBottomBarColor", c]); },
    version: cfg.version || "6.0",
    isVersionAtLeast(v) { const a = this.version.split(".").map(Number), b = String(v).split(".").map(Number);
      for (let i = 0; i < Math.max(a.length, b.length); i++) { if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0); } return true; },
    onEvent(name, fn) { log.push(["onEvent", name]); (handlers[name] = handlers[name] || []).push(fn); },
    offEvent(name) { log.push(["offEvent", name]); },
  } };
})();`;
}

// Seeded Math.random (mulberry32) and a recorder for messages sent to the AudioWorklet port.
const INIT_SCRIPT = `(() => {
  let a = 20261003;
  Math.random = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  window.__portLog = [];
  const post = MessagePort.prototype.postMessage;
  MessagePort.prototype.postMessage = function (message, ...rest) {
    if (message && typeof message === "object" && ("rows" in message || "scale" in message)) window.__portLog.push(JSON.parse(JSON.stringify(message)));
    return post.call(this, message, ...rest);
  };
})();`;

// Opens the app with one build. `api(method, path, body)` returns { status, json } for the API double.
export async function openApp(browser, server, build, options = {}) {
  const {
    tg = null,
    query = "",
    colorScheme = "light",
    viewport = { width: 390, height: 844 },
    api = () => null,
    health = { ok: true, service: "mdjr-bot", webapp: `${API}/?v=${APP_VERSION}` },
    sessionTheme = null,
    waitForApp = true, // false when the app is expected to navigate away (version check)
  } = options;
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, colorScheme, acceptDownloads: true, hasTouch: false });
  context.setDefaultTimeout(15000);
  const requests = [];
  const navigations = [];
  await context.addInitScript(INIT_SCRIPT);
  if (sessionTheme) await context.addInitScript(`try { sessionStorage.setItem("mdjr-theme", ${JSON.stringify(sessionTheme)}); } catch {}`);
  await context.route(/\/app\.js(\?|$)/, (route) => {
    if (build === "legacy") return route.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: LEGACY_CODE });
    return route.continue();
  });
  await context.route("https://telegram.org/js/telegram-web-app.js", (route) =>
    route.fulfill({ status: 200, contentType: "text/javascript", body: telegramScript(tg) }),
  );
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type, x-telegram-init-data, x-filename", "access-control-allow-methods": "GET, POST, OPTIONS" };
  await context.route(`${API}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (request.isNavigationRequest()) {
      navigations.push(request.url());
      return route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>moved</title>" });
    }
    const headers = request.headers();
    const raw = request.postDataBuffer();
    const isJson = (headers["content-type"] || "").includes("json");
    requests.push({
      method: request.method(),
      path: url.pathname + url.search,
      initData: headers["x-telegram-init-data"] || null,
      contentType: headers["content-type"] || null,
      filename: headers["x-filename"] || null,
      body: raw ? (isJson ? JSON.parse(raw.toString("utf8")) : raw) : null,
    });
    if (url.pathname === "/health") return route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify(health) });
    const reply = api(request.method(), url.pathname, raw && isJson ? JSON.parse(raw.toString("utf8")) : null) || { status: 404, json: { ok: false } };
    return route.fulfill({ status: reply.status, contentType: "application/json", headers: cors, body: JSON.stringify(reply.json) });
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await page.goto(`${server.origin}/?v=${APP_VERSION}${query}`);
  if (waitForApp) {
    await page.waitForSelector(".fn-row textarea");
    await settle(page);
  }
  return { page, context, requests, navigations, errors, close: () => context.close() };
}

// Waits for fonts, pending API replies and a few frames of the plane animation.
export async function settle(page, ms = 250) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(ms);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

// The whole document as one line per node: depth, tag, attributes (sorted) or text. React-internal
// expandos are not attributes, so they never show up. Form values are added since they are properties.
export function domLines(page) {
  return page.evaluate(() => {
    const lines = [];
    const walk = (node, depth) => {
      const pad = " ".repeat(depth);
      if (node.nodeType === Node.TEXT_NODE) {
        if (node.textContent.trim()) lines.push(`${pad}#text ${JSON.stringify(node.textContent)}`);
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const attrs = [...node.attributes].map((a) => `${a.name}=${JSON.stringify(a.value)}`).sort();
      if (node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement) attrs.push(`.value=${JSON.stringify(node.value)}`);
      if (node instanceof HTMLButtonElement) attrs.push(`.disabled=${node.disabled}`);
      lines.push(`${pad}<${node.tagName.toLowerCase()} ${attrs.join(" ")}>`);
      for (const child of node.childNodes) walk(child, depth + 1);
    };
    walk(document.documentElement, 0);
    return lines;
  });
}

// Number of differing lines between two DOM dumps (positional, plus any length difference).
export function domDiff(a, b) {
  let diff = Math.abs(a.length - b.length);
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) diff += 1;
  return diff;
}

// Visible text, roles and labels of the menus and rows, as a user (or screen reader) sees them.
// `clock: false` leaves out the header clock, which keeps running during playback.
export function uiText(page, { clock = true } = {}) {
  const selector = `button, textarea, input, ${clock ? ".sh-time, " : ""}.fn-err, .mark, label b, [role=menu]`;
  return page.evaluate((selector) =>
    [...document.querySelectorAll(selector)].map((el) => ({
      tag: el.tagName,
      text: el.tagName === "TEXTAREA" || el.tagName === "INPUT" ? el.value : el.textContent,
      label: el.getAttribute("aria-label"),
      expanded: el.getAttribute("aria-expanded"),
      pressed: el.getAttribute("aria-pressed"),
      disabled: el.disabled ?? null,
      on: el.getAttribute("data-on"),
    })),
  selector);
}

// Pixel comparison of two PNG screenshots, decoded by the browser itself (no image library).
export async function pixelDiff(page, pngA, pngB, threshold = 16) {
  return page.evaluate(
    async ({ a, b, threshold }) => {
      const decode = async (b64) => {
        const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(bitmap, 0, 0);
        return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
      };
      const [x, y] = await Promise.all([decode(a), decode(b)]);
      if (x.width !== y.width || x.height !== y.height) return { sameSize: false, total: x.width * x.height, changed: x.width * x.height, over: x.width * x.height, maxDelta: 255 };
      let changed = 0;
      let over = 0;
      let maxDelta = 0;
      for (let i = 0; i < x.data.length; i += 4) {
        const delta = Math.max(Math.abs(x.data[i] - y.data[i]), Math.abs(x.data[i + 1] - y.data[i + 1]), Math.abs(x.data[i + 2] - y.data[i + 2]), Math.abs(x.data[i + 3] - y.data[i + 3]));
        if (delta > 0) changed += 1;
        if (delta > threshold) over += 1;
        if (delta > maxDelta) maxDelta = delta;
      }
      return { sameSize: true, total: x.width * x.height, changed, over, maxDelta };
    },
    { a: pngA.toString("base64"), b: pngB.toString("base64"), threshold },
  );
}

// Renders a recorded worklet message through web/worklet.js in an OfflineAudioContext.
export async function renderWorklet(page, message, seconds = 1) {
  return page.evaluate(
    async ({ message, seconds, version }) => {
      const ctx = new OfflineAudioContext(1, Math.round(44100 * seconds), 44100);
      await ctx.audioWorklet.addModule(new URL(`./worklet.js?v=${version}`, location.href).href);
      const node = new AudioWorkletNode(ctx, "mdjr-mix");
      node.port.postMessage({ ...message, t: 0 });
      node.connect(ctx.destination);
      await new Promise((resolve) => setTimeout(resolve, 200));
      const buffer = await ctx.startRendering();
      return Array.from(buffer.getChannelData(0));
    },
    { message, seconds, version: APP_VERSION },
  );
}

// Decodes an MP3 with the browser's decoder (to compare audio, not only bytes).
export async function decodeMp3(page, bytes) {
  return page.evaluate(async (b64) => {
    const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const ctx = new OfflineAudioContext(1, 44100, 44100);
    const buffer = await ctx.decodeAudioData(data.buffer);
    return { length: buffer.length, sampleRate: buffer.sampleRate, channels: buffer.numberOfChannels, samples: Array.from(buffer.getChannelData(0)) };
  }, Buffer.from(bytes).toString("base64"));
}

export function maxAbsDiff(a, b) {
  let max = a.length === b.length ? 0 : Infinity;
  for (let i = 0; i < Math.min(a.length, b.length); i++) max = Math.max(max, Math.abs(a[i] - b[i]));
  return max;
}
