// Videos in the album: location and date from the MP4/MOV metadata, a poster frame for
// thumbnails, the globe and the 3D scenes, and the original file for playback.
import { dateFromName } from './photos.js';

/** Read the top-level `moov` box (where phones keep location and creation time). */
async function readMoov(file) {
  let off = 0;
  for (let i = 0; i < 64 && off + 8 <= file.size; i++) {
    const head = new DataView(await file.slice(off, off + 16).arrayBuffer());
    let size = head.getUint32(0);
    const type = String.fromCharCode(head.getUint8(4), head.getUint8(5), head.getUint8(6), head.getUint8(7));
    let hdr = 8;
    if (size === 1) { size = Number(head.getBigUint64(8)); hdr = 16; }
    else if (size === 0) size = file.size - off;
    if (size < hdr) return null;
    if (type === 'moov') return new Uint8Array(await file.slice(off, off + Math.min(size, 32 * 1024 * 1024)).arrayBuffer());
    off += size;
  }
  return null;
}

function parseMeta(moov) {
  const out = { lat: null, lng: null, date: null };
  if (!moov) return out;
  let text = '';
  for (let i = 0; i < moov.length; i++) text += String.fromCharCode(moov[i]);
  // ISO 6709 location: Apple's com.apple.quicktime.location.ISO6709 and the ©xyz atom
  // (Android, GoPro), e.g. "+32.0874+034.8324+012.345/".
  const loc = text.match(/([+-]\d{1,2}\.\d{2,})([+-]\d{1,3}\.\d{2,})(?:[+-]\d+(?:\.\d+)?)?\//);
  if (loc) {
    const lat = parseFloat(loc[1]), lng = parseFloat(loc[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)) { out.lat = lat; out.lng = lng; }
  }
  // Apple's local creation date with time zone, e.g. "2026-11-26T19:59:30+0200".
  const ad = text.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})([+-]\d{2}):?(\d{2})/);
  if (ad) {
    const d = new Date(`${ad[1]}${ad[2]}:${ad[3]}`);
    if (!isNaN(d)) out.date = d;
  }
  if (!out.date) {
    // mvhd creation_time: seconds since 1904-01-01 UTC.
    const i = text.indexOf('mvhd');
    if (i > 0) {
      const dv = new DataView(moov.buffer, moov.byteOffset + i + 4);
      const v = dv.getUint8(0);
      const t = v === 1 ? Number(dv.getBigUint64(4)) : dv.getUint32(4);
      if (t > 2082844800 + 86400 * 365) {
        const d = new Date((t - 2082844800) * 1000);
        if (d.getFullYear() > 1990 && d <= new Date(Date.now() + 86400000)) out.date = d;
      }
    }
  }
  return out;
}

function posterOf(url) {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.src = url;
    let done = false;
    const finish = (val) => { if (!done) { done = true; v.removeAttribute('src'); v.load(); resolve(val); } };
    const timer = setTimeout(() => finish(null), 12000);
    v.addEventListener('loadedmetadata', () => { v.currentTime = Math.min(0.6, (v.duration || 1) / 3); });
    v.addEventListener('seeked', () => {
      clearTimeout(timer);
      const c = document.createElement('canvas');
      const s = Math.min(1, 1600 / Math.max(v.videoWidth, v.videoHeight));
      c.width = Math.max(2, Math.round(v.videoWidth * s));
      c.height = Math.max(2, Math.round(v.videoHeight * s));
      c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
      finish({ canvas: c, duration: v.duration });
    });
    v.addEventListener('error', () => { clearTimeout(timer); finish(null); });
  });
}

function placeholder() {
  const c = document.createElement('canvas');
  c.width = 960; c.height = 540;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 960, 540);
  grd.addColorStop(0, '#1d2a44'); grd.addColorStop(1, '#3b2d4f');
  g.fillStyle = grd; g.fillRect(0, 0, 960, 540);
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.beginPath(); g.moveTo(420, 200); g.lineTo(560, 270); g.lineTo(420, 340); g.closePath(); g.fill();
  return c;
}

const toUrl = (canvas, max) => {
  const s = Math.min(1, max / Math.max(canvas.width, canvas.height));
  const c = document.createElement('canvas');
  c.width = Math.round(canvas.width * s); c.height = Math.round(canvas.height * s);
  c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
  return new Promise((r) => c.toBlob((b) => r(URL.createObjectURL(b)), 'image/jpeg', 0.86));
};

export const isVideoFile = (f) => f.type.startsWith('video/') || /\.(mp4|mov|m4v|webm|3gp)$/i.test(f.name);

export async function readVideo(file) {
  const meta = parseMeta(await readMoov(file).catch(() => null));
  const url = URL.createObjectURL(file);
  const poster = await posterOf(url);
  const canvas = poster?.canvas || placeholder();
  const [thumb, full] = await Promise.all([toUrl(canvas, 160), toUrl(canvas, 1600)]);
  return {
    id: crypto.randomUUID(),
    name: file.name.replace(/\.[^.]+$/, ''),
    place: null,
    date: meta.date || dateFromName(file.name),
    lat: meta.lat,
    lng: meta.lng,
    thumb,
    full,
    video: url,
    playable: !!poster, // false when this browser can't decode the format (e.g. HEVC outside Safari)
    duration: poster?.duration || null,
  };
}
