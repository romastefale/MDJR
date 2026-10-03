// Formula language, row helpers, DSP and MP3 encoder of web/src against the same code taken
// verbatim from the original bundle (parity/legacy-app.js).
// Source of every expectation: paridade com o bundle original ba3a7e7.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { LEGACY_DEFAULT_ROWS, loadLegacy } from "../parity/legacy.js";
import * as formula from "../web/src/formula.js";
import { createDcBlock, createLowpass } from "../web/src/dsp.js";
import { encodeMp3 } from "../web/src/mp3.js";
import * as config from "../web/src/config.js";
import { clampBpm, clampVolume, DEFAULT_ROWS, rowFromDraft, withRowColors } from "../web/src/rows.js";
import { CARDS } from "../web/hits.js";

const legacy = loadLegacy();

function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Hand-picked inputs: both dialects, Portuguese aliases, operators, every error code.
const HAND = [
  "", "   ", "t", "x", "sin(t)", "SIN(t)", "SEN(t)", "sen(t)", "Sen(t)", "POTENCIA(t;2)", "POTENCIA(t,2)", "POWER(t,2)", "POW(t,2)",
  "pow(t,2)", "t^2", "t^2^3", "-t^2", "2^-t", "PI", "PI()", "pi", "E", "E()", "2*PI*220*t", "2*PI()*220*t",
  "sin(2*PI*(220*y)*t)*exp(-6*z*((t*(bpm/60)*x)%1))", "SIN(2*PI()*(220*y)*t)*EXP(-6*z*MOD(t*(bpm/60)*x,1))",
  "MOD(t;1)", "MOD(t,1)", "mod(t,1)", "t%1", "t % 1", "50%", "50%*t", "t*50%", "(t)%", "t%%",
  "IF(t>1;1;0)", "SE(t>1;1;0)", "if(t>1,1,0)", "t>1?1:0", "t>1 ? sin(t) : cos(t)", "t ? 1 : 0 ? 2 : 3", "t ?", "t ? 1",
  "t=1", "t==1", "t<>1", "t!=1", "t<=1", "t>=1", "t<1", "t>1", "t>1 AND t<2", "t>1 and t<2", "t>1 OR t<2", "t>1 or t<2",
  "t>1&&t<2", "t>1||t<2", "BITAND(t,3)", "t&3", "t>>1", "BITRSHIFT(t*1000,2)", "INDEX({1,2,3},2)*t", "INDEX({1;2;3};2)*t",
  "[1,2,3][1]*t", "{1,2,3}", "[1,2][t>1]", "[]", "{}", "[1,]", "f(t)", "foo", "t+foo", "SIN(t)+BAR(t)", "Math.sin(t)",
  "window", "document.cookie", "this", "new Date()", "eval(t)", "constructor", "__proto__", "t=>t", "function(){}", "'t'",
  "\"t\"", "`t`", "t\\1", "t;", "t,", "(t", "t)", "((t))", "t +", "+t", "--t", "-+t", "1/0", "0/0*t", "log(0)*t",
  "sqrt(-1)*t", "1e3*t", "1.5*t", ".5*t", "5.*t", "0x10*t", "t @ 2", "t # 2", "t $ 2", "t ~ 2", "!t", "t!", "!(t>1)",
  "t // comment", "t /* c */ + 1", "/* only */", "// only", "t\n+1", "sin (t)", "SIN (t)", "PI (t)", "PI(t)", "pi()",
  "abs(-t)", "ABS(-t)", "floor(t*4)/4", "FLOOR(t*4)/4", "ceil(t)", "round(t)", "min(t,1)", "MIN(t;1)", "max(t,1,2)",
  "tanh(t)", "TANH(t)", "sign(t-1)", "log2(t)", "LOG10(t)", "hypot(t,1)", "HYPOT(t;1)", "atan2(t,1)", "ATAN2(t;1)",
  "asin(t)", "ACOS(t)", "atan(t)", "tan(t)", "cos(t)", "COS(t)", "exp(-t)", "EXP(-t)", "t*bpm/60", "t*v", "t*w+a+b+g+d",
  "t*q", "T", "t2", "_t", "t_", "1 2", "t t", "sin t", "sin()", "SIN()", "max()*t", "t*(1+2", "1+2)*t", "t[0]", "t[",
  "(1,2)", "SIN(t;1)", "IF(t;1)", "IF(t;1;2;3)", "MOD(t)", "INDEX(t)", "POWER(t)", "-(-t)", "- - t", "t - -1", "t- -1",
  "t*-1", "t/-2", "a-b-c+t", "a-(b-c)+t", "a/(b/c)+t", "(a/b)/c+t", "a*(b+c)*t", "(a+b)*(c+d)*t", "t^(1/2)", "(t^2)^3",
  "2^3^t", "-(t^2)", "(-t)^2", "1<2<t", "(t>1)+(t<2)", "t>1==1", "t>1=1", "t&3>>1", "t>>1&3", "t+1&3", "IF(t>1,t%2,MOD(t,3))",
  "t?1:2+3", "(t?1:2)+3", "x?y:z", "SE(t>1;POTENCIA(t;2);SEN(t))", "sen(t)+POTENCIA(t,2)", "SEN(t)%", "100%*t", "t%+1",
];

function fuzz(count, seed) {
  const random = prng(seed);
  const atoms = ["t", "x", "y", "bpm", "1", "2", ".5", "60", "PI", "PI()", "E", "sin(", "SIN(", "SEN(", "cos(", "exp(", "POTENCIA(", "pow(",
    "MOD(", "IF(", "SE(", "INDEX(", "BITAND(", "max(", "min(", "(", ")", "[", "]", "{", "}", ",", ";", "+", "-", "*", "/", "%", "^",
    "?", ":", "<", ">", "<=", ">=", "=", "==", "<>", "!=", "&&", "||", "&", ">>", "AND", "OR", " ", "foo", "q", "@", "'"];
  const out = [];
  for (let i = 0; i < count; i++) {
    const length = 1 + Math.floor(random() * 14);
    let text = "";
    for (let k = 0; k < length; k++) text += atoms[Math.floor(random() * atoms.length)];
    out.push(text);
  }
  return out;
}

const VOICES = CARDS.flatMap((card) => card.voices);
const CORPUS = [...HAND, ...VOICES, ...VOICES.map((v) => legacy.toDisplay(v)), ...fuzz(6000, 20261003)];
const PATCHES = [legacy.DEFAULT_PATCH, { ...legacy.DEFAULT_PATCH, x: 2, y: 0.5, z: 3, w: -1, a: 0.4, b: 0.8, g: 0.6, d: 1.5 }];
const TIMES = [0, 0.02, 0.137, 0.5, 1.25, 3.999, 17.3];

function outcome(fn) {
  try {
    return { value: fn() };
  } catch (err) {
    return { threw: String(err?.message ?? err) };
  }
}

function samples(lib, compiled) {
  const out = [];
  for (const patch of PATCHES) for (const t of TIMES) out.push(lib.sampleRow(compiled, patch, t, 137));
  return out;
}

describe("formula language (paridade com o bundle original ba3a7e7)", () => {
  test("constants: default patch, variables, Math functions", () => {
    assert.deepEqual(formula.DEFAULT_PATCH, legacy.DEFAULT_PATCH);
    assert.deepEqual([...formula.VARIABLES], [...legacy.VARIABLES]);
    assert.deepEqual([...formula.MATH_FUNCTIONS], [...legacy.MATH_FUNCTIONS]);
    assert.deepEqual([...formula.VARIABLES], ["t", "x", "y", "z", "w", "v", "bpm", "a", "b", "g", "d"]);
    assert.equal(formula.DEFAULT_PATCH.presetId, "percussion_kick");
    assert.equal(formula.DEFAULT_PATCH.formula, "sin(2*PI*(220*y)*t)*exp(-6*z*((t*(bpm/60)*x)%1))");
    assert.equal(formula.DEFAULT_PATCH.bpm, 120);
  });

  test(`tokenize / looksLikeJs / parse / toJs / toSheet / toDisplay on ${CORPUS.length} inputs`, () => {
    let mismatches = 0;
    for (const text of CORPUS) {
      const pairs = [
        [() => legacy.tokenize(text), () => formula.tokenize(text)],
        [() => legacy.looksLikeJs(text), () => formula.looksLikeJs(text)],
        [() => legacy.toDisplay(text), () => formula.toDisplay(text)],
        [() => legacy.parse(legacy.tokenize(text), true), () => formula.parse(formula.tokenize(text), true)],
        [() => legacy.parse(legacy.tokenize(text), false), () => formula.parse(formula.tokenize(text), false)],
        [() => legacy.toJs(legacy.parse(legacy.tokenize(text), true)), () => formula.toJs(formula.parse(formula.tokenize(text), true))],
        [() => legacy.toSheet(legacy.parse(legacy.tokenize(text), false)), () => formula.toSheet(formula.parse(formula.tokenize(text), false))],
      ];
      for (const [old, now] of pairs) {
        const a = outcome(old);
        const b = outcome(now);
        try {
          assert.deepEqual(b, a);
        } catch (err) {
          mismatches += 1;
          if (mismatches < 5) console.error(JSON.stringify(text), err.message);
        }
      }
    }
    assert.equal(mismatches, 0);
  });

  test(`compileFormula / compileRow / sampleRow give the same ok, error, js and samples on ${CORPUS.length} inputs`, () => {
    let mismatches = 0;
    let errors = 0;
    for (const text of CORPUS) {
      for (const compile of ["compileFormula", "compileRow"]) {
        const a = legacy[compile](text);
        const b = formula[compile](text);
        if (!a.ok) errors += 1;
        const same = a.ok === b.ok && a.error === b.error && a.js === b.js && samples(legacy, a).every((v, i) => Object.is(v, samples(formula, b)[i]));
        if (!same) {
          mismatches += 1;
          if (mismatches < 5) console.error(JSON.stringify(text), a.error, b.error, a.js, b.js);
        }
      }
    }
    assert.equal(mismatches, 0);
    assert.ok(errors > 1000, "the corpus exercises the error paths");
  });

  test("error codes of the validator (VAZIA, BLOQUEADA, SINTAXE, IDENT, SEM T) match", () => {
    const cases = {
      "": "VAZIA", "// x": "VAZIA", "'t'": "BLOQUEADA", "window": "BLOQUEADA", "t=>t": "BLOQUEADA", "__proto__": "BLOQUEADA",
      "t@2": "SINTAXE", "(t": "SINTAXE", "t#2": "SINTAXE", "t+foo": "IDENT foo", "Math.sin(t)": "IDENT Math"
    };
    // "NAN" is unreachable in the original: the compiled function already maps non-finite values to 0.
    for (const lib of [legacy, formula]) {
      const nan = lib.compileFormula("sqrt(-1)+t");
      assert.equal(nan.ok, true);
      assert.equal(lib.sampleRow(nan, lib.DEFAULT_PATCH, 1, 120), 0);
    }
    for (const [text, code] of Object.entries(cases)) {
      assert.equal(legacy.compileFormula(text).error, code, `legacy ${text}`);
      assert.equal(formula.compileFormula(text).error, code, `source ${text}`);
    }
    // A row must depend on t before it is validated at all.
    for (const text of ["", "x", "1+2", "SEN(x)"]) {
      assert.equal(legacy.compileRow(text).error, "SEM T");
      assert.equal(formula.compileRow(text).error, "SEM T");
    }
  });

  test("Portuguese aliases and spreadsheet forms compile to the same JavaScript", () => {
    for (const [text, js] of [
      ["SEN(t)", "Math.sin(t)"],
      ["POTENCIA(t;2)", "Math.pow(t,2)"],
      ["SE(t>1;1;0)", "((t>1)?1:0)"],
      ["MOD(t;1)", "(t%1)"],
      ["50%*t", "((50/100)*t)"],
    ]) {
      assert.equal(legacy.compileFormula(text).js, js);
      assert.equal(formula.compileFormula(text).js, js);
    }
  });
});

describe("row helpers and constants (paridade com o bundle original ba3a7e7)", () => {
  test("config constants", () => {
    assert.equal(config.APP_VERSION, legacy.APP_VERSION);
    assert.equal(config.SAMPLE_RATE, legacy.SAMPLE_RATE);
    assert.equal(config.ROW_COUNT, legacy.ROW_COUNT);
    assert.equal(config.VIEW_SECONDS, legacy.VIEW_SECONDS);
    assert.deepEqual(config.ROW_COLORS, legacy.ROW_COLORS);
    assert.deepEqual(config.DURATIONS, legacy.DURATIONS);
  });

  test("first-screen composition: the five default rows (150 BPM, volume 1)", () => {
    assert.deepEqual(DEFAULT_ROWS, LEGACY_DEFAULT_ROWS);
    assert.equal(DEFAULT_ROWS.length, 5);
    for (const row of DEFAULT_ROWS) assert.equal(formula.compileRow(row.y).ok, true, row.y);
  });

  test("clampBpm / clampVolume / rowFromDraft / withRowColors", () => {
    const values = [undefined, null, "", "abc", NaN, Infinity, -Infinity, -5, 0, 0.4, 0.5, 1, 79.4, 79.5, 80, 120.5, 180, 180.6, 999, "150", "0.3", true, [], {}];
    for (const v of values) {
      assert.ok(Object.is(clampBpm(v), legacy.clampBpm(v)), `bpm ${String(v)}`);
      assert.ok(Object.is(clampVolume(v), legacy.clampVolume(v)), `vol ${String(v)}`);
    }
    const drafts = [{}, { id: 3, y: "t", on: false, color: "red", bpm: "100", vol: "0.2" }, { on: 0, bpm: null, vol: undefined }, { id: -1, y: null, on: true }];
    for (const d of drafts) assert.deepEqual(rowFromDraft(d), legacy.rowFromDraft(d));
    const rows = Array.from({ length: 7 }, (_, i) => ({ id: i, y: "t", color: "x" }));
    assert.deepEqual(withRowColors(rows), legacy.withRowColors(rows));
  });

  test("normalizeRows fills the five rows from hits.js the same way", async () => {
    // Two separate hits.js instances (different URLs) so each side keeps its own "last voice" memory.
    const oldHits = await import("../web/hits.js?side=legacy");
    const newRows = await import("../web/src/rows.js");
    const old = loadLegacy({ inventHit: oldHits.inventHit });
    const inputs = [[], [{ y: "sin(2*PI*220*t)", on: false, bpm: 200, vol: 3 }], [{ id: 0, y: "SEN(t)" }, { id: 9, y: "x" }]];
    const real = Math.random;
    try {
      for (const input of inputs) {
        Math.random = prng(7);
        const a = old.normalizeRows(input).map(({ id, ...row }) => row);
        Math.random = prng(7);
        const b = newRows.normalizeRows(input).map(({ id, ...row }) => row);
        assert.deepEqual(b, a);
      }
    } finally {
      Math.random = real;
    }
  });
});

// Mirrors the offline render of the Download button (filter, DC block, scale, clamp) with each side's own functions.
async function renderMp3(lib, formulas, { seconds = 1, patch = lib.DEFAULT_PATCH, scale = 1.15, bpm = 120, vol = 0.75 } = {}) {
  const voices = formulas.map((y) => lib.compileRow(y));
  const lowpass = lib.createLowpass(44100);
  const dc = lib.createDcBlock();
  lowpass.set(patch.lpf, patch.res);
  const gain = patch.muted ? 0 : 1;
  const pcm = [];
  const blob = await lib.encodeMp3(Math.floor(seconds * 44100), 44100, (offset, block) => {
    for (let i = 0; i < block.length; i++) {
      let sum = 0;
      let n = 0;
      voices.forEach((voice) => {
        if (!voice.ok) return;
        sum += lib.sampleRow(voice, patch, (offset + i) / 44100, bpm) * vol;
        n += 1;
      });
      block[i] = Math.max(-0.98, Math.min(0.98, lowpass.process(dc((n ? sum / n : 0) / Math.max(1, scale))) * gain));
      pcm.push(block[i]);
    }
  });
  return { bytes: new Uint8Array(await blob.arrayBuffer()), pcm, type: blob.type };
}

const NEW_LIB = { ...formula, createLowpass, createDcBlock, encodeMp3 };

describe("offline render + MP3 encoder (paridade com o bundle original ba3a7e7; encoder https://github.com/shijinyu/lamejs)", () => {
  test("lowpass and DC blocker produce identical samples", () => {
    for (const [freq, q] of [[16000, 0.7], [800, 4], [20, 0.1], [30000, 1]]) {
      const a = legacy.createLowpass(44100);
      const b = createLowpass(44100);
      const da = legacy.createDcBlock();
      const db = createDcBlock();
      a.set(freq, q);
      b.set(freq, q);
      for (let i = 0; i < 5000; i++) {
        const x = Math.sin(i * 0.37) + (i % 97 === 0 ? 5 : 0);
        assert.ok(Object.is(a.process(x), b.process(x)));
        assert.ok(Object.is(da(x), db(x)));
      }
    }
  });

  test("128 kbps mono MP3 of the default kick and one voice of each card is byte-identical", async () => {
    const compositions = [
      [legacy.DEFAULT_PATCH.formula],
      ...CARDS.map((card, i) => [card.voices[(i * 23) % card.voices.length]]),
      CARDS.map((card) => legacy.toDisplay(card.voices[7])),
    ];
    for (const formulas of compositions) {
      const a = await renderMp3(legacy, formulas);
      const b = await renderMp3(NEW_LIB, formulas);
      assert.equal(b.type, "audio/mpeg");
      assert.deepEqual(b.pcm, a.pcm);
      assert.deepEqual(b.bytes, a.bytes);
      // MPEG-1 Layer III, 128 kbps, 44.1 kHz, mono (frame header https://www.mp3-tech.org/programmer/frame_header.html)
      assert.deepEqual([...b.bytes.slice(0, 2)], [0xff, 0xfb]);
      assert.equal(b.bytes[2] >> 4, 0b1001);
      assert.equal((b.bytes[3] >> 6) & 3, 3);
    }
  });

  test("patch fields (x..d, lpf, res, muted) shape the render identically", async () => {
    const patch = { ...legacy.DEFAULT_PATCH, x: 2, y: 0.7, z: 1.4, lpf: 900, res: 3 };
    const formulas = [CARDS[3].voices[11], "SE(t>0.5;SEN(2*PI()*220*t);0)"];
    for (const p of [patch, { ...patch, muted: true }]) {
      const a = await renderMp3(legacy, formulas, { patch: p, scale: 1.6, seconds: 0.6 });
      const b = await renderMp3(NEW_LIB, formulas, { patch: p, scale: 1.6, seconds: 0.6 });
      assert.deepEqual(b.bytes, a.bytes);
    }
  });
});
