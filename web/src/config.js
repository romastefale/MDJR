// App-wide constants.

// The app version is the "version" of package.json; `npm run build` writes it into the bundle.
export const APP_VERSION = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "";

export const SAMPLE_RATE = 44100;
export const ROW_COUNT = 5;
// Seconds of signal drawn across the plane.
export const VIEW_SECONDS = 4;
export const ROW_COLORS = ["#ff3b30", "#ff9f0a", "#30d158", "#0a84ff", "#bf5af2"];
// Song lengths offered in Menu › Time (0:30 … 20:00).
export const DURATIONS = [30, 60, 120, 300, 600, 1200];
