const BEAT = "((t*bpm/60*x)%1)";
const OFF = "((t*bpm/60*x+0.5)%1)";

function ri(min, max) {
  return String(min + Math.floor(Math.random() * (max - min + 1)));
}

export const OSCS = [
  (f) => `sin(2*PI*${f}*t)`,
  (f) => `tanh(sin(2*PI*${f}*t))`,
  (f) => `tanh(sin(2*PI*${f}*t)+sin(2*PI*${f}*2*t))`,
  (f) => `sin(2*PI*${f}*t)+0.45*sin(2*PI*${f}*2*t)`,
  (f) => `tanh(sin(2*PI*${f}*t+${ri(1, 4)}*sin(2*PI*${ri(3, 12)}*t)))`,
];

export const ENVS = [
  (body) => `(${body})*exp(-${ri(2, 16)}*${BEAT})`,
  (body) => `(${body})*exp(-${ri(3, 18)}*${OFF})`,
  (body) => `(${body})*abs(sin(PI*${BEAT}))`,
  (body) => `(${body})*exp(-${ri(6, 22)}*((t*bpm/60*x*${ri(2, 4)})%1))`,
];

export const PAIRS = [
  [[42, 68], [78, 140]],
  [[1800, 4200], [5000, 11000]],
  [[320, 780], [900, 2200]],
  [[28, 52], [54, 92]],
  [[96, 180], [190, 420]],
];

function bankFor(slot) {
  const tones = PAIRS[slot];
  const builds = [];
  for (const tone of tones) {
    for (const osc of OSCS) {
      for (const env of ENVS) {
        builds.push(() => env(osc(ri(tone[0], tone[1]))));
      }
    }
  }
  return builds;
}

const HIT_BANKS = PAIRS.map((_, slot) => bankFor(slot));
const lastHit = [-1, -1, -1, -1, -1];

export function inventHit(slot) {
  const index = Math.max(0, Math.min(HIT_BANKS.length - 1, slot));
  const bank = HIT_BANKS[index];
  let pick = Math.floor(Math.random() * bank.length);
  if (pick === lastHit[index]) pick = (pick + 1) % bank.length;
  lastHit[index] = pick;
  return bank[pick]();
}
