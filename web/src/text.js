// Font of the formula textareas (desk.css), used to measure whether a formula needs more than three lines.
const FORMULA_FONT = '8.5px/1.25 "Courier New", Courier, monospace';

export function overflowsThreeLines(text, width) {
  const probe = document.createElement("div");
  probe.style.cssText = `position:fixed;left:-9999px;top:0;visibility:hidden;white-space:pre-wrap;overflow-wrap:anywhere;letter-spacing:-0.4px;font:${FORMULA_FONT}`;
  probe.style.width = `${Math.max(1, width)}px`;
  probe.textContent = text || " ";
  document.body.append(probe);
  const overflows = probe.offsetHeight > 8.5 * 1.25 * 3 + 2;
  probe.remove();
  return overflows;
}

// 75 -> "1:15"
export function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}
