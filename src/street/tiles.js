// OpenStreetMap data from OpenFreeMap's vector tiles (OpenMapTiles schema).
// Served from a CDN, so it loads in a second or two anywhere, and buildings already
// carry a height (render_height) estimated from their OSM tags.
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { projector } from './osm.js';

const TILEJSON = 'https://tiles.openfreemap.org/planet';
const Z = 14;

const ROAD = {
  motorway: [14, false], trunk: [13, false], primary: [12, false], secondary: [10, false], tertiary: [8, false],
  minor: [6.5, false], service: [4, false], track: [3, false], raceway: [6, false], busway: [6, false],
  path: [2.2, true], pedestrian: [4, true],
};

const area = (ring) => Math.abs(ring.reduce((s, [x1, z1], i) => { const [x2, z2] = ring[(i + 1) % ring.length]; return s + x1 * z2 - x2 * z1; }, 0)) / 2;
function guessHeight(a, id) {
  const r = (Math.imul(id | 0, 2654435761) >>> 0) / 4294967296; // imul: large ids lose precision with *
  const floors = a < 60 ? 1 + Math.round(r) : a < 150 ? 2 + Math.round(r * 2) : a < 400 ? 3 + Math.round(r * 3) : 4 + Math.round(r * 4);
  return floors * 3.1 + 0.8;
}

let templateP = null;
function template() {
  templateP ??= fetch(TILEJSON)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`tilejson ${r.status}`))))
    .then((j) => j.tiles[0])
    .catch((e) => { templateP = null; throw e; });
  return templateP;
}

const tileX = (lng) => Math.floor(((lng + 180) / 360) * 2 ** Z);
const tileY = (lat) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** Z);
};

function withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}

/** Buildings, roads, water and parks within `radius` metres, in local metres around (lat, lng). */
export async function loadFromTiles(lat, lng, radius = 230) {
  const url = await withTimeout(template(), 8000);
  const dLat = radius / 110540, dLng = radius / (111320 * Math.cos((lat * Math.PI) / 180));
  const xs = [tileX(lng - dLng), tileX(lng + dLng)];
  const ys = [tileY(lat + dLat), tileY(lat - dLat)];
  const jobs = [];
  for (let x = xs[0]; x <= xs[1]; x++) {
    for (let y = ys[0]; y <= ys[1]; y++) {
      const u = url.replace('{z}', Z).replace('{x}', x).replace('{y}', y);
      jobs.push(withTimeout(fetch(u).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`tile ${r.status}`)))), 10000).then((buf) => ({ x, y, buf })));
    }
  }
  const tiles = await Promise.all(jobs);

  const proj = projector(lat, lng);
  const near = (pts) => pts.some(([x, z]) => Math.abs(x) < radius + 40 && Math.abs(z) < radius + 40);
  const toLocal = (ring) => ring.map(([lo, la]) => proj(la, lo));
  const buildings = [], roads = [], water = [], parks = [], pois = [];
  const seen = new Set();

  for (const { x, y, buf } of tiles) {
    const vt = new VectorTile(new PbfReader(new Uint8Array(buf)));
    const each = (layer, fn) => {
      const l = vt.layers[layer];
      if (!l) return;
      for (let i = 0; i < l.length; i++) {
        const f = l.feature(i);
        fn(f, f.toGeoJSON(x, y, Z));
      }
    };
    const polys = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);
    const lines = (g) => (g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : []);

    each('building', (f, gj) => {
      const h = Number(f.properties.render_height) || 0;
      const min = Number(f.properties.render_min_height) || 0;
      if (f.properties.hide_3d) return;
      for (const poly of polys(gj.geometry)) {
        const ring = toLocal(poly[0]).slice(0, -1);
        if (ring.length < 3 || !near(ring)) continue;
        // Tiles overlap at their edges; skip a footprint we already have.
        const key = ring.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).sort().slice(0, 3).join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        // Tiles merge many buildings into one feature with a single id, so key each footprint
        // by its own position (stable for the same place on every visit).
        const id = Math.abs(Math.round(ring[0][0] * 7919 + ring[0][1] * 104729 + ring.length * 31)) % 2147483647;
        // 5 m is the tiles' default when OSM has no height or levels. Most cities have many
        // such buildings, so estimate floors from the footprint instead of a flat 5 m town.
        const bh = !h || h === 5 ? guessHeight(area(ring), id) : h;
        buildings.push({ id, pts: ring, h: Math.max(3, bh - min), base: min, name: null });
      }
    });
    each('transportation', (f, gj) => {
      const p = f.properties;
      if (p.brunnel === 'tunnel') return;
      let spec = ROAD[p.class];
      if (p.class === 'path' && ['pedestrian', 'footway', 'steps'].includes(p.subclass)) spec = ROAD.path;
      if (!spec) return;
      for (const line of lines(gj.geometry)) {
        const pts = toLocal(line);
        if (pts.length > 1 && near(pts)) roads.push({ pts, width: spec[0], foot: spec[1], name: null });
      }
    });
    each('water', (f, gj) => {
      for (const poly of polys(gj.geometry)) {
        const ring = toLocal(poly[0]);
        if (ring.length > 3 && near(ring)) water.push(ring);
      }
    });
    each('park', (f, gj) => {
      for (const poly of polys(gj.geometry)) {
        const ring = toLocal(poly[0]);
        if (ring.length > 3 && near(ring)) parks.push(ring);
      }
    });
    each('landcover', (f, gj) => {
      if (!['grass', 'wood', 'farmland'].includes(f.properties.class)) return;
      for (const poly of polys(gj.geometry)) {
        const ring = toLocal(poly[0]);
        if (ring.length > 3 && near(ring)) parks.push(ring);
      }
    });
    each('poi', (f, gj) => {
      const name = f.properties['name:he'] || f.properties.name;
      if (!name || gj.geometry.type !== 'Point') return;
      const [lo, la] = gj.geometry.coordinates;
      const [px, pz] = proj(la, lo);
      if (Math.abs(px) < radius && Math.abs(pz) < radius) pois.push({ x: px, z: pz, name });
    });
  }
  return { buildings, roads, water, parks, pois, source: 'osm' };
}
