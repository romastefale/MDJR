import { VIEW_SECONDS } from "./config.js";
import { sampleRow } from "./formula.js";

// Draws the axes and every audible row over the current VIEW_SECONDS window, plus a dot at the
// playhead. Returns the vertical scale (peak |sample|, at least 1.15), which also normalises the audio.
export function drawPlane(canvas, ctx, { time, patch, rows, compiled, overflow }) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(2, Math.floor(rect.width * dpr));
  const height = Math.max(2, Math.floor(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const dark = document.documentElement.getAttribute("data-theme") === "dark";
  const labelColor = dark ? "rgba(255,255,255,0.55)" : "rgba(28,22,36,0.45)";
  const axisColor = dark ? "rgba(255,255,255,0.28)" : "rgba(28,22,36,0.22)";

  const windowStart = Math.floor(time / VIEW_SECONDS) * VIEW_SECONDS;
  const padX = Math.max(36 * dpr, width * 0.14);
  const padY = Math.max(32 * dpr, height * 0.12);
  const left = padX;
  const right = width - padX;
  const top = padY;
  const bottom = height - padY;
  const plotWidth = right - left;
  const plotHeight = bottom - top;
  const centerX = width / 2;
  const centerY = top + plotHeight / 2;
  const step = 2;
  const audible = (i) => rows[i]?.on && compiled[i]?.ok && !overflow[i];

  let scale = 1.15;
  for (let i = 0; i < rows.length; i++) {
    if (!audible(i)) continue;
    for (let px = 0; px <= plotWidth; px += step * 4) {
      const t = windowStart + (px / plotWidth) * VIEW_SECONDS;
      scale = Math.max(scale, Math.abs(sampleRow(compiled[i], patch, t, rows[i].bpm)));
    }
  }
  const xAt = (t) => left + ((t - windowStart) / VIEW_SECONDS) * plotWidth;
  const yAt = (value) => centerY - (value / scale) * (plotHeight / 2);

  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = axisColor;
  ctx.fillStyle = labelColor;
  ctx.lineWidth = Math.max(1, dpr * 0.75);
  ctx.lineCap = "round";
  const inset = 6 * dpr;
  ctx.beginPath();
  ctx.moveTo(inset, centerY);
  ctx.lineTo(width - inset, centerY);
  ctx.moveTo(centerX, height - inset);
  ctx.lineTo(centerX, inset);
  ctx.stroke();
  ctx.font = `${11 * dpr}px system-ui, -apple-system, sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("y", centerX + 6 * dpr, inset);
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  ctx.fillText("x", width - inset, centerY - 6 * dpr);

  for (let i = 0; i < rows.length; i++) {
    if (!audible(i)) continue;
    const row = rows[i];
    const voice = compiled[i];
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    let started = false;
    // One column per `step` pixels: a line through the middle of 6 sub-samples, plus a vertical
    // stroke when the column spans more than 8% of the scale.
    for (let px = 0; px <= plotWidth; px += step) {
      const from = windowStart + (px / plotWidth) * VIEW_SECONDS;
      const to = windowStart + (Math.min(plotWidth, px + step) / plotWidth) * VIEW_SECONDS;
      let low = Infinity;
      let high = -Infinity;
      for (let k = 0; k < 6; k++) {
        const value = sampleRow(voice, patch, from + ((to - from) * k) / 5, row.bpm);
        if (value < low) low = value;
        if (value > high) high = value;
      }
      const x = left + px;
      const mid = yAt((low + high) / 2);
      if (started) {
        ctx.lineTo(x, mid);
      } else {
        ctx.moveTo(x, mid);
        started = true;
      }
      if (high - low > scale * 0.08) {
        ctx.moveTo(x, yAt(low));
        ctx.lineTo(x, yAt(high));
        ctx.moveTo(x, mid);
      }
    }
    ctx.strokeStyle = row.color;
    ctx.lineWidth = Math.max(2.4, 1.6 * dpr);
    ctx.globalAlpha = 0.16;
    ctx.stroke();
    ctx.globalAlpha = 0.62;
    ctx.lineWidth = Math.max(0.8, 0.55 * dpr);
    ctx.stroke();

    const value = sampleRow(voice, patch, time, row.bpm);
    const dotX = xAt(time);
    const dotY = yAt(value);
    ctx.fillStyle = row.color;
    ctx.globalAlpha = 0.2;
    ctx.beginPath();
    ctx.arc(dotX, dotY, 5 * dpr, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.arc(dotX, dotY, 2.1 * dpr, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  return scale;
}
