// Formula language of the rows. A row can be typed in two dialects:
//  - JavaScript-like: sin(2*PI*220*t), a ? b : c, x % 1
//  - spreadsheet-like: SIN(2*PI()*220*t), IF(a;b;c), MOD(x;1), POTENCIA(x;2), 50%
// Rows are stored and shown in the spreadsheet dialect (toDisplay) and run as JavaScript
// (compileFormula) both here and in web/worklet.js.

const ZERO = () => 0;

// Initial sound patch. Only x..d, lpf, res and muted reach the audio; the other fields are
// carried in drafts as they were in the original app.
export const DEFAULT_PATCH = {
  mode: "preset",
  presetId: "percussion_kick",
  formula: "sin(2*PI*(220*y)*t)*exp(-6*z*((t*(bpm/60)*x)%1))",
  engine: "raw",
  x: 1,
  y: 1,
  z: 1,
  w: 1,
  a: 0,
  b: 0,
  g: 0,
  d: 1,
  bpm: 120,
  vol: 0.75,
  lpf: 16000,
  res: 0.7,
  pan: 0,
  seconds: 8,
  muted: false,
};

// Names a formula may use: the variables passed to every compiled formula ...
export const VARIABLES = new Set(["t", "x", "y", "z", "w", "v", "bpm", "a", "b", "g", "d"]);
// ... and members of Math.
export const MATH_FUNCTIONS = new Set([
  "sin", "cos", "tan", "asin", "acos", "atan", "atan2", "exp", "abs", "PI", "E", "pow", "floor", "ceil",
  "round", "min", "max", "tanh", "sign", "log", "log2", "log10", "sqrt", "hypot",
]);

// JavaScript name -> spreadsheet name (used when displaying).
const SHEET_NAME = {
  sin: "SIN", cos: "COS", tan: "TAN", tanh: "TANH", asin: "ASIN", acos: "ACOS", atan: "ATAN", atan2: "ATAN2",
  exp: "EXP", abs: "ABS", floor: "FLOOR", ceil: "CEIL", round: "ROUND", min: "MIN", max: "MAX", sqrt: "SQRT",
  log: "LOG", log10: "LOG10", log2: "LOG2", sign: "SIGN", hypot: "HYPOT", pow: "POWER",
};

// Spreadsheet name (upper case, English and Portuguese) -> JavaScript name.
const JS_NAME = {
  SIN: "sin", SEN: "sin", COS: "cos", TAN: "tan", TANH: "tanh", ASIN: "asin", ACOS: "acos", ATAN: "atan",
  ATAN2: "atan2", EXP: "exp", ABS: "abs", FLOOR: "floor", CEIL: "ceil", ROUND: "round", MIN: "min", MAX: "max",
  SQRT: "sqrt", LOG: "log", LOG10: "log10", LOG2: "log2", SIGN: "sign", HYPOT: "hypot",
  POW: "pow", POWER: "pow", POTENCIA: "pow",
};

// True when the text is written in the JavaScript dialect: a lower-case Math call, a bare PI,
// a ternary "?", or "%" used as an operator (followed by an operand).
export function looksLikeJs(text) {
  if (/\b(?:sin|cos|tan|tanh|asin|acos|atan2?|exp|abs|floor|ceil|round|pow|sqrt|log10|log2|log|min|max|sign|hypot)\s*\(|(?<![\w])PI(?!\s*\()|\?/.test(text)) {
    return true;
  }
  return /%(?=\s*[\d.(A-Za-z])/.test(text);
}

export function tokenize(text) {
  const tokens = [];
  const pattern = /\s+|<>|<=|>=|==|!=|&&|\|\||>>|\d+\.\d*|\.\d+|\d+|[A-Za-z_][A-Za-z0-9_]*|./g;
  let match;
  while ((match = pattern.exec(text))) {
    if (match[0].trim()) tokens.push(match[0]);
  }
  return tokens;
}

// Recursive-descent parser. Node kinds: n (number), id, un, bin, cond, call, arr, idx.
// In the spreadsheet dialect (`sheet`): OR/AND words, ";" separators, postfix "%" (= /100) and no
// "?:" ternary; in the JavaScript dialect "%" is the remainder operator.
export function parse(tokens, sheet) {
  let pos = 0;
  const peek = () => tokens[pos] || "";
  const take = (expected) => {
    const token = tokens[pos];
    if (token === undefined || (expected !== undefined && token !== expected)) throw new Error("sintaxe");
    pos += 1;
    return token;
  };

  const conditional = () => {
    const test = or();
    if (!sheet && peek() === "?") {
      take("?");
      const yes = conditional();
      take(":");
      return { k: "cond", c: test, a: yes, b: conditional() };
    }
    return test;
  };
  const or = () => {
    let node = and();
    while (peek() === "||" || (sheet && peek().toUpperCase() === "OR")) {
      take();
      node = { k: "bin", op: "||", l: node, r: and() };
    }
    return node;
  };
  const and = () => {
    let node = bitwise();
    while (peek() === "&&" || (sheet && peek().toUpperCase() === "AND")) {
      take();
      node = { k: "bin", op: "&&", l: node, r: bitwise() };
    }
    return node;
  };
  const bitwise = () => {
    let node = comparison();
    while (peek() === "&" || peek() === ">>") node = { k: "bin", op: take(), l: node, r: comparison() };
    return node;
  };
  const comparison = () => {
    let node = additive();
    while (["<", ">", "<=", ">=", "==", "!=", "=", "<>"].includes(peek())) {
      const op = take();
      node = { k: "bin", op: op === "=" ? "==" : op === "<>" ? "!=" : op, l: node, r: additive() };
    }
    return node;
  };
  const additive = () => {
    let node = multiplicative();
    while (peek() === "+" || peek() === "-") node = { k: "bin", op: take(), l: node, r: multiplicative() };
    return node;
  };
  const multiplicative = () => {
    let node = power();
    while (peek() === "*" || peek() === "/" || (!sheet && peek() === "%")) node = { k: "bin", op: take(), l: node, r: power() };
    return node;
  };
  const power = () => {
    const base = unary();
    if (peek() === "^") {
      take("^");
      return { k: "bin", op: "^", l: base, r: power() };
    }
    return base;
  };
  const unary = () => (peek() === "-" || peek() === "+" ? { k: "un", op: take(), x: unary() } : postfix());
  const list = (close) => {
    const items = [];
    if (peek() !== close) {
      items.push(conditional());
      while (peek() === "," || peek() === ";") {
        take();
        items.push(conditional());
      }
    }
    return items;
  };
  const postfix = () => {
    let node = primary();
    while (peek() === "(" || peek() === "[" || (sheet && peek() === "%")) {
      if (peek() === "%") {
        take("%");
        node = { k: "bin", op: "/", l: node, r: { k: "n", v: "100" } };
      } else if (peek() === "(" && node.k === "id") {
        take("(");
        const args = list(")");
        take(")");
        node = { k: "call", name: node.v, args };
      } else if (peek() === "[") {
        take("[");
        const index = conditional();
        take("]");
        node = { k: "idx", x: node, i: index };
      } else {
        break;
      }
    }
    return node;
  };
  const primary = () => {
    const token = peek();
    if (token === "(") {
      take("(");
      const inner = conditional();
      take(")");
      return inner;
    }
    if (token === "[" || token === "{") {
      take();
      const close = token === "[" ? "]" : "}";
      const items = list(close);
      take(close);
      return { k: "arr", items };
    }
    if (/^(?:\d|\.\d)/.test(token)) return { k: "n", v: take() };
    if (/^[A-Za-z_]/.test(token)) return { k: "id", v: take() };
    throw new Error("sintaxe");
  };

  const tree = conditional();
  if (pos !== tokens.length) throw new Error("sintaxe");
  return tree;
}

// Tree -> JavaScript source (fully parenthesised).
export function toJs(node) {
  if (node.k === "n" || node.k === "id") return node.v;
  if (node.k === "un") return `${node.op}${toJs(node.x)}`;
  if (node.k === "bin") return node.op === "^" ? `pow(${toJs(node.l)},${toJs(node.r)})` : `(${toJs(node.l)}${node.op}${toJs(node.r)})`;
  if (node.k === "cond") return `(${toJs(node.c)}?${toJs(node.a)}:${toJs(node.b)})`;
  if (node.k === "arr") return `[${node.items.map(toJs).join(",")}]`;
  if (node.k === "idx") return `(${toJs(node.x)}[${toJs(node.i)}])`;
  const name = node.name.toUpperCase();
  const args = node.args.map(toJs);
  if (name === "PI") return "PI";
  if (name === "MOD" && args.length === 2) return `(${args[0]}%${args[1]})`;
  if ((name === "IF" || name === "SE") && args.length === 3) return `(${args[0]}?${args[1]}:${args[2]})`;
  if (name === "BITAND" && args.length === 2) return `(${args[0]}&${args[1]})`;
  if (name === "BITRSHIFT" && args.length === 2) return `(${args[0]}>>${args[1]})`;
  if (name === "INDEX" && args.length === 2) return `(${args[0]}[(${args[1]})-1])`;
  if (name === "POWER" && args.length === 2) return `pow(${args[0]},${args[1]})`;
  return `${JS_NAME[name] || node.name}(${args.join(",")})`;
}

// Tree -> spreadsheet source with minimal parentheses. `outer` is the precedence of the parent:
// 3 comparison/logic, 4 + -, 5 * /, 6 unary operand, 7 function-call form.
export function toSheet(node, outer = 0) {
  const wrap = (text, precedence) => (precedence < outer ? `(${text})` : text);
  if (node.k === "n") return node.v;
  if (node.k === "id") return node.v === "PI" ? "PI()" : node.v;
  if (node.k === "un") return `${node.op}${toSheet(node.x, 6)}`;
  if (node.k === "bin") {
    if (node.op === "%") return wrap(`MOD(${toSheet(node.l)},${toSheet(node.r)})`, 7);
    if (node.op === "^") return wrap(`POWER(${toSheet(node.l)},${toSheet(node.r)})`, 7);
    if (node.op === "&") return wrap(`BITAND(${toSheet(node.l)},${toSheet(node.r)})`, 7);
    if (node.op === ">>") return wrap(`BITRSHIFT(${toSheet(node.l)},${toSheet(node.r)})`, 7);
    const precedence = node.op === "*" || node.op === "/" ? 5 : node.op === "+" || node.op === "-" ? 4 : 3;
    const right = node.op === "-" || node.op === "/" ? precedence + 1 : precedence;
    return wrap(`${toSheet(node.l, precedence)}${node.op}${toSheet(node.r, right)}`, precedence);
  }
  if (node.k === "cond") return wrap(`IF(${toSheet(node.c)},${toSheet(node.a)},${toSheet(node.b)})`, 7);
  if (node.k === "arr") return `{${node.items.map((item) => toSheet(item)).join(",")}}`;
  if (node.k === "idx") return wrap(`INDEX(${toSheet(node.x)},${toSheet(node.i)}+1)`, 7);
  if (node.name === "pow" && node.args.length === 2) return wrap(`POWER(${node.args.map((arg) => toSheet(arg)).join(",")})`, 7);
  const name = SHEET_NAME[node.name] || node.name.toUpperCase();
  return wrap(`${name}(${node.args.map((arg) => toSheet(arg)).join(",")})`, 7);
}

// What a row shows: the formula rewritten in the spreadsheet dialect, or the text unchanged
// when it does not parse.
export function toDisplay(formula) {
  const text = String(formula || "").trim();
  if (!text) return text;
  try {
    return toSheet(parse(tokenize(text), !looksLikeJs(text)));
  } catch {
    return text;
  }
}

function sheetToJs(text) {
  return toJs(parse(tokenize(text), true));
}

const failed = (error) => ({ ok: false, error, js: "", fn: ZERO });

// Validates a formula and compiles it to fn(t, x, y, z, w, v, bpm, a, b, g, d). The error codes
// are shown on the row: VAZIA, BLOQUEADA, SINTAXE, CARACTERE, "IDENT <name>", NAN.
export function compileFormula(formula) {
  try {
    const text = String(formula)
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/.*$/gm, " ")
      .trim();
    if (!text) return failed("VAZIA");
    if (/["'`\\]|=>|\bfunction\b|\bnew\b|\bthis\b|\bwindow\b|\bglobal\b|\bdocument\b|\beval\b|\bconstructor\b|\bprototype\b|__/.test(text)) {
      return failed("BLOQUEADA");
    }
    let js = text;
    if (!looksLikeJs(text)) {
      try {
        js = sheetToJs(text);
      } catch {
        return failed("SINTAXE");
      }
    }
    if (!/^[\w\s+\-*/%().,<>=!&|?:[\]]+$/.test(js)) return failed("CARACTERE");
    let unknown = "";
    const source = js.replace(/\b[A-Za-z_][A-Za-z0-9_]*\b/g, (name) => {
      if (VARIABLES.has(name)) return name;
      if (MATH_FUNCTIONS.has(name)) return `Math.${name}`;
      unknown = name;
      return name;
    });
    if (unknown) return failed(`IDENT ${unknown}`);
    const fn = new Function("t", "x", "y", "z", "w", "v", "bpm", "a", "b", "g", "d", `"use strict"; const val = (${source}); return Number.isFinite(val) ? val : 0;`);
    const probe = fn(0.02, 1, 1, 1, 1, 1, 120, 0.4, 0.8, 0.6, 1);
    return Number.isFinite(probe) ? { ok: true, error: "", js: source, fn } : failed("NAN");
  } catch {
    return failed("SINTAXE");
  }
}

// A row only sounds when its formula depends on time.
export function compileRow(formula) {
  return /\bt\b/.test(formula) ? compileFormula(formula) : { ok: false, error: "SEM T", js: "", fn: () => 0 };
}

// One sample of a compiled row; anything that throws or is not finite becomes 0.
export function sampleRow(compiled, patch, time, bpm) {
  if (!compiled.ok) return 0;
  try {
    const value = compiled.fn(time, patch.x, patch.y, patch.z, patch.w, 1, bpm, patch.a, patch.b, patch.g, patch.d);
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}
