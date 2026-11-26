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

/**
 * Phones and messaging apps often name files after the moment they were taken
 * (20261126_195917.jpg, IMG-20261126-WA0001.jpg, PXL_20261126_175917123.jpg).
 * When the metadata is gone, that name is the best date we have.
 */
export function dateFromName(name) {
  const m = name.match(/(20\d{2}|19\d{2})[-_]?(\d{2})[-_]?(\d{2})(?:[-_ T]?(\d{2})[-_.:]?(\d{2})[-_.:]?(\d{2}))?/);
  if (!m) return null;
  const [, y, mo, d, h = '12', mi = '00', s = '00'] = m;
  const date = new Date(+y, +mo - 1, +d, +h, +mi, +s);
  const ok = date.getMonth() === +mo - 1 && date.getDate() === +d && +h < 24 && +mi < 60 && date <= new Date(Date.now() + 86400000);
  return ok ? date : null;
}

/** Find places by name, via OpenStreetMap's public geocoder. */
export async function searchPlaces(q) {
  const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6&accept-language=he&q=${encodeURIComponent(q)}`);
  if (!r.ok) throw new Error('search failed');
  const list = await r.json();
  return list.map((x) => {
    // Short label: the place itself, its city and country ("מרפסה, בני ברק, ישראל").
    const a = x.address || {};
    const city = a.city || a.town || a.village || a.municipality || a.county || a.state;
    const label = [...new Set([x.name, city, a.country].filter(Boolean))].join(', ') || x.display_name.split(',')[0];
    return { lat: +x.lat, lng: +x.lon, label };
  });
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
  const date = meta?.DateTimeOriginal || meta?.CreateDate || dateFromName(file.name);
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
