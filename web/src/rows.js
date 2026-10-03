import { inventHit } from "../hits.js";
import { ROW_COLORS, ROW_COUNT } from "./config.js";
import { toDisplay } from "./formula.js";

// A row: { id, y (formula as displayed), on, color, bpm, vol }.

// First-screen composition (150 BPM): kick, double hit on beat 4, 55 Hz drone, and two rows that
// square the drone and the kick tail. Written with bpm so each row's BPM and volume take effect.
export const DEFAULT_ROWS = [
  { y: "(1>MOD(MIN(MOD(bpm*t/30,8),5),2))*TANH(3*SIN((-9.6/POWER(1+31.375*MOD(t,60/bpm),2.3)+27.5*t)*2*PI()))", bpm: 150, vol: 1 },
  { y: "(MOD(bpm*t/60,4)>=3)*TANH(3*SIN((-5.01/POWER(1+62.75*MOD(t,30/bpm),2.3)+27.5*t+.41)*2*PI()))", bpm: 150, vol: 1 },
  { y: "(1<=MOD(MIN(MOD(bpm*t/30,8),6),2))*TANH(3*SIN((55*t+.4)*2*PI()))", bpm: 150, vol: 1 },
  { y: "(ABS(MOD(55*t+.4,1)-.5)*-3.7+MOD(bpm*t,60)*-.0431+2.96)*FLOOR(MOD(MIN(MOD(bpm*t/30,8),6),2))", bpm: 150, vol: 1 },
  { y: "-.1*COS(172.788*t-.02175/POWER(.03185+MOD(t,60/bpm),2.3))*MIN((1>MOD(MIN(MOD(bpm*t/30,8),5),2))*16,MOD(bpm*t,60))", bpm: 150, vol: 1 },
];

let lastRowId = 1;

export function clampBpm(value) {
  const bpm = Math.round(Number(value));
  return Math.max(80, Math.min(180, Number.isFinite(bpm) ? bpm : 120));
}

export function clampVolume(value) {
  const vol = Number(value);
  return Math.max(0, Math.min(1, Number.isFinite(vol) ? vol : 0.75));
}

// The color of a row always follows its position.
export function withRowColors(rows) {
  return rows.slice(0, ROW_COUNT).map((row, index) => ({ ...row, color: ROW_COLORS[index] || ROW_COLORS[0] }));
}

function makeRow(y, color = ROW_COLORS[0]) {
  lastRowId += 1;
  return { id: lastRowId, y, on: true, color, bpm: 120, vol: 0.75 };
}

// Cleans up to ROW_COUNT rows and fills the missing ones with a new voice from hits.js
// (card N for row N).
export function normalizeRows(rows) {
  const cleaned = rows.slice(0, ROW_COUNT).map((row) => ({
    ...row,
    id: row.id > 0 ? row.id : ++lastRowId,
    y: toDisplay(row.y),
    on: row.on !== false,
    bpm: clampBpm(row.bpm),
    vol: clampVolume(row.vol),
  }));
  while (cleaned.length < ROW_COUNT) cleaned.push(makeRow(toDisplay(inventHit(cleaned.length))));
  return withRowColors(cleaned);
}

// A row as stored in a draft (see projectFrom in bot/server.js).
export function rowFromDraft(row) {
  return {
    id: row.id || 0,
    y: row.y || "",
    on: row.on !== false,
    color: row.color || ROW_COLORS[0],
    bpm: Number(row.bpm),
    vol: Number(row.vol),
  };
}
