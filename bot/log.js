// Central log redaction. Every log line goes through redact(): the bot token, the webhook secret
// and anything shaped like a Bot API token never reach stdout/stderr, not even partially.

export const REDACTED = "[redacted]";
const MIN_FRAGMENT = 8; // any run of >= 8 characters copied from a secret is removed
const BOT_URL_TOKEN = /bot\d+:[A-Za-z0-9_%-]*/gi; // ".../bot<digits>:<chars>/method"
const BARE_TOKEN = /\b\d{5,}(?::|%3A)[A-Za-z0-9_-]{8,}/gi; // "<digits>:<chars>" anywhere

// Renders log arguments as text. Errors contribute their message and their `cause` chain
// (never request options, headers or bodies); stacks only when explicitly asked for.
export function describe(value, { stack = false } = {}, depth = 0) {
  if (value instanceof Error) {
    let text = stack && value.stack ? value.stack : `${value.name}: ${value.message}`;
    if (value.cause !== undefined && depth < 4) text += ` (cause: ${describe(value.cause, { stack }, depth + 1)})`;
    return text;
  }
  if (typeof value === "string") return value;
  if (value === undefined || value === null || typeof value !== "object") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}

function fragmentsOf(secret) {
  const out = new Set();
  for (let i = 0; i + MIN_FRAGMENT <= secret.length; i++) out.add(secret.slice(i, i + MIN_FRAGMENT));
  return out;
}

export function createRedactor(secrets = []) {
  const variants = new Set();
  for (const secret of secrets) {
    if (typeof secret !== "string" || !secret) continue;
    variants.add(secret);
    variants.add(encodeURIComponent(secret));
  }
  const exact = [...variants].sort((a, b) => b.length - a.length);
  const fragments = new Set();
  for (const v of exact) for (const f of fragmentsOf(v)) fragments.add(f);

  return function redact(input) {
    let text = String(input);
    for (const v of exact) text = text.split(v).join(REDACTED);
    text = text.replace(BOT_URL_TOKEN, `bot${REDACTED}`).replace(BARE_TOKEN, REDACTED);
    if (!fragments.size || text.length < MIN_FRAGMENT) return text;
    // Remove partial copies (e.g. a truncated URL): mark every char covered by a known fragment.
    const hit = new Uint8Array(text.length);
    let any = false;
    for (let i = 0; i + MIN_FRAGMENT <= text.length; i++) {
      if (fragments.has(text.slice(i, i + MIN_FRAGMENT))) {
        hit.fill(1, i, i + MIN_FRAGMENT);
        any = true;
      }
    }
    if (!any) return text;
    let out = "";
    for (let i = 0; i < text.length; i++) {
      if (!hit[i]) out += text[i];
      else if (i === 0 || !hit[i - 1]) out += REDACTED;
    }
    return out;
  };
}

// Logger whose every method redacts its arguments before writing to the sink.
export function createLogger({ secrets = [], sink = console } = {}) {
  const redact = createRedactor(secrets);
  const line = (args, opts) => redact(args.map((a) => describe(a, opts)).join(" "));
  return {
    redact,
    error: (...args) => sink.error(line(args)),
    warn: (...args) => (sink.warn || sink.error)(line(args)),
    info: (...args) => (sink.log || sink.info)(line(args)),
    // For crashes: includes the stack, still redacted.
    crash: (...args) => sink.error(line(args, { stack: true })),
  };
}
