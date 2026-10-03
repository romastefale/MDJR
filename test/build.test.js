// The served bundle (web/app.js) is the build of web/src, and its third-party code is the same as
// in the original bundle. Sources: paridade com o bundle original ba3a7e7; esbuild API
// https://esbuild.github.io/api/#build
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildWeb, versionProblems } from "../scripts/build-web.mjs";
import { LEGACY_BUNDLE } from "../parity/legacy.js";
import { APP_VERSION } from "../web/src/config.js";

const read = (file) => fs.readFileSync(new URL(file, import.meta.url), "utf8");

test("web/app.js is exactly what `npm run build` produces from web/src (commit the build)", async () => {
  assert.equal(await buildWeb(), read("../web/app.js"));
});

test("index.html (?v=), bot/server.js APP_VERSION and web/src/config.js agree on the version", () => {
  assert.deepEqual(versionProblems(), []);
});

test("the bundle loads hits.js and worklet.js with the same ?v= as the original", () => {
  const bundle = read("../web/app.js");
  const legacy = fs.readFileSync(LEGACY_BUNDLE, "utf8");
  const v = APP_VERSION;
  for (const code of [legacy, bundle]) {
    assert.ok(code.includes(`from"./hits.js?v=${v}"`));
    // esbuild inlines APP_VERSION into the template literal: `./worklet.js?v=${"39"}` is the same string.
    assert.ok(code.includes(`"./worklet.js?v=${v}"`) || code.includes(`\`./worklet.js?v=\${"${v}"}\``));
    assert.match(code, /"mdjr-mix"/);
  }
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
