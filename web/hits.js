const B = "((t*bpm/60*x)%1)";

function at(i, values) {
  return values[i % values.length];
}

function cell(i) {
  return [i % 5, Math.floor(i / 5) % 5];
}

function voices(build) {
  return Array.from({ length: 25 }, (_, i) => build(i));
}

const kick808 = voices((i) => {
  const [a, b] = cell(i);
  const f = at(a, [33, 39, 45, 52, 61]);
  const dec = at(b, [5, 8, 12, 18, 28]);
  const drop = at(a + b, [60, 120, 200, 320, 480]);
  return `sin(2*PI*(${f}+${drop}*exp(-${dec * 3}*${B}))*t)*exp(-${dec}*${B})`;
});

const kick909 = voices((i) => {
  const [a, b] = cell(i);
  const f = at(a, [36, 42, 48, 55, 63]);
  const dec = at(b, [4, 7, 11, 16, 24]);
  const drop = at(a + 1, [40, 90, 160, 260, 400]);
  return `tanh(sin(2*PI*(${f}+${drop}*exp(-${dec * 4}*${B}))*t))*exp(-${dec}*${B})`;
});

const kick606 = voices((i) => {
  const [a, b] = cell(i);
  const f = at(a, [46, 52, 58, 66, 74]);
  const dec = at(b, [10, 14, 18, 24, 32]);
  const drop = at(a + b, [24, 48, 80, 120, 170]);
  return `sin(2*PI*(${f}+${drop}*exp(-${dec * 2}*${B}))*t)*exp(-${dec}*${B})`;
});

const kick78 = voices((i) => {
  const [a, b] = cell(i);
  const f = at(a, [40, 46, 52, 58, 66]);
  const dec = at(b, [6, 10, 15, 22, 32]);
  return `(sin(2*PI*${f}*t)+0.35*sin(2*PI*${f * 2}*t))*exp(-${dec}*${B})`;
});

const hatClosed = voices((i) => {
  const [a, b] = cell(i);
  const f = at(a, [4200, 5100, 6400, 7800, 9200]);
  const m = at(b, [1300, 1700, 2300, 2900, 3600]);
  const dec = at(a + b, [18, 26, 34, 46, 60]);
  return `tanh(sin(2*PI*${f}*t+${2 + a}*sin(2*PI*${m}*t)))*exp(-${dec}*${B})`;
});

const hatOpen = voices((i) => {
  const [a, b] = cell(i);
  const f = at(a, [3000, 3800, 4700, 5600, 6800]);
  const m = at(b, [900, 1400, 1900, 2500, 3100]);
  const dec = at(b, [6, 8, 11, 14, 18]);
  return `tanh(sin(2*PI*${f}*t+${a + 1}*sin(2*PI*${m}*t)))*exp(-${dec}*${B})`;
});

const cowbell = voices((i) => {
  const [a, b] = cell(i);
  const f = at(a, [500, 540, 590, 640, 700]);
  const dec = at(b, [6, 9, 13, 18, 24]);
  return `(sin(2*PI*${f}*t)+sin(2*PI*${Math.round(f * 1.5)}*t))*exp(-${dec}*${B})`;
});

const ride = voices((i) => {
  const [a, b] = cell(i);
  const f = at(a, [2400, 3100, 3900, 4800, 6000]);
  const n = at(b, [2, 3, 4, 5, 7]);
  const dec = at(a, [4, 6, 8, 11, 15]);
  return `sin(2*PI*${f}*t)*abs(sin(PI*(${n}*${B}+0.35)))*exp(-${dec}*${B})`;
});

const snare808 = voices((i) => {
  const [a, b] = cell(i);
  const f = at(a, [160, 180, 200, 230, 260]);
  const buzz = at(b, [1800, 2400, 3200, 4100, 5200]);
  const dec = at(a + b, [8, 12, 16, 22, 30]);
  return `(sin(2*PI*${f}*t)+tanh(sin(2*PI*${buzz}*t)))*exp(-${dec}*${B})`;
});

const snare909 = voices((i) => {
  const [a, b] = cell(i);
  const f = at(a, [170, 190, 220, 250, 290]);
  const buzz = at(b, [2200, 3000, 3800, 4700, 5600]);
  const dec = at(b, [10, 14, 18, 24, 32]);
  return `tanh(sin(2*PI*${f}*t)+sin(2*PI*${buzz}*t))*exp(-${dec}*${B})`;
});

const clap = voices((i) => {
  const [a, b] = cell(i);
  const f = at(a, [700, 860, 1000, 1200, 1400]);
  const dec = at(b, [14, 18, 24, 30, 40]);
  return `tanh(sin(2*PI*${f}*t+${3 + a}*sin(2*PI*${f * 2}*t)))*exp(-${dec}*${B})`;
});

const rim = voices((i) => {
  const [a, b] = cell(i);
  const f = at(a, [320, 410, 480, 560, 680]);
  const dec = at(b, [20, 28, 36, 48, 64]);
  return `sign(sin(2*PI*${f}*t))*exp(-${dec}*${B})`;
});

const acid = voices((i) => {
  const [a, b] = cell(i);
  const f = at(a, [41, 49, 55, 65, 82]);
  const idx = at(b, [3, 5, 7, 9, 12]);
  const dec = at(a, [3, 5, 8, 12, 16]);
  return `tanh(sin(2*PI*${f}*t+${idx}*sin(2*PI*${f * 2}*t)))*exp(-${dec}*${B})`;
});

const sh101 = voices((i) => {
  const [a, b] = cell(i);
  const f = at(a, [36, 44, 52, 62, 73]);
  const drive = at(b, [2, 3, 4, 6, 8]);
  const dec = at(a + b, [2, 4, 7, 11, 16]);
  return `tanh(sin(2*PI*${f}*t)*${drive})*exp(-${dec}*${B})`;
});

const juno = voices((i) => {
  const [a, b] = cell(i);
  const f = at(a, [40, 48, 55, 65, 78]);
  const det = at(b, [1, 2, 3, 5, 7]);
  const dec = at(b, [3, 6, 9, 13, 18]);
  return `(sin(2*PI*${f}*t)+sin(2*PI*${f + det}*t))*exp(-${dec}*${B})`;
});

const system100 = voices((i) => {
  const [a, b] = cell(i);
  const f = at(a, [38, 46, 55, 69, 87]);
  const r = at(b, [2, 3, 5, 7, 9]);
  const dec = at(a, [4, 7, 10, 14, 20]);
  return `sin(2*PI*${f}*t)*sin(2*PI*${f * r}*t)*exp(-${dec}*${B})`;
});

const tom808 = voices((i) => {
  const [a, b] = cell(i);
  const f = at(a, [90, 110, 140, 170, 210]);
  const drop = at(b, [40, 80, 140, 220, 320]);
  const dec = at(a, [6, 9, 13, 18, 26]);
  return `sin(2*PI*(${f}+${drop}*exp(-${dec * 2}*${B}))*t)*exp(-${dec}*${B})`;
});

const tom909 = voices((i) => {
  const [a, b] = cell(i);
  const f = at(a, [100, 130, 160, 200, 250]);
  const drop = at(b, [30, 70, 120, 180, 260]);
  const dec = at(a + b, [5, 8, 12, 17, 24]);
  return `tanh(sin(2*PI*(${f}+${drop}*exp(-${dec * 3}*${B}))*t))*exp(-${dec}*${B})`;
});

const conga = voices((i) => {
  const [a, b] = cell(i);
  const f = at(a, [120, 150, 180, 220, 280]);
  const k = at(b, [2, 3, 4, 5, 7]);
  return `sin(2*PI*${f}*t)*pow(max(0,1-${k}*${B}),2)`;
});

const bongo = voices((i) => {
  const [a, b] = cell(i);
  const f = at(a, [240, 280, 330, 390, 460]);
  const dec = at(b, [8, 12, 16, 22, 30]);
  return `(sin(2*PI*${f}*t)+0.4*sin(2*PI*${f * 2}*t))*exp(-${dec}*${B})`;
});

export const CARDS = [
  { id: "kick", voices: [...kick808, ...kick909, ...kick606, ...kick78] },
  { id: "metal", voices: [...hatClosed, ...hatOpen, ...cowbell, ...ride] },
  { id: "snap", voices: [...snare808, ...snare909, ...clap, ...rim] },
  { id: "bass", voices: [...acid, ...sh101, ...juno, ...system100] },
  { id: "tom", voices: [...tom808, ...tom909, ...conga, ...bongo] },
];

const lastHit = [-1, -1, -1, -1, -1];

export function inventHit(slot) {
  const voices = CARDS[slot].voices;
  let pick = Math.floor(Math.random() * voices.length);
  if (pick === lastHit[slot]) pick = (pick + 1) % voices.length;
  lastHit[slot] = pick;
  return voices[pick];
}
