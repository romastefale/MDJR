import { Mp3Encoder } from "@breezystack/lamejs";

const FRAME = 1152; // samples per MPEG-1 Layer III frame

function copyBytes(view) {
  const bytes = new Uint8Array(view.byteLength);
  bytes.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
  return bytes;
}

// Encodes `sampleCount` mono samples at 128 kbps. `fill(offset, block)` writes the next block of
// float samples; every 32 frames the loop yields to the event loop and reports progress (0..1).
export async function encodeMp3(sampleCount, sampleRate, fill, onProgress) {
  const encoder = new Mp3Encoder(1, sampleRate, 128);
  const floats = new Float32Array(FRAME);
  const pcm = new Int16Array(FRAME);
  const chunks = [];
  const total = Math.max(1, Math.floor(sampleCount));
  for (let offset = 0; offset < total; offset += FRAME) {
    const size = Math.min(FRAME, total - offset);
    const block = size === FRAME ? floats : floats.subarray(0, size);
    fill(offset, block);
    for (let i = 0; i < size; i++) {
      const s = Math.max(-1, Math.min(1, floats[i] ?? 0));
      pcm[i] = s < 0 ? Math.round(s * 32768) : Math.round(s * 32767);
    }
    const out = encoder.encodeBuffer(pcm.subarray(0, size));
    if (out.length) chunks.push(copyBytes(out).buffer);
    if ((offset / FRAME) % 32 === 0) {
      onProgress?.(offset / total);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  const tail = encoder.flush();
  if (tail.length) chunks.push(copyBytes(tail).buffer);
  onProgress?.(1);
  return new Blob(chunks, { type: "audio/mpeg" });
}
