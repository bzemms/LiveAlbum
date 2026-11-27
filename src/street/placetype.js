// What kind of place is this? Decides how the place opens in 3D.
// Guessed from the map around the spot and from what the photos show (a small image classifier
// that runs in the browser), and always open to the visitor's own choice.

export const TYPES = {
  event: { icon: '🎉', label: 'אירוע' },
  city: { icon: '🏙️', label: 'טיול בעיר' },
  beach: { icon: '🏖️', label: 'חוף וים' },
  nature: { icon: '🌲', label: 'טבע וטיול' },
  home: { icon: '🏠', label: 'בית ומשפחה' },
  restaurant: { icon: '🍽️', label: 'מסעדה ובית קפה' },
};

// ---------- From the map ----------
const near = (ring, r) => ring.some(([x, z]) => Math.hypot(x, z) < r);
function inside(x, z, pts) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

export function scoreMap(area) {
  const s = { event: 0, city: 0, beach: 0, nature: 0, home: 0, restaurant: 0 };
  const bNear = area.buildings.filter((b) => near(b.pts, 120)).length;
  const water = (area.water || []).some((r) => near(r, 180) || inside(0, 0, r));
  const sand = (area.sand || []).some((r) => near(r, 120) || inside(0, 0, r));
  const green = (area.parks || []).some((r) => inside(0, 0, r) || near(r, 40));
  const wild = (area.wild || []).some((r) => near(r, 200));
  if (sand) s.beach += 3;
  if (water) s.beach += sand ? 1.5 : 1;
  if (green) s.nature += bNear < 10 ? 2.5 : 1;
  if (wild) s.nature += 2;
  if (bNear < 4) s.nature += 1.5; // hardly any buildings: countryside
  if (bNear >= 15) s.city += 1.2;
  else if (bNear >= 5) s.city += 0.6;
  // Places at the spot itself. Each kind adds at most once, so a street of bars or a row of
  // hotels can't outweigh the beach in front of them.
  const poi = { restaurant: 0, event: 0, beach: 0, nature: 0, city: 0 };
  for (const p of area.pois || []) {
    const d = Math.hypot(p.x, p.z);
    if (d > 45) continue;
    const w = d < 20 ? 1 : 0.5; // right at the spot counts more
    if (['restaurant', 'cafe', 'fast_food', 'ice_cream', 'bakery'].includes(p.cls)) poi.restaurant = Math.max(poi.restaurant, 2.5 * w);
    if (['community_centre', 'events_venue', 'theatre', 'nightclub'].includes(p.cls) || /hall|אולם|events|גן אירועים/i.test(p.name)) poi.event = Math.max(poi.event, 2.5 * w);
    if (p.cls === 'place_of_worship') poi.event = Math.max(poi.event, 1 * w);
    if (['beach', 'swimming'].includes(p.cls) || p.sub === 'beach') poi.beach = Math.max(poi.beach, 2 * w);
    if (['park', 'garden', 'campsite', 'picnic_site', 'viewpoint'].includes(p.cls)) poi.nature = Math.max(poi.nature, 1 * w);
    if (['attraction', 'museum', 'monument', 'castle', 'town_hall'].includes(p.cls)) poi.city = Math.max(poi.city, 1 * w);
  }
  for (const k of Object.keys(poi)) s[k] += poi[k];
  return s;
}

// ---------- From the photos ----------
// ImageNet labels (as the classifier names them) that point to each kind of place.
const CUES = {
  beach: ['seashore', 'sandbar', 'lakeside', 'promontory', 'breakwater', 'boathouse', 'catamaran', 'speedboat', 'swimming trunks', 'bikini', 'snorkel', 'paddle', 'sea'],
  nature: ['alp', 'valley', 'volcano', 'cliff', 'mountain tent', 'geyser', 'daisy', 'mushroom', 'park bench', 'hay', 'worm fence', 'ox', 'hiker', 'backpack', 'canoe', 'stone wall'],
  city: ['streetcar', 'street sign', 'traffic light', 'palace', 'monastery', 'church', 'mosque', 'triumphal arch', 'bell cote', 'dome', 'castle', 'obelisk', 'suspension bridge', 'fountain', 'cab', 'trolleybus', 'tobacco shop', 'bookshop', 'library', 'planetarium'],
  restaurant: ['restaurant', 'plate', 'pizza', 'espresso', 'cup', 'menu', 'burrito', 'carbonara', 'ice cream', 'wine bottle', 'beer glass', 'cheeseburger', 'hotdog', 'bakery', 'bagel', 'guacamole', 'consomme', 'potpie', 'meat loaf', 'trifle'],
  home: ['studio couch', 'home theater', 'television', 'window shade', 'four-poster', 'quilt', 'rocking chair', 'bookcase', 'entertainment center', 'fire screen', 'wardrobe', 'crib', 'cradle', 'pillow', 'sliding door', 'washbasin', 'tub'],
  event: ['groom', 'suit', 'academic gown', 'stage', 'theater curtain', 'balloon', 'gown', 'bow tie', 'military uniform'],
};

const MODEL = 'https://storage.googleapis.com/mediapipe-models/image_classifier/efficientnet_lite0/int8/1/efficientnet_lite0.tflite';
const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm';
let clsP = null;
function classifier() {
  clsP ??= (async () => {
    const { FilesetResolver, ImageClassifier } = await import('@mediapipe/tasks-vision');
    const files = await FilesetResolver.forVisionTasks(WASM);
    return ImageClassifier.createFromOptions(files, { baseOptions: { modelAssetPath: MODEL }, runningMode: 'IMAGE', maxResults: 8, scoreThreshold: 0.04 });
  })().catch((e) => { clsP = null; throw e; });
  return clsP;
}
const loadImage = (url) => new Promise((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = rej; i.src = url; });

export async function scorePhotos(photos) {
  const s = { event: 0, city: 0, beach: 0, nature: 0, home: 0, restaurant: 0 };
  const sample = photos.slice(0, 5);
  const cls = await classifier();
  for (const p of sample) {
    const img = await loadImage(p.full).catch(() => null);
    if (!img) continue;
    const res = cls.classify(img);
    for (const c of res.classifications?.[0]?.categories || []) {
      const name = (c.categoryName || c.displayName || '').toLowerCase();
      for (const [type, words] of Object.entries(CUES)) if (words.some((w) => name.includes(w))) s[type] += c.score * 3 / sample.length;
    }
  }
  // Several photos on one evening at one spot, around tables, reads as a gathering.
  const evening = photos.filter((p) => p.date && (p.date.getHours() >= 18 || p.date.getHours() < 2)).length;
  if (photos.length >= 3 && evening >= photos.length / 2) s.event += 1 + s.restaurant * 0.6;
  return s;
}

/** Best guess, from map scores and (optionally) photo scores. */
export function decide(mapScores, photoScores) {
  const total = {};
  for (const t of Object.keys(TYPES)) total[t] = (mapScores?.[t] || 0) + (photoScores?.[t] || 0) * 1.3;
  let best = 'city', bestV = 0.9; // a mapped street is the safe default
  for (const [t, v] of Object.entries(total)) if (v > bestV) { best = t; bestV = v; }
  return best;
}

// ---------- The visitor's own choice, remembered per place ----------
const key = (lat, lng) => `livealbum.type.${lat.toFixed(3)},${lng.toFixed(3)}`;
export function savedType(lat, lng) { try { return localStorage.getItem(key(lat, lng)); } catch { return null; } }
export function saveType(lat, lng, type) { try { type ? localStorage.setItem(key(lat, lng), type) : localStorage.removeItem(key(lat, lng)); } catch { /* private mode */ } }
