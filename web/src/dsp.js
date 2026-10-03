// Same filters as web/worklet.js, used by the offline MP3 render so the file matches what plays.

// RBJ biquad low-pass.
export function createLowpass(sampleRate) {
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
      const alpha = Math.sin(w0) / (2 * Math.max(0.2, q));
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

export function createDcBlock() {
  let x1 = 0;
  let y1 = 0;
  return (x) => {
    const y = x - x1 + 0.995 * y1;
    x1 = x;
    y1 = y;
    return y;
  };
}
