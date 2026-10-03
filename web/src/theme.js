import { telegramApp } from "./telegram.js";

// Hues of the six blurred blobs behind the page, picked once per page load (kept across theme changes).
const BLOB_HUES = [0, 1, 2, 3, 4, 5].map(() => Math.random() * 360);
const PAGE_EDGE = { light: "#f4f3f1", dark: "#141416" };

function hsl(hue, saturation, lightness) {
  return `hsl(${Math.round(((hue % 360) + 360) % 360)} ${saturation}% ${lightness}%)`;
}

function paintBackground(theme) {
  const light = theme === "light";
  const edge = PAGE_EDGE[theme];
  const blobs = BLOB_HUES.map((hue, i) => {
    const cx = 180 + ((i * 160) % 640);
    const cy = 340 + i * 180;
    const fill = hsl(hue, light ? 72 : 58, light ? 58 : 42);
    return `<ellipse cx="${cx}" cy="${cy}" rx="340" ry="220" fill="${fill}" fill-opacity="${light ? 0.85 : 0.75}"/>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1600" preserveAspectRatio="none"><defs><filter id="f" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="80"/></filter><linearGradient id="top" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${edge}"/><stop offset=".08" stop-color="${edge}"/><stop offset=".28" stop-color="${edge}" stop-opacity="0"/></linearGradient><linearGradient id="bot" x1="0" y1="0" x2="0" y2="1"><stop offset=".72" stop-color="${edge}" stop-opacity="0"/><stop offset=".92" stop-color="${edge}"/><stop offset="1" stop-color="${edge}"/></linearGradient></defs><rect width="1000" height="1600" fill="${edge}"/><g filter="url(#f)">${blobs}</g><rect width="1000" height="1600" fill="url(#top)"/><rect width="1000" height="1600" fill="url(#bot)"/></svg>`;
  const root = document.documentElement;
  root.style.setProperty("--page-edge", edge);
  root.style.setProperty("--page-bg", `url("data:image/svg+xml,${encodeURIComponent(svg)}")`);
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => meta.setAttribute("content", edge));
  document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", theme);
  // Each Telegram method only where the client supports it.
  // https://core.telegram.org/bots/webapps#initializing-mini-apps
  try {
    const webApp = telegramApp();
    const supports = (version) => !webApp?.isVersionAtLeast || webApp.isVersionAtLeast(version);
    if (supports("7.0")) webApp?.setHeaderColor?.(edge);
    if (supports("6.1")) webApp?.setBackgroundColor?.(edge);
    if (supports("7.10")) webApp?.setBottomBarColor?.(edge);
  } catch {}
}

// Switches light/dark in place: data-theme drives the CSS, the plane reads it on every frame.
export function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.style.colorScheme = theme;
  paintBackground(theme);
}
