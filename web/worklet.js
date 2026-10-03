function makeLowpass(sampleRate) {
  let b0 = 1;
  let b1 = 0;
  let b2 = 0;
  let a1 = 0;
  let a2 = 0;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  return {
    set(freq, q) {
      const f = Math.min(Math.max(40, freq), sampleRate * 0.45);
      const w0 = (2 * Math.PI * f) / sampleRate;
      const cos = Math.cos(w0);
      const sin = Math.sin(w0);
      const alpha = sin / (2 * Math.max(0.2, q));
      const a0 = 1 + alpha;
      b0 = (1 - cos) / 2 / a0;
      b1 = (1 - cos) / a0;
      b2 = b0;
      a1 = (-2 * cos) / a0;
      a2 = (1 - alpha) / a0;
    },
    process(x) {
      const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1;
      x1 = x;
      y2 = y1;
      y1 = y;
      return Number.isFinite(y) ? y : 0;
    },
  };
}

function makeDcBlock() {
  let x1 = 0;
  let y1 = 0;
  return (x) => {
    const y = x - x1 + 0.995 * y1;
    x1 = x;
    y1 = y;
    return y;
  };
}

class MdjrMix extends AudioWorkletProcessor {
  constructor() {
    super();
    this.t = 0;
    this.scale = 1.15;
    this.rows = [];
    this.fns = [];
    this.patch = { x: 1, y: 1, z: 1, w: 1, a: 0, b: 0, g: 0, d: 1, lpf: 16000, res: 0.7, muted: false };
    this.lp = makeLowpass(sampleRate);
    this.dc = makeDcBlock();
    this.port.onmessage = (event) => {
      const data = event.data || {};
      if (typeof data.t === "number") this.t = data.t;
      if (typeof data.scale === "number") this.scale = data.scale;
      if (data.patch) this.patch = data.patch;
      if (data.rows) {
        this.rows = data.rows;
        this.fns = data.rows.map((row) => {
          if (!row.js) return null;
          try {
            return new Function(
              "t",
              "x",
              "y",
              "z",
              "w",
              "v",
              "bpm",
              "a",
              "b",
              "g",
              "d",
              `"use strict"; const val = (${row.js}); return Number.isFinite(val) ? val : 0;`,
            );
          } catch {
            return null;
          }
        });
      }
    };
  }

  process(_inputs, outputs) {
    const out = outputs[0] && outputs[0][0];
    if (!out) return true;
    const live = this.patch;
    this.lp.set(live.lpf, live.res);
    const gain = live.muted ? 0 : 1;
    const dt = 1 / sampleRate;
    const scale = Math.max(1, this.scale);
    for (let i = 0; i < out.length; i++) {
      const t = this.t;
      this.t += dt;
      let sum = 0;
      let n = 0;
      for (let r = 0; r < this.rows.length; r++) {
        const row = this.rows[r];
        const fn = this.fns[r];
        if (!row || !row.on || !fn) continue;
        let s = 0;
        try {
          s = fn(t, live.x, live.y, live.z, live.w, 1, row.bpm, live.a, live.b, live.g, live.d);
        } catch {
          s = 0;
        }
        if (!Number.isFinite(s)) continue;
        sum += s * row.vol;
        n += 1;
      }
      const mixed = n ? sum / n : 0;
      out[i] = Math.max(-0.98, Math.min(0.98, this.lp.process(this.dc(mixed / scale)) * gain));
    }
    return true;
  }
}

registerProcessor("mdjr-mix", MdjrMix);
