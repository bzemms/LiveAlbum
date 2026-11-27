// Buildings for the street scene: walls with windows (and shop fronts on the ground floor of
// taller buildings), flat roofs with a parapet, and rooftop clutter (AC units, solar heaters).
// Every texture is drawn on a canvas, so nothing extra is downloaded.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const BAY = 3; // metres per window column
const FLOOR = 3.1; // metres per storey
const SHOP_H = 3.6; // ground-floor shop band
const SHOP_W = 4.5; // metres per shop front

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function tex(c, repeatT = true) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = repeatT ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.anisotropy = 8;
  return t;
}

// 4 window columns x 2 storeys, each cell 128 px. White wall (tinted by the building's colour).
// The emissive twin lights some windows at night.
function windowTextures(night) {
  const [c, g] = canvas(512, 256);
  const [e, ge] = canvas(512, 256);
  const rand = rng(11);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 512, 256);
  // Plaster speckle.
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = `rgba(0,0,0,${0.02 + rand() * 0.04})`;
    g.fillRect(rand() * 512, rand() * 256, 2, 2);
  }
  ge.fillStyle = '#000';
  ge.fillRect(0, 0, 512, 256);
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 4; col++) {
      const x0 = col * 128, y0 = row * 128;
      const kind = (col + row * 3) % 4; // 0 plain, 1 shutters, 2 balcony door, 3 wide window
      // Floor slab line.
      g.fillStyle = 'rgba(0,0,0,0.10)';
      g.fillRect(x0, y0 + 122, 128, 6);
      let wx, wy, ww, wh;
      if (kind === 2) { ww = 46; wh = 92; wx = x0 + 41; wy = y0 + 22; }
      else if (kind === 3) { ww = 84; wh = 58; wx = x0 + 22; wy = y0 + 32; }
      else { ww = 50; wh = 64; wx = x0 + 39; wy = y0 + 30; }
      // Frame, glass with a sky reflection, mullions.
      g.fillStyle = '#d9d9d6';
      g.fillRect(wx - 5, wy - 5, ww + 10, wh + 10);
      const grd = g.createLinearGradient(wx, wy, wx + ww, wy + wh);
      grd.addColorStop(0, night ? '#1d2636' : '#9fb7c9');
      grd.addColorStop(0.55, night ? '#151c29' : '#4f6478');
      grd.addColorStop(1, night ? '#222b3b' : '#6e869a');
      g.fillStyle = grd;
      g.fillRect(wx, wy, ww, wh);
      g.fillStyle = '#e8e8e4';
      g.fillRect(wx + ww / 2 - 2, wy, 4, wh);
      if (kind !== 2) g.fillRect(wx, wy + wh * 0.38, ww, 3);
      // Sill.
      g.fillStyle = '#bdbdb8';
      g.fillRect(wx - 8, wy + wh + 4, ww + 16, 5);
      if (kind === 1) {
        // Wooden shutters, half open.
        g.fillStyle = '#7d9a8a';
        for (const sx of [wx - 22, wx + ww + 4]) {
          g.fillRect(sx, wy - 2, 18, wh + 4);
          g.fillStyle = 'rgba(0,0,0,0.25)';
          for (let k = 0; k < wh; k += 7) g.fillRect(sx + 2, wy + k, 14, 2);
          g.fillStyle = '#7d9a8a';
        }
      }
      if (kind === 2) {
        // Balcony railing.
        g.fillStyle = '#3a3d42';
        g.fillRect(x0 + 18, y0 + 78, 92, 4);
        for (let k = 0; k <= 92; k += 8) g.fillRect(x0 + 18 + k, y0 + 78, 2, 36);
        g.fillRect(x0 + 16, y0 + 112, 96, 5);
      }
      // Lit or dark at night.
      const lit = rand() < 0.5;
      ge.fillStyle = lit ? (rand() < 0.3 ? '#ffe7b0' : '#ffc66b') : '#000';
      ge.fillRect(wx, wy, ww, wh);
      if (lit) {
        ge.fillStyle = '#000';
        ge.fillRect(wx + ww / 2 - 2, wy, 4, wh);
      }
    }
  }
  return { map: tex(c), emissiveMap: tex(e) };
}

// 4 shop fronts side by side: an awning or sign band, a large window and a door.
function shopTextures() {
  const [c, g] = canvas(512, 128);
  const [e, ge] = canvas(512, 128);
  const awnings = [['#c8463c', '#f3ede2'], ['#2f7d5b', '#f1efe6'], ['#2f5f9c', '#f3f1ea'], ['#d98a2b', '#3b2f25']];
  ge.fillStyle = '#000';
  ge.fillRect(0, 0, 512, 128);
  for (let i = 0; i < 4; i++) {
    const x0 = i * 128;
    g.fillStyle = '#efece6';
    g.fillRect(x0, 0, 128, 128);
    // Stone base.
    g.fillStyle = '#9b958b';
    g.fillRect(x0, 118, 128, 10);
    // Display window and door.
    const door = i % 2 ? 'left' : 'right';
    const dx = door === 'left' ? x0 + 10 : x0 + 90;
    const wx = door === 'left' ? x0 + 42 : x0 + 8;
    g.fillStyle = '#2b2f36';
    g.fillRect(wx - 3, 37, 82, 80);
    g.fillRect(dx - 3, 37, 32, 82);
    const grd = g.createLinearGradient(0, 40, 0, 116);
    grd.addColorStop(0, '#7f97ab');
    grd.addColorStop(1, '#3e4b58');
    g.fillStyle = grd;
    g.fillRect(wx, 40, 76, 76);
    g.fillStyle = '#4a3a2c';
    g.fillRect(dx, 40, 26, 79);
    g.fillStyle = '#8fa4b5';
    g.fillRect(dx + 4, 46, 18, 34);
    // Goods on shelves behind the glass.
    for (let k = 0; k < 9; k++) {
      g.fillStyle = ['#e2c26b', '#c9645b', '#6aa3c9', '#e9e4d8', '#7bb07a'][(k + i) % 5];
      g.fillRect(wx + 6 + k * 8, 92 + ((k * 7) % 3) * 4, 6, 10);
    }
    // Striped awning.
    const [a, b] = awnings[i];
    for (let k = 0; k < 128; k += 16) {
      g.fillStyle = a; g.fillRect(x0 + k, 8, 8, 24);
      g.fillStyle = b; g.fillRect(x0 + k + 8, 8, 8, 24);
    }
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(x0, 30, 128, 4);
    // Night: the shop is lit inside and the awning catches the glow.
    ge.fillStyle = '#ffd28a';
    ge.fillRect(wx, 40, 76, 76);
    ge.fillStyle = '#5a3d1c';
    ge.fillRect(x0, 8, 128, 24);
  }
  return { map: tex(c, false), emissiveMap: tex(e, false) };
}

const signedArea = (pts) => pts.reduce((s, [x1, z1], i) => { const [x2, z2] = pts[(i + 1) % pts.length]; return s + x1 * z2 - x2 * z1; }, 0) / 2;

function pointIn(x, z, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// Geometry buffers we fill by hand (non-indexed triangles).
function buf() { return { p: [], n: [], uv: [], c: [] }; }
function quad(b, [ax, az], [bx, bz], y0, y1, nx, nz, u0, u1, v0, v1, cBot, cTop) {
  // Two triangles; winding chosen so the face points along (nx, nz).
  const A = [ax, y0, az], B = [bx, y0, bz], C = [bx, y1, bz], D = [ax, y1, az];
  const uA = [u0, v0], uB = [u1, v0], uC = [u1, v1], uD = [u0, v1];
  // Normal of A,B,C winding = (B-A) x (C-A); horizontal part is (dz, -dx) scaled.
  const flip = ((bz - az) * nx - (bx - ax) * nz) < 0;
  const tris = flip ? [[A, uA, cBot], [B, uB, cBot], [C, uC, cTop], [A, uA, cBot], [C, uC, cTop], [D, uD, cTop]]
    : [[A, uA, cBot], [C, uC, cTop], [B, uB, cBot], [A, uA, cBot], [D, uD, cTop], [C, uC, cTop]];
  for (const [p, uv, col] of tris) {
    b.p.push(...p); b.n.push(nx, 0, nz); b.uv.push(...uv); b.c.push(col.r, col.g, col.b);
  }
}
function toGeo(b) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.p, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(b.n, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(b.c, 3));
  return g;
}

/**
 * Adds the buildings to `scene`. `solids` are footprints ({ id, pts, h }); `venue` is the event
 * building, coloured warmer and kept free of shop fronts so its glowing door reads clearly.
 */
export function buildCity(scene, { solids, venue, walls, night, shadows }) {
  const winTex = windowTextures(night);
  const shopTex = shopTextures();
  const upper = buf(), shops = buf(), parapets = buf();
  const roofGeos = [];
  const acSpots = [], solarSpots = [];
  const col = new THREE.Color(), white = new THREE.Color(1, 1, 1);

  for (const b of solids) {
    const pts = b.pts;
    if (pts.length < 3) continue;
    const rand = rng(b.id * 7 + 3);
    const ccw = signedArea(pts) > 0;
    col.set(b === venue ? (night ? '#b49a6e' : '#f2d9a6') : walls[(b.id >>> 0) % walls.length]);
    const base = col.clone();
    const bottom = base.clone().multiplyScalar(0.8); // a touch of ground occlusion
    const shopCol = base.clone().lerp(white, 0.55);
    const hasShops = b !== venue && b.h >= 8 && rand() < 0.65;
    const g0 = hasShops ? SHOP_H : 0;
    const startCol = Math.floor(rand() * 4), startShop = Math.floor(rand() * 4);
    const rowOff = rand() < 0.5 ? 0 : 0.5;

    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], c = pts[(i + 1) % pts.length];
      const dx = c[0] - a[0], dz = c[1] - a[1];
      const len = Math.hypot(dx, dz);
      if (len < 0.05) continue;
      // Outward normal: perpendicular to the edge, on the side away from the footprint.
      let nx = dz / len, nz = -dx / len;
      if (ccw) { nx = -nx; nz = -nz; }
      const mx = (a[0] + c[0]) / 2, mz = (a[1] + c[1]) / 2;
      if (pointIn(mx + nx * 0.05, mz + nz * 0.05, pts)) { nx = -nx; nz = -nz; }
      if (hasShops) {
        const n = Math.round(len / SHOP_W);
        const u0 = (startShop + i) / 4 + 0.001, u1 = n ? u0 + n / 4 : u0 + 0.02;
        quad(shops, a, c, 0, SHOP_H, nx, nz, n ? u0 : 0.003, n ? u1 : 0.01, 0, 1, bottom, shopCol);
      }
      if (b.h - g0 > 0.4) {
        const n = Math.round(len / BAY);
        const u0 = (startCol + i) / 4, u1 = n ? u0 + n / 4 : u0;
        const ua = n ? u0 : u0 + 0.005, ub = n ? u1 : u0 + 0.03; // too short for a window: plain wall
        const v1 = (b.h - g0) / (FLOOR * 2) + rowOff;
        quad(upper, a, c, g0, b.h, nx, nz, ua, ub, rowOff, v1, hasShops ? base : bottom, base);
      }
      // Parapet around flat roofs of taller buildings.
      if (b.h >= 6) {
        const pc = base.clone().multiplyScalar(0.92);
        quad(parapets, a, c, b.h, b.h + 0.55, nx, nz, 0, 0, 0, 0, pc, pc);
      }
    }

    // Roof.
    try {
      const geo = new THREE.ShapeGeometry(new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z))));
      geo.rotateX(-Math.PI / 2);
      geo.translate(0, b.h + 0.01, 0);
      geo.deleteAttribute('uv');
      const n = geo.attributes.position.count;
      const roof = base.clone().multiplyScalar(0.78);
      const colors = new Float32Array(n * 3);
      for (let v = 0; v < n; v++) colors.set([roof.r, roof.g, roof.b], v * 3);
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      roofGeos.push(geo.index ? geo.toNonIndexed() : geo);
    } catch { /* skip a broken footprint */ }

    // Rooftop clutter on flat roofs.
    const A = Math.abs(signedArea(pts));
    if (b.h >= 6 && A > 50) {
      const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cz = pts.reduce((s, p) => s + p[1], 0) / pts.length;
      const r = Math.sqrt(A) * 0.22;
      for (let k = 0; k < 3; k++) {
        const x = cx + (rand() - 0.5) * r * 2, z = cz + (rand() - 0.5) * r * 2;
        if (!pointIn(x, z, pts)) continue;
        (k === 0 && rand() < 0.7 ? solarSpots : acSpots).push([x, b.h, z, rand() * Math.PI * 2]);
      }
    }
  }

  const add = (geo, mat) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = shadows; m.receiveShadow = shadows;
    scene.add(m);
    return m;
  };
  const em = night ? { emissive: 0xffffff, emissiveIntensity: 1 } : {};
  if (upper.p.length) add(toGeo(upper), new THREE.MeshLambertMaterial({ vertexColors: true, map: winTex.map, ...(night ? { emissiveMap: winTex.emissiveMap, ...em } : {}) }));
  if (shops.p.length) add(toGeo(shops), new THREE.MeshLambertMaterial({ vertexColors: true, map: shopTex.map, ...(night ? { emissiveMap: shopTex.emissiveMap, ...em } : {}) }));
  const flat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  if (parapets.p.length) {
    const g = toGeo(parapets);
    g.deleteAttribute('uv');
    add(g, flat);
  }
  if (roofGeos.length) {
    add(mergeGeometries(roofGeos), flat);
    roofGeos.forEach((g) => g.dispose());
  }

  // AC units and solar water heaters (panel + tank).
  const dummy = new THREE.Object3D();
  const inst = (geo, mat, spots) => {
    if (!spots.length) return;
    const m = new THREE.InstancedMesh(geo, mat, spots.length);
    spots.forEach(([x, y, z, rot], i) => {
      dummy.position.set(x, y, z); dummy.rotation.set(0, rot, 0); dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    });
    m.castShadow = shadows;
    scene.add(m);
  };
  const ac = new THREE.BoxGeometry(1.0, 0.75, 0.7);
  ac.translate(0, 0.38, 0);
  inst(ac, new THREE.MeshLambertMaterial({ color: 0xdcdcd8 }), acSpots);
  const panel = new THREE.BoxGeometry(1.1, 0.06, 1.9);
  panel.rotateX(-0.6);
  panel.translate(0, 0.75, 0.2);
  const tank = new THREE.CylinderGeometry(0.32, 0.32, 1.5, 12);
  tank.rotateZ(Math.PI / 2);
  tank.translate(0, 1.45, -0.75);
  const paint = (g, c) => {
    const n = g.attributes.position.count, a = new Float32Array(n * 3), cc = new THREE.Color(c);
    for (let i = 0; i < n; i++) a.set([cc.r, cc.g, cc.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    g.deleteAttribute('uv');
    return g.index ? g.toNonIndexed() : g;
  };
  const solar = mergeGeometries([paint(panel, 0x24364f), paint(tank, 0xd9d9d4)]);
  inst(solar, new THREE.MeshLambertMaterial({ vertexColors: true }), solarSpots);
}
