// Side-by-side parity of the original bundle (ba3a7e7) and the build of web/src, in
// headless Chromium through `node bot/server.js`. Each scenario runs once per build and the
// traces must be equal. Run with `npm run test:browser` (needs `npx playwright install chromium`).
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { CARDS } from "../web/hits.js";
import { API, APP_VERSION, BUILDS, decodeMp3, domDiff, domLines, launch, maxAbsDiff, openApp, pixelDiff, renderWorklet, settle, startServer, uiText } from "./harness.js";

const PARITY = "paridade com o bundle original ba3a7e7";
const TG_DOCS = "https://core.telegram.org/bots/webapps";
const INIT_DATA = "query_id=AAE&user=%7B%22id%22%3A42%2C%22first_name%22%3A%22Pi%22%7D&auth_date=1790000000&hash=abc";
const SUMMARY = [];
// Telegram.WebApp double: inside Telegram, signed-in user, safe areas of an iPhone with a notch.
const tg = {
  platform: "ios",
  version: "8.0",
  initData: INIT_DATA,
  initDataUnsafe: { start_param: "abcdef12" },
  viewportHeight: 700,
  safeAreaInset: { top: 47, bottom: 34, left: 0, right: 0 },
  contentSafeAreaInset: { top: 46, bottom: 0, left: 0, right: 0 },
};

let server;
let browser;

before(async () => {
  server = await startServer();
  browser = await launch();
});

after(async () => {
  await browser?.close();
  server?.close();
  console.log(`\n# parity summary\n${SUMMARY.map((line) => `#   ${line}`).join("\n")}`);
});

// Runs `scenario(app)` for both builds and returns [legacyTrace, sourceTrace].
async function both(options, scenario) {
  const traces = [];
  for (const build of BUILDS) {
    const app = await openApp(browser, server, build, typeof options === "function" ? options() : options);
    try {
      const trace = await scenario(app, build);
      trace.pageErrors = app.errors;
      traces.push(trace);
    } finally {
      await app.close();
    }
  }
  return traces;
}

function sha(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 16);
}

function compareDom(name, a, b) {
  const diff = domDiff(a, b);
  SUMMARY.push(`DOM ${name}: ${diff} differing lines of ${a.length}`);
  assert.equal(diff, 0, `${name}: DOM differs`);
  assert.deepEqual(b, a);
}

async function comparePixels(page, name, a, b) {
  const result = await pixelDiff(page, a, b);
  const percent = (100 * result.over) / result.total;
  SUMMARY.push(`pixels ${name}: ${result.changed} changed / ${result.total} (${((100 * result.changed) / result.total).toFixed(4)}%), ${result.over} over tolerance (${percent.toFixed(4)}%), max channel delta ${result.maxDelta}`);
  assert.ok(result.sameSize, `${name}: screenshot size differs`);
  assert.ok(percent <= 0.1, `${name}: ${percent}% of pixels differ by more than 16/255`);
}

// A tiny project in the draft format of bot/server.js, made of hits.js voices (one per card).
function presetDraft(id, voiceIndex, extra = {}) {
  return {
    id,
    name: `Preset ${voiceIndex}`,
    updated: 1790000000000,
    seconds: 30,
    patch: { x: 1, y: 1, z: 1, w: 1, a: 0, b: 0, g: 0, d: 1, lpf: 16000, res: 0.7, muted: false, bpm: 120 },
    rows: CARDS.map((card, i) => ({ y: card.voices[(voiceIndex + i * 17) % card.voices.length], on: i !== 3, color: "", bpm: 90 + i * 20, vol: 0.5 + i * 0.1 })),
    ...extra,
  };
}

describe(`first screen and menus (${PARITY})`, () => {
  for (const colorScheme of ["light", "dark"]) {
    test(`first screen, ${colorScheme} theme: DOM, texts, screenshot`, async () => {
      const [a, b] = await both({ colorScheme }, async ({ page, requests }) => ({
        dom: await domLines(page),
        ui: await uiText(page),
        shot: await page.screenshot(),
        requests: requests.map(({ method, path }) => `${method} ${path}`),
        tg: await page.evaluate(() => window.__tgLog),
      }));
      compareDom(`first screen (${colorScheme})`, a.dom, b.dom);
      assert.deepEqual(b.ui, a.ui);
      assert.deepEqual(b.requests, a.requests);
      assert.deepEqual(b.requests, ["GET /health"]);
      assert.deepEqual(b.pageErrors, a.pageErrors);
      const page = await browser.newPage();
      await comparePixels(page, `first screen (${colorScheme})`, a.shot, b.shot);
      await page.close();
    });
  }

  test("header menu: root, Time, Drafts (outside Telegram), Escape", async () => {
    const [a, b] = await both({}, async ({ page }) => {
      const steps = {};
      await page.click(".sh-menu");
      await settle(page, 50);
      steps.root = await domLines(page);
      steps.rootShot = await page.locator(".sh-picker").screenshot();
      await page.click("text=Time");
      steps.time = await domLines(page);
      await page.click("text=‹ Time");
      await page.click("text=Drafts");
      await settle(page, 100);
      steps.drafts = await domLines(page);
      steps.draftsUi = await uiText(page);
      await page.keyboard.press("Escape");
      await settle(page, 50);
      steps.closed = await domLines(page);
      return steps;
    });
    for (const step of ["root", "time", "drafts", "closed"]) compareDom(`menu ${step}`, a[step], b[step]);
    assert.ok(b.draftsUi.some((item) => item.text === "None yet" && item.disabled));
    const page = await browser.newPage();
    await comparePixels(page, "menu root", a.rootShot, b.rootShot);
    await page.close();
  });

  test("Time menu changes the song length; Mute toggles to Sound", async () => {
    const [a, b] = await both({}, async ({ page }) => {
      await page.click(".sh-menu");
      await page.click("text=Time");
      await page.click("button:text-is('5:00')");
      const time = await page.textContent(".sh-time");
      await page.click(".sh-menu");
      await page.click("text=Time");
      const on = await page.getAttribute("button[data-on='1']", "data-on").then(() => page.textContent("button[data-on='1']"));
      await page.keyboard.press("Escape");
      await page.click(".sh-menu");
      await page.click("button:text-is('Mute')");
      await page.click(".sh-menu");
      const label = await page.textContent(".menu-list button:nth-child(3)");
      return { time, on, label, dom: await domLines(page) };
    });
    assert.deepEqual(b, a);
    assert.equal(b.time, "0:00 / 5:00");
    assert.equal(b.label, "Sound");
  });

  test("row menu (needs playback): root, BPM, Volume, Generate", async () => {
    const [a, b] = await both({}, async ({ page }) => {
      const steps = {};
      await page.click(".fn-row:nth-child(1) .play-in");
      await page.waitForSelector(".fn-row:nth-child(1) .play-in[aria-label='Pause']");
      await page.click(".fn-row:nth-child(1) .more");
      await settle(page, 50);
      steps.root = await uiText(page, { clock: false });
      steps.rootShot = await page.locator(".row-pop").screenshot();
      steps.rootStyle = await page.getAttribute(".row-pop", "style");
      await page.click(".row-pop >> text=BPM");
      steps.bpm = await uiText(page, { clock: false });
      await page.focus(".row-pop input[type=range]");
      for (let i = 0; i < 7; i++) await page.keyboard.press("ArrowRight");
      steps.bpmAfter = await uiText(page, { clock: false });
      await page.click(".row-pop >> text=‹ BPM");
      await page.click(".row-pop >> text=Volume");
      await page.focus(".row-pop input[type=range]");
      for (let i = 0; i < 9; i++) await page.keyboard.press("ArrowLeft");
      steps.vol = await uiText(page, { clock: false });
      const box = await page.locator(".row-pop .bpm-slider").boundingBox();
      await page.mouse.click(box.x + box.width * 0.9, box.y + box.height / 2);
      steps.volDrag = await uiText(page, { clock: false });
      await page.click(".row-pop >> text=‹ Volume");
      await page.click(".row-pop >> text=Generate");
      await settle(page, 50);
      steps.generated = await page.inputValue(".fn-row:nth-child(1) textarea");
      steps.closed = await page.locator(".row-pop").count();
      await page.click(".fn-row:nth-child(1) .play-in");
      steps.afterMute = await uiText(page, { clock: false });
      return steps;
    });
    for (const key of ["root", "rootStyle", "bpm", "bpmAfter", "vol", "volDrag", "generated", "closed", "afterMute"]) assert.deepEqual(b[key], a[key], key);
    SUMMARY.push(`row menu: BPM after 7×ArrowRight = ${b.bpmAfter.find((i) => i.label === "BPM" && i.tag === "INPUT")?.text}; generated voice equal: ${a.generated === b.generated}`);
    const page = await browser.newPage();
    await comparePixels(page, "row menu", a.rootShot, b.rootShot);
    await page.close();
  });

  test("formula editing: validator badges, aria-invalid, three-line limit", async () => {
    const inputs = ["SEN(2*PI()*220*t)", "POTENCIA(t;2)", "sin(2*PI*220*t)", "t+foo", "x*2", "'t'", "t@", "", "SE(t>1;1;0)",
      "SIN(2*PI()*(52+200*EXP(-84*MOD(t*bpm/60*x,1)))*t)*EXP(-28*MOD(t*bpm/60*x,1))+SIN(2*PI()*(52+200*EXP(-84*MOD(t*bpm/60*x,1)))*t)*EXP(-28*MOD(t*bpm/60*x,1))+SIN(t)"];
    const [a, b] = await both({}, async ({ page }) => {
      const out = [];
      for (const text of inputs) {
        await page.fill(".fn-row:nth-child(2) textarea", text);
        await settle(page, 30);
        out.push(await page.evaluate(() => {
          const row = document.querySelector(".fn-row:nth-child(2)");
          return { invalid: row.getAttribute("data-invalid"), err: row.querySelector(".fn-err")?.textContent ?? null, aria: row.querySelector("textarea").getAttribute("aria-invalid"), edit: document.querySelector(".dj").getAttribute("data-edit"), plane: document.querySelector(".plane").hidden };
        }));
      }
      await page.locator("textarea:focus").blur();
      await settle(page, 100);
      return { out, dom: await domLines(page) };
    });
    assert.deepEqual(b.out, a.out);
    compareDom("after editing", a.dom, b.dom);
    SUMMARY.push(`formula badges: ${b.out.map((o) => o.err ?? "ok").join(" | ")}`);
  });

  test("Space toggles playback outside text fields", async () => {
    const [a, b] = await both({}, async ({ page }) => {
      await page.keyboard.press("Space");
      await page.waitForTimeout(400);
      const playing = await uiText(page, { clock: false });
      await page.keyboard.press("Space");
      await page.waitForTimeout(100);
      return { playing, stopped: await uiText(page, { clock: false }) };
    });
    assert.deepEqual(b, a);
  });
});

describe(`Telegram Mini App integration (${TG_DOCS}; ${PARITY})`, () => {
  test("start: ready/expand/disableVerticalSwipes, colors, safe areas, start_param draft", async () => {
    const draft = presetDraft("abcdef12", 3);
    const api = (method, path) => (method === "GET" && path === "/drafts/abcdef12" ? { status: 200, json: draft } : null);
    const [a, b] = await both({ tg, api }, async ({ page, requests }) => {
      await settle(page, 300);
      const vars = await page.evaluate(() => ["--vvh", "--vvt", "--overlay", "--page-edge"].map((v) => document.documentElement.style.getPropertyValue(v)));
      await page.evaluate(() => window.__tgEmit("safeAreaChanged"));
      return { tg: await page.evaluate(() => window.__tgLog), requests, vars, dom: await domLines(page), ui: await uiText(page) };
    });
    assert.deepEqual(b.tg, a.tg);
    assert.deepEqual(b.requests, a.requests);
    assert.deepEqual(b.vars, a.vars);
    compareDom("telegram start with draft", a.dom, b.dom);
    assert.deepEqual(b.requests.map((r) => `${r.method} ${r.path} ${r.initData === INIT_DATA}`), ["GET /health false", "GET /drafts/abcdef12 true"]);
    for (const call of ["ready", "expand", "disableVerticalSwipes"]) assert.ok(b.tg.some((c) => c[0] === call), call);
    SUMMARY.push(`telegram calls: ${b.tg.map((c) => c.join(":")).join(", ")}`);
    SUMMARY.push(`telegram css vars --vvh/--vvt/--overlay/--page-edge: ${b.vars.join(" / ")}`);
  });

  test("?draft= link wins over start_param; progress slot when there is none", async () => {
    const run = (query, initDataUnsafe) =>
      both({ tg: { ...tg, initDataUnsafe }, query, api: () => ({ status: 404, json: { ok: false } }) }, async ({ requests }) => ({ requests: requests.map((r) => `${r.method} ${r.path}`) }));
    for (const [query, unsafe] of [["&draft=0123abcd", { start_param: "abcdef12" }], ["", {}], ["&draft=nothex!", { start_param: "zz" }]]) {
      const [a, b] = await run(query, unsafe);
      assert.deepEqual(b, a, query);
    }
  });

  test("autosave of formula, Time and Mute; Save draft; open draft", async () => {
    const saved = { id: "feedbeef", name: "SAVED", updated: 1790000000001 };
    const listed = [{ id: "0badf00d", name: "Old song", updated: 1 }];
    const api = (method, path) => {
      if (method === "GET" && path === "/drafts") return { status: 200, json: listed };
      if (method === "POST" && path === "/drafts") return { status: 200, json: saved };
      if (method === "POST") return { status: 200, json: { id: "progress", name: "Progress", updated: 2 } };
      if (method === "GET" && path === "/drafts/0badf00d") return { status: 200, json: presetDraft("0badf00d", 41, { seconds: 120 }) };
      return null;
    };
    const [a, b] = await both({ tg: { ...tg, initDataUnsafe: {} }, api }, async ({ page, requests }) => {
      await page.fill(".fn-row:nth-child(3) textarea", "SEN(2*PI()*440*t)*EXP(-4*MOD(t*bpm/60,1))");
      await page.waitForTimeout(400);
      await page.locator("textarea:focus").blur();
      await page.click(".sh-menu");
      await page.click("text=Time");
      await page.click("button:text-is('2:00')");
      await page.click(".sh-menu");
      await page.click("button:text-is('Mute')");
      await page.waitForTimeout(400);
      await page.click(".sh-menu");
      await page.click("text=Drafts");
      await settle(page, 150);
      const listUi = await uiText(page);
      await page.click("button:text-is('Save')");
      await settle(page, 150);
      const afterSave = await uiText(page);
      await page.click("button:text-is('Old song')");
      await settle(page, 400);
      return { requests, listUi, afterSave, dom: await domLines(page) };
    });
    assert.deepEqual(b.requests, a.requests);
    assert.deepEqual(b.listUi, a.listUi);
    assert.deepEqual(b.afterSave, a.afterSave);
    compareDom("after opening a draft", a.dom, b.dom);
    SUMMARY.push(`drafts API calls (${b.requests.length}): ${b.requests.map((r) => `${r.method} ${r.path}`).join(", ")}`);
  });

  test("theme button and system theme switch in place: colors, metas, Telegram colors by version, no reload", async () => {
    for (const version of ["8.0", "7.0", "6.0"]) {
      const [a, b] = await both({ tg: { ...tg, version, initDataUnsafe: {} } }, async ({ page, requests }) => {
        const state = () =>
          page.evaluate(() => ({
            theme: document.documentElement.getAttribute("data-theme"),
            scheme: document.documentElement.style.colorScheme,
            edge: document.documentElement.style.getPropertyValue("--page-edge"),
            bg: document.documentElement.style.getPropertyValue("--page-bg").length,
            metas: [...document.querySelectorAll('meta[name="theme-color"], meta[name="color-scheme"]')].map((m) => m.content),
            stored: sessionStorage.getItem("mdjr-theme"),
            label: document.querySelector(".sh-actions button:nth-child(2)").getAttribute("aria-label"),
            loads: performance.getEntriesByType("navigation").length,
            marker: window.__marker,
          }));
        await page.evaluate(() => (window.__marker = "same page"));
        const steps = [await state()];
        await page.click(".sh-actions button:nth-child(2)");
        await settle(page, 50);
        steps.push(await state());
        await page.click(".sh-actions button:nth-child(2)");
        await settle(page, 50);
        steps.push(await state());
        await page.emulateMedia({ colorScheme: "dark" });
        await settle(page, 50);
        steps.push(await state());
        return { steps, tg: await page.evaluate(() => window.__tgLog), requests: requests.map((r) => `${r.method} ${r.path}`), shot: await page.screenshot() };
      });
      assert.deepEqual(b.steps, a.steps);
      assert.deepEqual(b.tg, a.tg);
      assert.deepEqual(b.requests, a.requests);
      assert.deepEqual(b.steps.map((s) => [s.theme, s.stored, s.marker]), [["light", null, "same page"], ["dark", "dark", "same page"], ["light", "light", "same page"], ["dark", null, "same page"]]);
      const page = await browser.newPage();
      await comparePixels(page, `after theme switches (Telegram ${version})`, a.shot, b.shot);
      await page.close();
      SUMMARY.push(`theme, Telegram ${version}: ${[...new Set(b.tg.filter((c) => c[0].startsWith("set")).map((c) => c[0]))].join(", ") || "no color calls"}`);
    }
  });

});

// Changed on purpose in v40 (Decisão do Pi): one version in package.json, a silent update check that
// reloads the same address, and the API on the page's own server (Railway, PR environments, local
// runs) or on Railway from GitHub Pages. The original's behaviour is recorded next to each case.
describe("update check and API address (Decisão do Pi; v40)", () => {
  const OTHER = String(Number(APP_VERSION) + 1);
  const stays = async (app, ms = 800) => {
    await app.page.waitForTimeout(ms);
    return { navigations: [...app.navigations], requests: app.requests.map((r) => `${r.method} ${r.path}`), local: [...app.local], mark: await app.page.evaluate(() => document.querySelector(".mark")?.textContent ?? "") };
  };

  test("Railway: another version on the server reloads the same address with that ?v=, keeping ?draft= and the Telegram #hash", async () => {
    const hash = "#tgWebAppData=x&tgWebAppVersion=8.0";
    const moved = [];
    for (const other of [OTHER, "39"]) {
      const app = await openApp(browser, server, "source", { query: "&draft=0123abcd", hash, health: { ok: true, version: other }, waitForApp: false });
      await app.page.waitForURL((url) => url.searchParams.get("v") === other);
      moved.push(app.page.url());
      await app.close();
    }
    assert.deepEqual(moved, [`${API}/?v=${OTHER}&draft=0123abcd${hash}`, `${API}/?v=39&draft=0123abcd${hash}`]);
    SUMMARY.push(`update check, other version: ${moved.join(" | ")}`);
  });

  test("Railway: same version, or an address that already has the server's ?v= (stale bundle), stays: no reload loop", async () => {
    for (const options of [{}, { version: OTHER, health: { ok: true, version: OTHER } }]) {
      const app = await openApp(browser, server, "source", options);
      const trace = await stays(app);
      await app.close();
      assert.deepEqual(trace.navigations, []);
      assert.deepEqual(trace.requests, ["GET /health"]);
    }
  });

  test("a failed check (503, network error, not JSON, no version) shows nothing and the app keeps working", async () => {
    const failures = {
      503: (route, cors) => route.fulfill({ status: 503, headers: cors, body: "Application failed to respond" }),
      network: (route) => route.abort("connectionrefused"),
      html: (route, cors) => route.fulfill({ status: 200, headers: cors, contentType: "text/html", body: "<html>" }),
      "no version": (route, cors) => route.fulfill({ status: 200, headers: cors, contentType: "application/json", body: "{\"ok\":true}" }),
    };
    const marks = {};
    for (const [name, health] of Object.entries(failures)) {
      const [legacy, source] = await both({ health }, (app) => stays(app));
      assert.deepEqual(source.navigations, [], name);
      assert.equal(source.mark, "", name);
      assert.deepEqual(source.pageErrors, [], name);
      marks[name] = `${JSON.stringify(legacy.mark)} -> ${JSON.stringify(source.mark)}`;
    }
    assert.equal(marks[503], '"failed" -> ""', "the original showed \"failed\" on the plane");
    SUMMARY.push(`failed check, mark original -> now: ${JSON.stringify(marks)}`);
  });

  test("GitHub Pages: drafts go to Railway (CORS), no update check, no move to Railway when versions differ", async () => {
    const health = { ok: true, version: OTHER, webapp: `${API}/?v=${OTHER}` };
    const api = () => ({ status: 404, json: { ok: false } });
    const [legacy, source] = await both({ site: "pages", tg: { ...tg, initDataUnsafe: {} }, health, api, waitForApp: false }, (app) => stays(app, 1500));
    assert.deepEqual(source.navigations, []);
    assert.deepEqual(source.requests, ["GET /drafts/progress"]);
    assert.equal(source.mark, "");
    assert.deepEqual(legacy.navigations, [`${API}/?v=${OTHER}`], "the original left Pages for Railway");
    SUMMARY.push(`Pages: requests ${source.requests.join(", ")}; navigations original ${JSON.stringify(legacy.navigations)} -> now []`);
  });

  test("local server: /health and drafts on the page's own origin, no 'failed' (the original called production, which sends no CORS headers to local pages)", async () => {
    const [legacy, source] = await both({ site: "local", tg: { ...tg, initDataUnsafe: {} }, waitForApp: false }, (app) => stays(app, 1500));
    assert.deepEqual(source.requests, [], "nothing goes to production");
    assert.deepEqual(source.local, ["GET /health 200", "GET /drafts/progress 503"]);
    assert.deepEqual(source.navigations, []);
    assert.equal(source.mark, "");
    assert.equal(legacy.mark, "failed");
    const health = await (await fetch(`${server.origin}/health`)).json();
    assert.equal(health.version, APP_VERSION);
    SUMMARY.push(`local: ${source.local.join(", ")}; original: ${legacy.requests.join(", ")} -> mark ${JSON.stringify(legacy.mark)}`);
  });
});

describe(`audio (${PARITY}; MP3 via @breezystack/lamejs https://github.com/shijinyu/lamejs)`, () => {
  test("playback: messages to web/worklet.js and their offline render (default composition)", async () => {
    const [a, b] = await both({}, async ({ page }) => {
      await page.click(".fn-row:nth-child(1) .play-in");
      await page.waitForTimeout(600);
      const log = await page.evaluate(() => window.__portLog);
      const first = log.find((m) => "rows" in m);
      return { first, kinds: log.map((m) => Object.keys(m).sort().join(",")), samples: await renderWorklet(page, first, 1) };
    });
    assert.deepEqual(b.first, a.first);
    const diff = maxAbsDiff(a.samples, b.samples);
    SUMMARY.push(`worklet render (default composition, 1 s): max |Δsample| = ${diff}, ${a.samples.length} samples`);
    assert.equal(diff, 0);
  });

  test("playback of preset drafts: messages and offline render", async () => {
    for (const voice of [0, 12, 63, 99]) {
      const api = (method, path) => (method === "GET" && path === "/drafts/progress" ? { status: 200, json: presetDraft("progress", voice) } : null);
      const [a, b] = await both({ tg: { ...tg, initDataUnsafe: {} }, api }, async ({ page }) => {
        await settle(page, 300);
        await page.click(".fn-row:nth-child(4) .play-in");
        await page.waitForTimeout(500);
        const first = (await page.evaluate(() => window.__portLog)).find((m) => "rows" in m);
        return { first, samples: await renderWorklet(page, first, 1) };
      });
      assert.deepEqual(b.first, a.first);
      const diff = maxAbsDiff(a.samples, b.samples);
      SUMMARY.push(`worklet render (preset ${voice}, 1 s): max |Δsample| = ${diff}`);
      assert.equal(diff, 0);
    }
  });

  test("Download outside Telegram: MP3 file (0:30, default composition) is byte-identical", async () => {
    const [a, b] = await both({}, async ({ page }) => {
      await page.click(".sh-menu");
      await page.click("text=Time");
      await page.click("button:text-is('0:30')");
      const [download] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.click("[aria-label=Download]")]);
      const bytes = await (await download.createReadStream()).toArray().then((chunks) => Buffer.concat(chunks));
      return { name: download.suggestedFilename(), bytes, decoded: await decodeMp3(page, bytes), mark: await page.locator(".mark").count() };
    });
    assert.equal(b.name, "math-dj-0m30.mp3");
    assert.equal(b.name, a.name);
    assert.equal(sha(b.bytes), sha(a.bytes));
    const diff = maxAbsDiff(a.decoded.samples, b.decoded.samples);
    SUMMARY.push(`MP3 download 0:30: ${b.bytes.length} bytes, sha256 ${sha(b.bytes)} (legacy ${sha(a.bytes)}), decoded ${b.decoded.length} samples @${b.decoded.sampleRate} Hz ${b.decoded.channels} ch, max |Δsample| = ${diff}`);
    assert.equal(diff, 0);
    assert.equal(b.decoded.channels, 1);
  });

  test("Download inside Telegram: POST /song with initData, filename and identical MP3 (preset draft)", async () => {
    for (const voice of [5, 77]) {
      const api = (method, path) => {
        if (method === "GET" && path === "/drafts/progress") return { status: 200, json: presetDraft("progress", voice) };
        if (method === "POST" && path === "/song") return { status: 200, json: { ok: true } };
        return null;
      };
      const [a, b] = await both({ tg: { ...tg, initDataUnsafe: {} }, api }, async ({ page, requests }) => {
        await settle(page, 300);
        await page.click("[aria-label=Download]");
        await page.waitForSelector(".mark", { timeout: 60000 });
        const song = requests.find((r) => r.path === "/song");
        return { mark: await page.textContent(".mark"), song: { ...song, body: null }, bytes: song.body };
      });
      assert.deepEqual(b.song, a.song);
      assert.equal(b.mark, "sent");
      assert.equal(b.song.filename, "math-dj-0m30.mp3");
      assert.equal(b.song.contentType, "audio/mpeg");
      assert.equal(b.song.initData, INIT_DATA);
      assert.equal(sha(b.bytes), sha(a.bytes));
      SUMMARY.push(`MP3 /song preset ${voice}: ${b.bytes.length} bytes, sha256 ${sha(b.bytes)} (legacy ${sha(a.bytes)})`);
    }
  });
});
