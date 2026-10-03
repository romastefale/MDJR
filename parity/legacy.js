// Loads pieces of the original minified bundle (parity/legacy-app.js = web/app.js on
// main at ba3a7e7, version 39) so tests can run the original code next to web/src.
// The minified names below are those of that frozen file.
import fs from "node:fs";

export const LEGACY_BUNDLE = new URL("./legacy-app.js", import.meta.url);
const source = fs.readFileSync(LEGACY_BUNDLE, "utf8");

function slice(from, to) {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  if (start < 0 || end < 0) throw new Error(`legacy bundle: segment ${from} .. ${to} not found`);
  return source.slice(start, end);
}

// Formula language, DSP and helpers (self-contained segments of the original bundle).
const formula = slice("var t1=()=>0", "import{inventHit as t8}");
const voice = slice("function W6(", "function l8(");
const rows = slice("var Oi={", "function i1(");
const encoder = slice("var A6={}", "var At=");

// Rows of the first screen: the argument of bo([...]) in the App's initial state.
export const LEGACY_DEFAULT_ROWS = new Function(`return ${/useState\)\(\(\)=>bo\((\[.*?\])\)\)/.exec(source)[1]}`)();

export function loadLegacy({ inventHit = () => "t" } = {}) {
  const body = `${formula}\n${encoder}\n${rows}\n${voice}\nreturn {
    DEFAULT_PATCH: Ts, VARIABLES: j9, MATH_FUNCTIONS: G9, looksLikeJs: k5, tokenize: K5, parse: J5,
    toJs: La, toSheet: Le, toDisplay: Es, compileFormula: I5, createLowpass: F5, createDcBlock: P5,
    compileRow: W6, sampleRow: Ls, normalizeRows: bo, rowFromDraft: P6, clampBpm: wi, clampVolume: po,
    withRowColors: e8, encodeMp3: F6, Mp3Encoder: J6, APP_VERSION: Bv, SAMPLE_RATE: Hs, ROW_COUNT: Vs,
    VIEW_SECONDS: vu, ROW_COLORS: xi, DURATIONS: Nv,
  };`;
  return new Function("t8", body)(inventHit);
}
