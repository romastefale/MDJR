// The served bundle (web/app.js) is the build of web/src, and its third-party code is the same as
// in the original bundle. Sources: paridade com o bundle original ba3a7e7; esbuild API
// https://esbuild.github.io/api/#build
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { APP_VERSION, buildWeb, indexHtml } from "../scripts/build-web.mjs";
import { LEGACY_BUNDLE } from "../parity/legacy.js";

const read = (file) => fs.readFileSync(new URL(file, import.meta.url), "utf8");

test("web/app.js is exactly what `npm run build` produces from web/src (commit the build)", async () => {
  assert.equal(await buildWeb(), read("../web/app.js"));
});

// Decisão do Pi: the version lives only in package.json; the build stamps it everywhere the page needs it.
test("index.html loads app.js and desk.css with ?v= = package.json version, as written by the build", () => {
  const html = read("../web/index.html");
  assert.equal(APP_VERSION, JSON.parse(read("../package.json")).version);
  assert.equal(indexHtml(html), html);
  assert.deepEqual([...html.matchAll(/\.\/(app\.js|desk\.css)\?v=([^"]*)/g)].map((m) => `${m[1]} ${m[2]}`), [`desk.css ${APP_VERSION}`, `app.js ${APP_VERSION}`]);
  assert.equal(indexHtml(html.replaceAll(`?v=${APP_VERSION}`, "?v=1")), html);
});

test("the bundle loads hits.js and worklet.js with ?v= = package.json version, like the original with its own", () => {
  const legacy = fs.readFileSync(LEGACY_BUNDLE, "utf8");
  assert.ok(legacy.includes('from"./hits.js?v=39"') && legacy.includes('"./worklet.js?v=39"'));
  const bundle = read("../web/app.js");
  assert.ok(bundle.includes(`from"./hits.js?v=${APP_VERSION}"`));
  // esbuild inlines the version into the template literal: `./worklet.js?v=${"40"}` is the same string.
  assert.ok(bundle.includes(`\`./worklet.js?v=\${"${APP_VERSION}"}\``));
  assert.ok(!bundle.includes("__APP_VERSION__"));
  assert.match(bundle, /"mdjr-mix"/);
});

// Identifiers are renamed by the minifier; everything else must match token for token.
function vendorRegions(code) {
  const react = /var [\w$]+=[\w$]+\([\w$]+\(\),1\);/.exec(code);
  const lameStart = /var [\w$]+=\{\};function [\w$]+\(t\)\{return new Int8Array\(t\)\}/.exec(code);
  const lameEnd = /\.WavHeader=[\w$]+;/.exec(code);
  const normalize = (text) => text.replace(/[A-Za-z_$][\w$]*/g, "i");
  return {
    size: react.index + (lameEnd.index - lameStart.index),
    react: normalize(code.slice(0, react.index)),
    lamejs: normalize(code.slice(lameStart.index, lameEnd.index + lameEnd[0].length)),
    licenses: code.slice(code.indexOf("/*! Bundled license information")),
  };
}

test("React 19.3.0 / react-dom 19.3.0 / scheduler and @breezystack/lamejs code equal the original bundle's", () => {
  const legacy = vendorRegions(fs.readFileSync(LEGACY_BUNDLE, "utf8"));
  const current = vendorRegions(read("../web/app.js"));
  assert.ok(legacy.size > 390_000, "the regions cover React and the encoder");
  assert.equal(current.react, legacy.react);
  assert.equal(current.lamejs, legacy.lamejs);
  assert.equal(current.licenses, legacy.licenses);
  const pkg = JSON.parse(read("../package.json"));
  assert.equal(pkg.dependencies.react, "19.3.0");
  assert.equal(pkg.dependencies["react-dom"], "19.3.0");
  assert.equal(pkg.dependencies["@breezystack/lamejs"], "1.2.7");
});
