// Map data for the street scene: building footprints and roads around a point,
// from OpenStreetMap (Overpass API), in local metres. x = east, z = south.
// When the map service can't be reached, a generated neighbourhood stands in so the
// scene always opens.

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

const ROAD_WIDTH = {
  motorway: 14, trunk: 13, primary: 12, secondary: 10, tertiary: 8,
  residential: 6.5, unclassified: 6, living_street: 5, service: 4,
  pedestrian: 4, footway: 2.2, path: 2, cycleway: 2, steps: 2,
};
const FOOT = new Set(['pedestrian', 'footway', 'path', 'cycleway', 'steps']);

export function projector(lat0, lng0) {
  const kx = Math.cos((lat0 * Math.PI) / 180) * 111320;
  const kz = 110540;
  return (lat, lng) => [(lng - lng0) * kx, -(lat - lat0) * kz];
}

// Small deterministic random, so the same place always looks the same.
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function heightOf(tags, rand) {
  const h = parseFloat(tags.height);
  if (Number.isFinite(h) && h > 2) return Math.min(h, 200);
  const lv = parseFloat(tags['building:levels']);
  if (Number.isFinite(lv) && lv > 0) return lv * 3.2 + 1.2;
  const kind = tags.building;
  if (['house', 'detached', 'bungalow', 'garage', 'shed', 'hut', 'kiosk', 'roof'].includes(kind)) return 3.5 + rand() * 3;
  if (['apartments', 'residential', 'commercial', 'office', 'hotel'].includes(kind)) return 12 + rand() * 14;
  return 7 + rand() * 12;
}

async function query(lat, lng, radius) {
  const q = `[out:json][timeout:25];(way["building"](around:${radius},${lat},${lng});way["highway"](around:${radius},${lat},${lng}););out geom;`;
  let lastErr;
  for (const url of ENDPOINTS) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 10000);
    try {
      const r = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: q }), signal: ctl.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      if (Array.isArray(j.elements)) return j.elements;
      throw new Error('bad response');
    } catch (e) {
      lastErr = e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr || new Error('no map service');
}

export function fromElements(elements, lat, lng) {
  const proj = projector(lat, lng);
  const buildings = [];
  const roads = [];
  for (const el of elements) {
    if (el.type !== 'way' || !Array.isArray(el.geometry) || el.geometry.length < 2) continue;
    const pts = el.geometry.map((g) => proj(g.lat, g.lon));
    const tags = el.tags || {};
    if (tags.building && pts.length >= 4) {
      if (tags.building === 'roof' || tags.location === 'underground') continue;
      const ring = pts.slice(0, -1); // closed way repeats the first point
      buildings.push({ id: el.id, pts: ring, h: heightOf(tags, rng(el.id)), name: tags.name || null });
    } else if (tags.highway && ROAD_WIDTH[tags.highway]) {
      roads.push({ pts, width: ROAD_WIDTH[tags.highway], foot: FOOT.has(tags.highway), name: tags.name || null });
    }
  }
  return { buildings, roads, water: [], parks: [], sand: [], pois: [], source: 'osm' };
}

/** A believable block grid, used when the map service is unreachable or the area is unmapped. */
export function generated(seed = 7) {
  const rand = rng(seed);
  const buildings = [];
  const roads = [];
  const block = 46, street = 10, n = 4;
  for (let i = -n; i <= n; i++) {
    const c = i * block;
    roads.push({ pts: [[c - block / 2, -n * block], [c - block / 2, n * block]], width: street, foot: false });
    roads.push({ pts: [[-n * block, c - block / 2], [n * block, c - block / 2]], width: street, foot: false });
  }
  let id = 1;
  for (let bx = -n + 1; bx < n; bx++) {
    for (let bz = -n + 1; bz < n; bz++) {
      const cx = bx * block, cz = bz * block;
      const inner = block - street - 6;
      if (bx === 0 && bz === 0) {
        // The venue: one larger building around the photo spot.
        const w = 22, d = 16;
        buildings.push({ id: id++, pts: [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]], h: 9, name: null });
        continue;
      }
      const cols = 2;
      const cell = inner / cols;
      for (let a = 0; a < cols; a++) for (let b = 0; b < cols; b++) {
        if (rand() < 0.15) continue;
        const w = cell * (0.7 + rand() * 0.25), d = cell * (0.7 + rand() * 0.25);
        const x = cx - inner / 2 + a * cell + (cell - w) / 2, z = cz - inner / 2 + b * cell + (cell - d) / 2;
        buildings.push({ id: id++, pts: [[x, z], [x + w, z], [x + w, z + d], [x, z + d]], h: 8 + rand() * 22, name: null });
      }
    }
  }
  return { buildings, roads, water: [], parks: [], sand: [], pois: [], source: 'generated' };
}

export async function loadArea(lat, lng, radius = 230) {
  // 1. OpenStreetMap vector tiles from a CDN: fast and reliable.
  try {
    const { loadFromTiles } = await import('./tiles.js');
    const area = await loadFromTiles(lat, lng, radius);
    // Any real map data counts: a beach or a forest has few buildings, and that is the point.
    if (area.buildings.length || area.roads.length || area.water.length || area.parks.length || area.sand.length) return area;
  } catch {
    /* try the Overpass API next */
  }
  // 2. The Overpass API: the same data, but often slow or overloaded.
  try {
    const els = await query(lat, lng, radius);
    const area = fromElements(els, lat, lng);
    if (area.buildings.length || area.roads.length) return area;
  } catch {
    /* fall through to the generated neighbourhood */
  }
  // Nothing loaded at all: an empty area, and the scene decides what to put there.
  return { buildings: [], roads: [], water: [], parks: [], sand: [], pois: [], source: 'none' };
}
