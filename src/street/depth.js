// Depth for "step into a photo".
//
// Two ways, chosen by the device:
// - Light (phones, tablets, low-memory devices): built from the person segmentation the site
//   already loads for the cardboard figures (a ~3 MB model). People stand forward, the room
//   recedes from the bottom of the frame to the top. Cheap enough for any phone.
// - Full (computers with memory to spare): Depth Anything V2 (small) through transformers.js,
//   on WASM. It needs ~50 MB of model and runtime, which can make a phone browser kill the tab,
//   so phones never load it. If it fails anywhere, the light depth takes over.
import { segmentPhoto } from './figures.js';

const MODEL = 'onnx-community/depth-anything-v2-small';

export function useLightDepth() {
  const ua = navigator.userAgent || '';
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const touch = matchMedia('(pointer: coarse)').matches;
  const lowMem = (navigator.deviceMemory || 8) < 6;
  return ios || touch || lowMem;
}

let estP = null;
async function estimator(onProgress) {
  estP ??= (async () => {
    const { pipeline, env } = await import('@huggingface/transformers');
    env.allowLocalModels = false;
    const files = new Map();
    const progress_callback = (e) => {
      if (e.status === 'progress' && e.total) {
        files.set(e.file, [e.loaded, e.total]);
        let a = 0, b = 0;
        for (const [l, t] of files.values()) { a += l; b += t; }
        onProgress?.(a / b);
      }
    };
    // WASM only: WebGPU runs of this model have crashed browser tabs on some machines.
    return pipeline('depth-estimation', MODEL, { device: 'wasm', dtype: 'q8', progress_callback });
  })().catch((e) => { estP = null; throw e; });
  return estP;
}

/** Depth from the person mask: 0 = far, 255 = near. Never throws (falls back to a floor gradient). */
async function lightDepth(photo) {
  let seg = null;
  try { seg = await segmentPhoto(photo); } catch { /* gradient only */ }
  const w = seg?.mw || 256, h = seg?.mh || 192;
  const d = new Float32Array(w * h);
  // The room: the bottom of the frame is near, the top far away.
  for (let y = 0; y < h; y++) {
    const v = 0.08 + 0.42 * Math.pow(y / (h - 1), 1.4);
    d.fill(v, y * w, (y + 1) * w);
  }
  if (seg) {
    // Each person stands forward, nearer the lower they reach in the frame (closer to the camera).
    const near = new Map(seg.comps.map((c) => [c.label, 0.5 + 0.25 * (c.maxY / (h - 1))]));
    for (let i = 0; i < w * h; i++) {
      const l = seg.lab[i];
      if (l) d[i] = Math.max(d[i], near.get(l) ?? 0.7);
    }
  }
  // Soften the edges a little so the relief stretches instead of tearing.
  const out = new Uint8Array(w * h);
  const r = 4;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) {
      const yy = Math.min(h - 1, Math.max(0, y + oy)), xx = Math.min(w - 1, Math.max(0, x + ox));
      s += d[yy * w + xx]; n++;
    }
    out[y * w + x] = Math.round((s / n) * 255);
  }
  return { data: out, width: w, height: h, channels: 1 };
}

const cache = new Map();

/** Relative depth of a photo: { data: Uint8Array (0 = far, 255 = near), width, height, channels }. */
export function depthOf(photo, onProgress) {
  if (cache.has(photo.full)) return cache.get(photo.full);
  const job = (async () => {
    if (useLightDepth()) return lightDepth(photo);
    try {
      const est = await estimator(onProgress);
      const out = await est(photo.full);
      const d = out.depth;
      return { data: d.data, width: d.width, height: d.height, channels: d.channels || 1 };
    } catch (e) {
      console.warn('AI depth failed, using light depth', e);
      return lightDepth(photo);
    }
  })();
  cache.set(photo.full, job);
  job.catch(() => cache.delete(photo.full));
  return job;
}
