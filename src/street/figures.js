// People from the photos as life-size cardboard figures.
// A person-segmentation model (MediaPipe, DeepLab v3) runs in the browser, so the photos
// never leave the device. Each separate person-shaped region becomes a cut-out with a white
// sticker edge, ready to stand in the 3D scene.

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/deeplab_v3/float32/1/deeplab_v3.tflite';
const PERSON = 15; // PASCAL VOC "person"

let segmenterP = null;
async function segmenter() {
  segmenterP ??= (async () => {
    const { FilesetResolver, ImageSegmenter } = await import('@mediapipe/tasks-vision');
    const files = await FilesetResolver.forVisionTasks(WASM);
    const make = (delegate) => ImageSegmenter.createFromOptions(files, {
      baseOptions: { modelAssetPath: MODEL, delegate },
      runningMode: 'IMAGE',
      outputCategoryMask: true,
      outputConfidenceMasks: false,
    });
    try { return await make('GPU'); } catch { return make('CPU'); }
  })().catch((e) => { segmenterP = null; throw e; });
  return segmenterP;
}

function loadImage(url) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = url;
  });
}

/** Label connected person regions in a binary mask (w × h). Returns [{minX,minY,maxX,maxY,area,label}], labels in `lab`. */
function components(mask, w, h) {
  const lab = new Int32Array(w * h);
  const out = [];
  const stack = [];
  let next = 0;
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || lab[i]) continue;
    next++;
    const c = { minX: w, minY: h, maxX: 0, maxY: 0, area: 0, label: next };
    stack.push(i);
    lab[i] = next;
    while (stack.length) {
      const k = stack.pop();
      const x = k % w, y = (k / w) | 0;
      c.area++;
      if (x < c.minX) c.minX = x; if (x > c.maxX) c.maxX = x;
      if (y < c.minY) c.minY = y; if (y > c.maxY) c.maxY = y;
      for (const n of [k - 1, k + 1, k - w, k + w]) {
        if (n < 0 || n >= w * h || lab[n] || !mask[n]) continue;
        if ((n === k - 1 && x === 0) || (n === k + 1 && x === w - 1)) continue;
        lab[n] = next;
        stack.push(n);
      }
    }
    out.push(c);
  }
  return { out, lab };
}

// One segmentation per photo, shared by the cardboard figures and the light depth.
const segCache = new Map();
export function segmentPhoto(photo) {
  if (segCache.has(photo.full)) return segCache.get(photo.full);
  const job = (async () => {
    const [seg, img] = await Promise.all([segmenter(), loadImage(photo.full)]);
    const scale = Math.min(1, 640 / Math.max(img.width, img.height));
    const W = Math.round(img.width * scale), H = Math.round(img.height * scale);
    const small = document.createElement('canvas');
    small.width = W; small.height = H;
    small.getContext('2d').drawImage(img, 0, 0, W, H);
    const res = seg.segment(small);
    const cm = res.categoryMask;
    const data = cm.getAsUint8Array();
    const mw = cm.width, mh = cm.height;
    const mask = new Uint8Array(mw * mh);
    for (let i = 0; i < mask.length; i++) mask[i] = data[i] === PERSON ? 1 : 0;
    res.close();
    const { out, lab } = components(mask, mw, mh);
    return { img, mw, mh, mask, comps: out, lab };
  })();
  segCache.set(photo.full, job);
  job.catch(() => segCache.delete(photo.full));
  return job;
}

const cache = new Map();

/**
 * Cut the people out of a photo.
 * Returns [{ canvas, aspect, cut }] — `cut` is true when the person runs off the bottom of the photo.
 */
export async function peopleFrom(photo, max = 5) {
  if (cache.has(photo.full)) return cache.get(photo.full);
  const job = (async () => {
    const { img, mw, mh, comps: out, lab } = await segmentPhoto(photo);
    const people = out
      .filter((c) => c.area > mw * mh * 0.012 && c.maxY - c.minY > mh * 0.14)
      .sort((a, b) => b.area - a.area)
      .slice(0, max);

    const result = [];
    for (const c of people) {
      // Alpha mask for this person only, at mask resolution.
      const pad = 2;
      const x0 = Math.max(0, c.minX - pad), y0 = Math.max(0, c.minY - pad);
      const x1 = Math.min(mw - 1, c.maxX + pad), y1 = Math.min(mh - 1, c.maxY + pad);
      const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
      const alpha = document.createElement('canvas');
      alpha.width = cw; alpha.height = ch;
      const ad = alpha.getContext('2d');
      const id = ad.createImageData(cw, ch);
      for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
        const on = lab[(y + y0) * mw + (x + x0)] === c.label;
        id.data[(y * cw + x) * 4 + 3] = on ? 255 : 0;
      }
      ad.putImageData(id, 0, 0);

      // Full-resolution crop of the photo, masked by the (smoothed) alpha.
      const sx = img.width / mw, sy = img.height / mh;
      const ow = Math.round(cw * sx), oh = Math.round(ch * sy);
      const S = Math.min(1, 900 / Math.max(ow, oh));
      const fw = Math.max(8, Math.round(ow * S)), fh = Math.max(8, Math.round(oh * S));
      const edge = Math.max(4, Math.round(Math.max(fw, fh) * 0.018));
      const cut = document.createElement('canvas');
      cut.width = fw; cut.height = fh;
      const g = cut.getContext('2d');
      g.drawImage(img, x0 * sx, y0 * sy, ow, oh, 0, 0, fw, fh);
      g.globalCompositeOperation = 'destination-in';
      g.filter = 'blur(1.5px)';
      g.imageSmoothingEnabled = true;
      g.drawImage(alpha, 0, 0, fw, fh);

      // Sticker: a white silhouette, grown by drawing it in a ring, behind the cut-out.
      const out2 = document.createElement('canvas');
      out2.width = fw + edge * 2; out2.height = fh + edge * 2;
      const o = out2.getContext('2d');
      const sil = document.createElement('canvas');
      sil.width = fw; sil.height = fh;
      const sg = sil.getContext('2d');
      sg.drawImage(cut, 0, 0);
      sg.globalCompositeOperation = 'source-in';
      sg.fillStyle = '#ffffff';
      sg.fillRect(0, 0, fw, fh);
      for (let a = 0; a < 16; a++) {
        const ang = (a / 16) * Math.PI * 2;
        o.drawImage(sil, edge + Math.cos(ang) * edge, edge + Math.sin(ang) * edge);
      }
      o.drawImage(cut, edge, edge);
      result.push({ canvas: out2, aspect: out2.width / out2.height, cut: c.maxY >= mh - 3 });
    }
    return result;
  })();
  cache.set(photo.full, job);
  job.catch(() => cache.delete(photo.full));
  return job;
}
