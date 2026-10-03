// App-wide constants. APP_VERSION must match `?v=` in web/index.html and APP_VERSION in
// bot/server.js; `npm run build` refuses to build when they disagree.
export const APP_VERSION = "39";

// The API (drafts, /song, /health) always lives on Railway, also when the page is served by GitHub Pages.
export const API_ORIGIN = "https://mdjr.up.railway.app";

export const SAMPLE_RATE = 44100;
export const ROW_COUNT = 5;
// Seconds of signal drawn across the plane.
export const VIEW_SECONDS = 4;
export const ROW_COLORS = ["#ff3b30", "#ff9f0a", "#30d158", "#0a84ff", "#bf5af2"];
// Song lengths offered in Menu › Time (0:30 … 20:00).
export const DURATIONS = [30, 60, 120, 300, 600, 1200];
