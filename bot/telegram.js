// Minimal Bot API client: one place for requests, 429 handling and logging.
// https://core.telegram.org/bots/api#making-requests
// https://core.telegram.org/bots/api#responseparameters (retry_after)

const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createTelegram(token, options = {}) {
  const fetchImpl = options.fetch || globalThis.fetch;
  const sleep = options.sleep || sleepMs;
  const log = options.log || console.error;
  const maxRetryAfter = options.maxRetryAfter ?? 30;
  const base = `https://api.telegram.org/bot${token}/`;

  // params may be a plain object (sent as JSON) or a FormData (multipart upload).
  // Returns the Bot API response object; never throws.
  async function call(method, params = {}, { retries = 2, quiet = false } = {}) {
    for (let attempt = 0; ; attempt++) {
      let data;
      try {
        const init = params instanceof FormData
          ? { method: "POST", body: params }
          : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(params) };
        const res = await fetchImpl(base + method, init);
        data = await res.json().catch(() => ({ ok: false, error_code: res.status, description: "invalid JSON response" }));
      } catch (err) {
        data = { ok: false, description: err instanceof Error ? err.message : String(err) };
      }
      if (data.ok) return data;
      const wait = Number(data.parameters?.retry_after);
      if (data.error_code === 429 && Number.isFinite(wait) && wait <= maxRetryAfter && attempt < retries) {
        await sleep(wait * 1000);
        continue;
      }
      if (!quiet) log(`telegram ${method}: ${[data.error_code, data.description].filter(Boolean).join(" ")}`);
      return data;
    }
  }

  return { call };
}
