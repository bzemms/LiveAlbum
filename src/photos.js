import exifr from 'exifr';

const THUMB = 160;
const VIEW = 1600;

/** Resize an image source to a JPEG object URL no larger than `max` px on its long side. */
async function resize(source, max) {
  const w = source.width, h = source.height;
  const s = Math.min(1, max / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * s);
  canvas.height = Math.round(h * s);
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.86));
  return URL.createObjectURL(blob);
}

async function decode(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // Formats the browser can't decode (HEIC outside Safari): fall back to the embedded thumbnail.
    const buf = await exifr.thumbnail(file).catch(() => null);
    if (!buf) return null;
    return createImageBitmap(new Blob([buf], { type: 'image/jpeg' })).catch(() => null);
  }
}

/** Read one file: location, date and display images. Returns null if it isn't a readable image. */
export async function readPhoto(file) {
  const meta = await exifr
    .parse(file, { gps: true, pick: ['DateTimeOriginal', 'CreateDate', 'latitude', 'longitude', 'GPSLatitude', 'GPSLongitude', 'GPSLatitudeRef', 'GPSLongitudeRef'] })
    .catch(() => null);
  const bmp = await decode(file);
  if (!bmp) return null;
  const [thumb, full] = await Promise.all([resize(bmp, THUMB), resize(bmp, VIEW)]);
  bmp.close?.();
  const date = meta?.DateTimeOriginal || meta?.CreateDate || null;
  const lat = meta?.latitude, lng = meta?.longitude;
  const hasLoc = Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);
  return {
    id: crypto.randomUUID(),
    name: file.name.replace(/\.[^.]+$/, ''),
    place: null,
    date: date instanceof Date && !isNaN(date) ? date : null,
    lat: hasLoc ? lat : null,
    lng: hasLoc ? lng : null,
    thumb,
    full,
  };
}

/** Best-effort place name for a coordinate, via OpenStreetMap's public geocoder (one request per place). */
const placeCache = new Map();
export async function placeName(lat, lng) {
  const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
  if (placeCache.has(key)) return placeCache.get(key);
  const p = fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&accept-language=he&lat=${lat}&lon=${lng}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      const a = j?.address || {};
      const city = a.city || a.town || a.village || a.municipality || a.county || a.state;
      return [city, a.country].filter(Boolean).join(', ') || null;
    })
    .catch(() => null);
  placeCache.set(key, p);
  return p;
}
