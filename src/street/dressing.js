// Street dressing: asphalt roads with lane markings and zebra crossings, paved sidewalks with
// curbs, parked cars, a few cars driving around, and benches with bins.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

function canvasTex(size, draw, repeatMetres) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.userData.metres = repeatMetres;
  return t;
}

const asphaltTex = () => canvasTex(256, (g, n) => {
  const rand = rng(5);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, n, n);
  for (let i = 0; i < 3500; i++) {
    const v = 222 + Math.floor(rand() * 33);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(rand() * n, rand() * n, 1 + rand() * 2, 1 + rand() * 2);
  }
  // A few patched cracks.
  g.strokeStyle = 'rgba(0,0,0,0.07)';
  g.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    g.beginPath();
    let x = rand() * n, y = rand() * n;
    g.moveTo(x, y);
    for (let k = 0; k < 6; k++) { x += (rand() - 0.5) * 30; y += (rand() - 0.5) * 30; g.lineTo(x, y); }
    g.stroke();
  }
}, 8);

const pavingTex = () => canvasTex(256, (g, n) => {
  const rand = rng(9);
  const s = n / 4; // 4 x 4 slabs of 50 cm
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    const v = 232 + Math.floor(rand() * 23);
    g.fillStyle = `rgb(${v},${v - 2},${v - 6})`;
    g.fillRect(i * s, j * s, s, s);
  }
  for (let i = 0; i < 1500; i++) {
    g.fillStyle = `rgba(0,0,0,${0.03 + rand() * 0.05})`;
    g.fillRect(rand() * n, rand() * n, 2, 2);
  }
  g.fillStyle = 'rgba(0,0,0,0.22)';
  for (let i = 0; i <= 4; i++) { g.fillRect(i * s - 1.5, 0, 3, n); g.fillRect(0, i * s - 1.5, n, 3); }
}, 2);

// A flat strip along a polyline (with round joints), UVs in world metres so textures tile evenly.
function ribbon(list, pts, width, y, metres = 0) {
  const finish = (g, x, z) => {
    g.translate(x, y, z);
    if (metres) {
      const p = g.attributes.position, uv = new Float32Array(p.count * 2);
      for (let i = 0; i < p.count; i++) { uv[i * 2] = p.getX(i) / metres; uv[i * 2 + 1] = p.getZ(i) / metres; }
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    } else g.deleteAttribute('uv');
    list.push(g.index ? g.toNonIndexed() : g);
  };
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.1) continue;
    const seg = new THREE.PlaneGeometry(len, width);
    seg.rotateX(-Math.PI / 2);
    seg.rotateY(-Math.atan2(bz - az, bx - ax));
    finish(seg, (ax + bx) / 2, (az + bz) / 2);
  }
  for (const [x, z] of pts) {
    const d = new THREE.CircleGeometry(width / 2, 14);
    d.rotateX(-Math.PI / 2);
    finish(d, x, z);
  }
}

// A rectangle on the ground centred at (x, z), `along` metres in direction (dx, dz).
function patch(list, x, z, dx, dz, along, across, y) {
  const g = new THREE.PlaneGeometry(along, across);
  g.rotateX(-Math.PI / 2);
  g.rotateY(-Math.atan2(dz, dx));
  g.translate(x, y, z);
  g.deleteAttribute('uv');
  list.push(g.index ? g.toNonIndexed() : g);
}

function paint(g, color) {
  const c = new THREE.Color(color), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  g.deleteAttribute('uv');
  return g.index ? g.toNonIndexed() : g;
}
const box = (w, h, d, x, y, z, color) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return paint(g, color); };

// A small car, 4.2 m long along +z: the paint (tinted per car), the rest (glass, tyres,
// bumpers) and the lights, as three geometries for three instanced meshes.
function carGeometries() {
  const paintGeo = mergeGeometries([
    box(1.8, 0.62, 4.2, 0, 0.62, 0, 0xffffff),
    box(1.62, 0.07, 2.0, 0, 1.6, -0.25, 0xffffff),
  ]);
  const wheel = (x, z) => { const g = new THREE.CylinderGeometry(0.33, 0.33, 0.24, 14); g.rotateZ(Math.PI / 2); g.translate(x, 0.33, z); return paint(g, 0x1b1c1f); };
  const cabin = paint(new THREE.BoxGeometry(1.6, 0.58, 2.1), 0x2a3540);
  cabin.translate(0, 1.27, -0.25);
  const trimGeo = mergeGeometries([
    cabin,
    box(1.84, 0.22, 0.18, 0, 0.42, 2.12, 0x3b3d42),
    box(1.84, 0.22, 0.18, 0, 0.42, -2.12, 0x3b3d42),
    wheel(-0.86, 1.35), wheel(0.86, 1.35), wheel(-0.86, -1.35), wheel(0.86, -1.35),
  ]);
  const lightGeo = mergeGeometries([
    box(0.36, 0.14, 0.05, -0.62, 0.78, 2.11, 0xfff4d8), box(0.36, 0.14, 0.05, 0.62, 0.78, 2.11, 0xfff4d8),
    box(0.36, 0.14, 0.05, -0.62, 0.78, -2.11, 0xd0261c), box(0.36, 0.14, 0.05, 0.62, 0.78, -2.11, 0xd0261c),
  ]);
  return { paintGeo, trimGeo, lightGeo };
}

const CAR_COLORS = [0xf2f2f0, 0xf2f2f0, 0xbfc3c8, 0xbfc3c8, 0x1f2227, 0x2d3036, 0xb3262a, 0x2a4f8c, 0x6d7780, 0xd8cdb4, 0x2f6b4f, 0xe2b93b];
const CAR_L = 4.3, CAR_W = 1.9;

/**
 * Adds roads, sidewalks and street life to `scene`.
 * avoid: [{ x, z, r }] places to keep clear (the venue door, photos, the starting spot).
 * blocked(x, z, r): true where a building is.
 */
export function dressStreet(scene, { roads, R, T, night, shadows, avoid, blocked, trees }) {
  const rand = rng(1234);
  const inside = (x, z) => Math.hypot(x, z) < R + 30;
  const carRoads = roads.filter((r) => !r.foot && r.pts.some(([x, z]) => inside(x, z)));
  const footRoads = roads.filter((r) => r.foot);

  // ----- Surfaces -----
  const L = { walk: [], curb: [], car: [], foot: [], mark: [] };
  for (const r of carRoads) {
    const walk = r.width >= 6 ? 5.2 : 3;
    ribbon(L.walk, r.pts, r.width + walk, 0.02, 2);
    ribbon(L.curb, r.pts, r.width + 0.5, 0.03);
    ribbon(L.car, r.pts, r.width, 0.04, 8);
  }
  for (const r of footRoads) ribbon(L.foot, r.pts, r.width, 0.035, 2);

  // Junctions: where three or more road segments meet.
  const nodes = new Map();
  const key = (x, z) => `${Math.round(x * 2)},${Math.round(z * 2)}`;
  for (const r of carRoads) {
    r.pts.forEach(([x, z], i) => {
      const k = key(x, z);
      if (!nodes.has(k)) nodes.set(k, { x, z, legs: [] });
      const n = nodes.get(k);
      for (const j of [i - 1, i + 1]) {
        if (j < 0 || j >= r.pts.length) continue;
        const [qx, qz] = r.pts[j], len = Math.hypot(qx - x, qz - z);
        if (len > 0.1) n.legs.push({ dx: (qx - x) / len, dz: (qz - z) / len, len, width: r.width });
      }
    });
  }
  const junctions = [...nodes.values()].filter((n) => n.legs.length >= 3);
  for (const n of junctions) {
    n.w = Math.max(...n.legs.map((l) => l.width));
    if (Math.hypot(n.x, n.z) > R) continue;
    for (const l of n.legs) {
      const d = n.w / 2 + 2;
      if (l.width < 6 || l.len < d + 3) continue;
      const cx = n.x + l.dx * d, cz = n.z + l.dz * d;
      const px = -l.dz, pz = l.dx;
      for (let k = -l.width / 2 + 0.55; k <= l.width / 2 - 0.5; k += 1.0) patch(L.mark, cx + px * k, cz + pz * k, l.dx, l.dz, 2.6, 0.5, 0.05);
      // Stop line.
      patch(L.mark, n.x + l.dx * (d + 1.8), n.z + l.dz * (d + 1.8), -l.dz, l.dx, l.width - 0.6, 0.3, 0.05);
    }
  }
  const nearJunction = (x, z, pad) => junctions.some((n) => Math.hypot(x - n.x, z - n.z) < n.w / 2 + pad);

  // Dashed centre lines on two-way streets.
  for (const r of carRoads) {
    if (r.width < 8) continue;
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const dx = (bx - ax) / len, dz = (bz - az) / len;
      for (let s = 3; s < len - 3; s += 6) {
        const x = ax + dx * (s + 1.5), z = az + dz * (s + 1.5);
        if (Math.hypot(x, z) < R && !nearJunction(x, z, 3)) patch(L.mark, x, z, dx, dz, 3, 0.16, 0.05);
      }
    }
  }

  const asphalt = asphaltTex(), paving = pavingTex();
  const surf = (list, opts, order) => {
    if (!list.length) return;
    const m = new THREE.Mesh(mergeGeometries(list), new THREE.MeshLambertMaterial({ ...opts, polygonOffset: true, polygonOffsetFactor: -order, polygonOffsetUnits: -order * 2 }));
    m.receiveShadow = shadows;
    m.renderOrder = order;
    scene.add(m);
    list.forEach((g) => g.dispose());
  };
  surf(L.walk, { color: T.walk, map: paving }, 1);
  surf(L.foot, { color: T.foot, map: paving }, 2);
  surf(L.curb, { color: T.curb }, 2);
  surf(L.car, { color: T.road, map: asphalt }, 3);
  surf(L.mark, { color: night ? 0xc9c9c0 : 0xf4f4ee }, 4);

  // ----- Cars -----
  const clearOf = (x, z, pad) => avoid.every((a) => Math.hypot(x - a.x, z - a.z) > a.r + pad);
  // Drivers use the longest wide streets; on narrow ones there is no room to park beside them.
  // Only the part of each street near the visitor: the longest run of points within reach.
  const innerRun = (pts) => {
    let best = [], cur = [];
    const dense = [];
    pts.forEach((p, i) => {
      if (i) {
        const q = pts[i - 1], n = Math.ceil(Math.hypot(p[0] - q[0], p[1] - q[1]) / 10);
        for (let k = 1; k < n; k++) dense.push([q[0] + ((p[0] - q[0]) * k) / n, q[1] + ((p[1] - q[1]) * k) / n]);
      }
      dense.push(p);
    });
    for (const p of dense) {
      if (Math.hypot(p[0], p[1]) < R * 0.7) { cur.push(p); if (cur.length > best.length) best = cur; } else cur = [];
    }
    return best;
  };
  const polyLen = (pts) => pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);
  const driveRoads = carRoads
    .map((r) => { const pts = innerRun(r.pts); return { r, pts, len: polyLen(pts) }; })
    .filter((d) => d.r.width >= 8 && d.len > 50)
    .sort((a, b) => b.len - a.len)
    .slice(0, 6);
  const driven = new Set(driveRoads.map((d) => d.r));

  const parked = [];
  for (const r of carRoads) {
    if (r.width < 6 || (driven.has(r) && r.width < 10)) continue;
    const off = r.width / 2 - 1.05;
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const dx = (bx - ax) / len, dz = (bz - az) / len;
      for (const side of [1, -1]) {
        for (let s = 5 + rand() * 4; s < len - 4; s += 5.4 + rand() * 1.6) {
          if (rand() < 0.38) { s += 3; continue; }
          const x = ax + dx * s - dz * off * side, z = az + dz * s + dx * off * side;
          if (Math.hypot(x, z) > R || nearJunction(x, z, 7) || !clearOf(x, z, 2.5) || blocked(x, z, 1.3)) continue;
          if (parked.length >= 260) break;
          parked.push({ x, z, rot: Math.atan2(dx, dz) + (rand() < 0.5 ? Math.PI : 0), color: CAR_COLORS[Math.floor(rand() * CAR_COLORS.length)] });
        }
      }
    }
  }

  const movers = [];
  for (const d of driveRoads) {
    const pts = d.pts, cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const n = d.len > 160 ? 2 : 1;
    for (let k = 0; k < n; k++) {
      movers.push({
        pts, cum, len: d.len, lane: d.r.width * (d.r.width >= 10 ? 0.22 : 0.25),
        s: rand() * d.len, dir: rand() < 0.5 ? 1 : -1, speed: 0, top: 6.5 + rand() * 3,
        color: CAR_COLORS[Math.floor(rand() * CAR_COLORS.length)], x: 0, z: 0, rot: 0,
      });
    }
  }

  const { paintGeo, trimGeo, lightGeo } = carGeometries();
  const paintMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const trimMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const lightMat = night ? new THREE.MeshBasicMaterial({ vertexColors: true }) : new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x222222 });
  const dummy = new THREE.Object3D();
  const fleet = (count) => {
    const meshes = [paintGeo, trimGeo, lightGeo].map((g, i) => {
      const m = new THREE.InstancedMesh(g, [paintMat, trimMat, lightMat][i], Math.max(1, count));
      m.count = count;
      m.castShadow = shadows && i < 2;
      m.receiveShadow = shadows && i === 0;
      scene.add(m);
      return m;
    });
    const col = new THREE.Color();
    return {
      set(i, { x, z, rot, color }) {
        dummy.position.set(x, 0, z); dummy.rotation.set(0, rot, 0); dummy.updateMatrix();
        meshes.forEach((m) => m.setMatrixAt(i, dummy.matrix));
        if (color != null) meshes[0].setColorAt(i, col.set(color));
      },
      done() {
        meshes.forEach((m) => { m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere(); });
        if (meshes[0].instanceColor) meshes[0].instanceColor.needsUpdate = true;
      },
      meshes,
    };
  };
  if (parked.length) {
    const f = fleet(parked.length);
    parked.forEach((c, i) => f.set(i, c));
    f.done();
  }
  const moving = movers.length ? fleet(movers.length) : null;
  if (moving) moving.meshes.forEach((m) => { m.frustumCulled = false; });

  // Collision for cars: oriented rectangles, parked ones bucketed in 10 m cells.
  const CELL = 10, cells = new Map();
  for (const c of parked) {
    const k = Math.floor(c.x / CELL) * 7919 + Math.floor(c.z / CELL);
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push(c);
  }
  const inCar = (c, x, z, r) => {
    const s = Math.sin(c.rot), co = Math.cos(c.rot);
    const lx = (x - c.x) * co - (z - c.z) * s, lz = (x - c.x) * s + (z - c.z) * co;
    return Math.abs(lx) < CAR_W / 2 + r && Math.abs(lz) < CAR_L / 2 + r;
  };
  function carAt(x, z, r = 0) {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (let i = cx - 1; i <= cx + 1; i++) for (let j = cz - 1; j <= cz + 1; j++) {
      const list = cells.get(i * 7919 + j);
      if (list) for (const c of list) if (inCar(c, x, z, r)) return true;
    }
    return movers.some((c) => inCar(c, x, z, r));
  }

  // Position on a mover's polyline at distance s, on its side of the street.
  const place = (m) => {
    const { pts, cum } = m;
    const s = Math.max(0, Math.min(m.len, m.s));
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
    const seg = cum[i] - cum[i - 1] || 1, t = (s - cum[i - 1]) / seg;
    let dx = (bx - ax) / seg * m.dir, dz = (bz - az) / seg * m.dir;
    const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
    // Keep right: offset to the right of the direction of travel.
    m.x = x - dz * m.lane; m.z = z + dx * m.lane;
    const want = Math.atan2(dx, dz);
    let d = want - m.rot;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    m.rot += Math.abs(d) > 2 ? d : d * 0.25;
  };
  movers.forEach((m) => { for (let k = 0; k < 30; k++) place(m); });

  function update(dt, player) {
    if (!moving) return;
    movers.forEach((m, i) => {
      const fx = Math.sin(m.rot), fz = Math.cos(m.rot);
      // Brake for the visitor or a car ahead.
      let stop = Math.hypot(player.x - (m.x + fx * 3.6), player.z - (m.z + fz * 3.6)) < 2.8;
      if (!stop) {
        for (const o of movers) {
          if (o === m) continue;
          const ox = o.x - m.x, oz = o.z - m.z, ahead = ox * fx + oz * fz;
          if (ahead > 0 && ahead < 7.5 && Math.abs(ox * fz - oz * fx) < 1.6) { stop = true; break; }
        }
      }
      const target = stop ? 0 : m.top;
      m.speed += (target - m.speed) * Math.min(1, dt * (stop ? 6 : 1.2));
      m.s += m.speed * m.dir * dt;
      if (m.s > m.len || m.s < 0) { m.dir = -m.dir; m.s = Math.max(0, Math.min(m.len, m.s)); }
      place(m);
      moving.set(i, { x: m.x, z: m.z, rot: m.rot, color: m.color });
    });
    moving.done();
  }
  movers.forEach((m, i) => moving.set(i, m));
  moving?.done();

  // ----- Benches and bins on the sidewalks -----
  const benches = [], bins = [];
  for (const r of carRoads) {
    if (r.width < 6) continue;
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const dx = (bx - ax) / len, dz = (bz - az) / len;
      for (let s = 10 + rand() * 20; s < len - 6; s += 30 + rand() * 25) {
        const side = rand() < 0.5 ? 1 : -1, off = r.width / 2 + 1.9;
        const x = ax + dx * s - dz * off * side, z = az + dz * s + dx * off * side;
        if (Math.hypot(x, z) > R * 0.8 || nearJunction(x, z, 4) || !clearOf(x, z, 1.5) || blocked(x, z, 1)) continue;
        if (trees.some(([tx, tz]) => Math.hypot(tx - x, tz - z) < 2.4)) continue;
        // Face the road.
        benches.push({ x, z, rot: Math.atan2(dz * side, -dx * side) });
        if (rand() < 0.6) bins.push({ x: x + dx * 1.6, z: z + dz * 1.6, rot: 0 });
        if (benches.length > 80) break;
      }
    }
  }
  const benchGeo = mergeGeometries([
    box(1.7, 0.07, 0.45, 0, 0.45, 0, 0x8a5a33),
    box(1.7, 0.4, 0.06, 0, 0.72, -0.22, 0x8a5a33),
    box(0.07, 0.45, 0.45, -0.75, 0.22, 0, 0x2d3036),
    box(0.07, 0.45, 0.45, 0.75, 0.22, 0, 0x2d3036),
  ]);
  const binGeo = (() => { const g = new THREE.CylinderGeometry(0.26, 0.22, 0.85, 12); g.translate(0, 0.43, 0); return paint(g, 0x3f6b4a); })();
  for (const [geo, list] of [[benchGeo, benches], [binGeo, bins]]) {
    if (!list.length) continue;
    const m = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }), list.length);
    list.forEach((b, i) => { dummy.position.set(b.x, 0, b.z); dummy.rotation.set(0, b.rot, 0); dummy.updateMatrix(); m.setMatrixAt(i, dummy.matrix); });
    m.castShadow = shadows;
    scene.add(m);
  }
  const furnitureAt = (x, z, r) => benches.some((b) => Math.hypot(b.x - x, b.z - z) < 0.9 + r) || bins.some((b) => Math.hypot(b.x - x, b.z - z) < 0.3 + r);

  return { update, carAt, furnitureAt, parked: parked.length, moving: movers.length, cars: { parked, movers } };
}
