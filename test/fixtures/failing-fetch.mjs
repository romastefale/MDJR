// Preload for the end-to-end redaction test: every Bot API request fails with an error whose
// message, cause and stack all contain the full request URL (and so the token).
globalThis.fetch = async (url) => {
  const cause = new Error(`connect ECONNREFUSED ${url}`);
  const err = new TypeError(`fetch failed for ${url}`, { cause });
  err.stack = `${err.name}: ${err.message}\n    at request (${url})`;
  throw err;
};
if (process.env.MDJR_TEST_CRASH === "1") {
  setTimeout(() => {
    const err = new Error(`crash while calling ${"https://api.telegram.org/bot" + process.env.BOT_TOKEN + "/getMe"}`);
    Promise.reject(err);
  }, 200);
}
