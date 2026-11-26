// Depth from a single photo (Depth Anything V2, small), run in the browser with transformers.js.
// The model downloads once (about 20–30 MB) and the browser keeps it; photos never leave the device.
const MODEL = 'onnx-community/depth-anything-v2-small';

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
    const tries = navigator.gpu ? [['webgpu', 'fp16'], ['wasm', 'q8']] : [['wasm', 'q8']];
    let last;
    for (const [device, dtype] of tries) {
      try { return await pipeline('depth-estimation', MODEL, { device, dtype, progress_callback }); } catch (e) { last = e; }
    }
    throw last;
  })().catch((e) => { estP = null; throw e; });
  return estP;
}

const cache = new Map();

/** Relative depth of a photo: { data: Uint8Array (0 = far, 255 = near), width, height }. */
export function depthOf(photo, onProgress) {
  if (cache.has(photo.full)) return cache.get(photo.full);
  const job = (async () => {
    const est = await estimator(onProgress);
    const out = await est(photo.full);
    const d = out.depth; // RawImage, one channel, at the photo's size
    return { data: d.data, width: d.width, height: d.height, channels: d.channels || 1 };
  })();
  cache.set(photo.full, job);
  job.catch(() => cache.delete(photo.full));
  return job;
}
