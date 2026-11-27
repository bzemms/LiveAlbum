// The visitor's character: built from simple rounded shapes, with a face, hair styles, hats,
// clothes and accessories. A panel lets the visitor pick a ready-made character or customise
// one; the choice is remembered on this device.
import * as THREE from 'three';

export const SKINS = ['#f6d7c3', '#e8b896', '#d29b73', '#a86e4b', '#7a4a30', '#4f2f20'];
export const HAIRS = ['#1d1a18', '#4a3022', '#8a5a32', '#c99a5a', '#e8d39a', '#a33b2b', '#9c9c9c', '#f2f2ee'];
export const CLOTHES = ['#f4f4f0', '#23262d', '#9aa0a6', '#c8463c', '#e98aa8', '#d98a2b', '#e2b93b', '#2f7d5b', '#8fb8de', '#2f5f9c', '#3b4f7a', '#7b5ea7', '#6b4a2f', '#c9b48f'];

export const PRESETS = [
  { name: 'עומר', body: 'adult', skin: SKINS[1], hair: 'short', hairColor: HAIRS[0], top: 'tshirt', topColor: '#f4f4f0', bottom: 'pants', bottomColor: '#23262d', shoes: '#f4f4f0', hat: 'none', accColor: '#c8463c', glasses: false, backpack: false },
  { name: 'נועה', body: 'adult', skin: SKINS[0], hair: 'long', hairColor: HAIRS[2], top: 'dress', topColor: '#c8463c', bottom: 'skirt', bottomColor: '#23262d', shoes: '#23262d', hat: 'none', accColor: '#e2b93b', glasses: false, backpack: false },
  { name: 'סבא משה', body: 'adult', skin: SKINS[2], hair: 'bald', hairColor: HAIRS[6], top: 'jacket', topColor: '#6b4a2f', bottom: 'pants', bottomColor: '#9aa0a6', shoes: '#23262d', hat: 'cap', accColor: '#3b4f7a', glasses: true, backpack: false },
  { name: 'מאיה', body: 'kid', skin: SKINS[1], hair: 'ponytail', hairColor: HAIRS[3], top: 'tshirt', topColor: '#e2b93b', bottom: 'shorts', bottomColor: '#2f5f9c', shoes: '#e98aa8', hat: 'none', accColor: '#e98aa8', glasses: false, backpack: true },
  { name: 'איתי', body: 'adult', skin: SKINS[4], hair: 'curly', hairColor: HAIRS[0], top: 'hoodie', topColor: '#2f7d5b', bottom: 'pants', bottomColor: '#3b4f7a', shoes: '#f4f4f0', hat: 'none', accColor: '#d98a2b', glasses: false, backpack: true },
  { name: 'שירה', body: 'adult', skin: SKINS[3], hair: 'bun', hairColor: HAIRS[0], top: 'jacket', topColor: '#7b5ea7', bottom: 'skirt', bottomColor: '#23262d', shoes: '#6b4a2f', hat: 'none', accColor: '#c8463c', glasses: true, backpack: false },
  { name: 'יואב', body: 'kid', skin: SKINS[2], hair: 'short', hairColor: HAIRS[1], top: 'hoodie', topColor: '#c8463c', bottom: 'shorts', bottomColor: '#23262d', shoes: '#2f5f9c', hat: 'beanie', accColor: '#2f5f9c', glasses: false, backpack: false },
  { name: 'רותי', body: 'adult', skin: SKINS[0], hair: 'long', hairColor: HAIRS[7], top: 'tshirt', topColor: '#8fb8de', bottom: 'pants', bottomColor: '#c9b48f', shoes: '#f4f4f0', hat: 'sunhat', accColor: '#e8d39a', glasses: true, backpack: false },
];

const KEY = 'livealbum.avatar.v1';
export function loadAvatar() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY));
    if (v && typeof v === 'object') return { ...PRESETS[0], ...v };
  } catch { /* storage blocked or empty */ }
  return { ...PRESETS[0] };
}
export function saveAvatar(cfg) {
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* storage blocked */ }
}

// ---------- Model ----------
const mats = new Map();
const mat = (color) => {
  if (!mats.has(color)) mats.set(color, new THREE.MeshLambertMaterial({ color }));
  return mats.get(color);
};
function mesh(geo, color, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat(color));
  m.position.set(x, y, z);
  return m;
}
const capsule = (r, len, color, x, y, z) => mesh(new THREE.CapsuleGeometry(r, len, 4, 12), color, x, y, z);
const sphere = (r, color, x, y, z, ws = 16, hs = 12) => mesh(new THREE.SphereGeometry(r, ws, hs), color, x, y, z);
const boxM = (w, h, d, color, x, y, z) => mesh(new THREE.BoxGeometry(w, h, d), color, x, y, z);
const dome = (r, color, theta = 0.5) => mesh(new THREE.SphereGeometry(r, 22, 12, 0, Math.PI * 2, 0, Math.PI * theta), color);

function buildHead(c) {
  const head = new THREE.Group();
  const skull = sphere(0.155, c.skin, 0, 0, 0, 24, 18);
  skull.scale.set(1, 1.08, 1);
  head.add(skull);
  for (const s of [-1, 1]) {
    const ear = sphere(0.034, c.skin, s * 0.152, -0.005, 0, 10, 8);
    ear.scale.x = 0.55;
    head.add(ear);
    const white = sphere(0.026, '#ffffff', s * 0.055, 0.018, 0.128, 12, 10);
    white.scale.z = 0.6;
    head.add(white, sphere(0.017, '#1d1a18', s * 0.055, 0.016, 0.142, 10, 8));
    const brow = boxM(0.055, 0.012, 0.012, c.hair === 'bald' ? c.skin : c.hairColor, s * 0.056, 0.07, 0.142);
    brow.rotation.z = s * -0.12;
    head.add(brow);
  }
  head.add(sphere(0.024, c.skin, 0, -0.02, 0.158, 10, 8));
  const mouth = mesh(new THREE.TorusGeometry(0.034, 0.008, 6, 14, Math.PI), '#8a3b3b', 0, -0.06, 0.14);
  mouth.rotation.z = Math.PI;
  head.add(mouth);
  // Cheeks.
  for (const s of [-1, 1]) {
    const ch = sphere(0.028, new THREE.Color(c.skin).lerp(new THREE.Color('#e46a6a'), 0.25).getStyle(), s * 0.09, -0.035, 0.115, 10, 8);
    ch.scale.z = 0.4;
    head.add(ch);
  }

  // Hair.
  const hatOn = c.hat !== 'none';
  if (c.hair !== 'bald' && !hatOn) {
    const cap = dome(0.166, c.hairColor, c.hair === 'curly' ? 0.6 : 0.52);
    cap.scale.set(c.hair === 'curly' ? 1.1 : 1.02, 1.1, 1.04);
    cap.rotation.x = -0.42;
    cap.position.set(0, 0.012, -0.008);
    head.add(cap);
  }
  if (c.hair === 'bald') {
    // A fringe of hair around the back and sides.
    const ring = mesh(new THREE.TorusGeometry(0.15, 0.03, 8, 20, Math.PI * 1.2), c.hairColor, 0, 0.0, -0.01);
    ring.rotation.set(Math.PI / 2, 0, Math.PI * -0.1 + Math.PI);
    head.add(ring);
  }
  if (c.hair === 'long') {
    const back = capsule(0.135, 0.2, c.hairColor, 0, -0.13, -0.07);
    back.scale.set(1.12, 1, 0.55);
    head.add(back);
    for (const s of [-1, 1]) {
      const side = capsule(0.04, 0.2, c.hairColor, s * 0.14, -0.1, 0.0);
      head.add(side);
    }
  }
  if (c.hair === 'ponytail') {
    const tail = capsule(0.05, 0.2, c.hairColor, 0, -0.06, -0.2);
    tail.rotation.x = 0.55;
    head.add(tail, sphere(0.03, c.accColor, 0, 0.04, -0.16, 10, 8));
  }
  if (c.hair === 'bun' && !hatOn) head.add(sphere(0.075, c.hairColor, 0, 0.13, -0.1));
  if (c.hair === 'curly' && !hatOn) {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2, up = i % 2 ? 0.1 : 0.05;
      const ball = mesh(new THREE.IcosahedronGeometry(0.058, 0), c.hairColor, Math.cos(a) * 0.14, up + 0.03, Math.sin(a) * 0.12 - 0.03);
      head.add(ball);
    }
  }
  if (c.hair === 'curly' && hatOn) head.add(capsule(0.12, 0.05, c.hairColor, 0, -0.05, -0.09));

  // Hats.
  if (c.hat === 'cap') {
    const d = dome(0.17, c.accColor, 0.5);
    d.position.y = 0.03;
    d.rotation.x = -0.15;
    const brim = mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.014, 20), c.accColor, 0, 0.045, 0.15);
    brim.scale.z = 1.3;
    brim.rotation.x = 0.12;
    head.add(d, brim, sphere(0.02, c.accColor, 0, 0.2, 0));
  } else if (c.hat === 'beanie') {
    const d = dome(0.172, c.accColor, 0.56);
    d.scale.y = 1.15;
    d.position.y = 0.02;
    d.rotation.x = -0.1;
    const fold = mesh(new THREE.TorusGeometry(0.164, 0.028, 8, 24), c.accColor, 0, 0.03, 0);
    fold.rotation.x = Math.PI / 2 - 0.1;
    head.add(d, fold, sphere(0.04, '#f4f4f0', 0, 0.22, -0.02, 10, 8));
  } else if (c.hat === 'sunhat') {
    const d = dome(0.165, c.accColor, 0.5);
    d.position.y = 0.04;
    const brim = mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.014, 28), c.accColor, 0, 0.05, 0);
    const band = mesh(new THREE.CylinderGeometry(0.168, 0.168, 0.04, 24, 1, true), '#3b2f25', 0, 0.075, 0);
    head.add(d, brim, band);
  }

  if (c.glasses) {
    for (const s of [-1, 1]) {
      const rim = mesh(new THREE.TorusGeometry(0.036, 0.007, 6, 18), '#1d1a18', s * 0.057, 0.018, 0.152);
      head.add(rim);
      const arm = boxM(0.008, 0.008, 0.15, '#1d1a18', s * 0.15, 0.022, 0.08);
      head.add(arm);
    }
    head.add(boxM(0.04, 0.008, 0.008, '#1d1a18', 0, 0.024, 0.155));
  }
  return head;
}

/** Builds (or rebuilds in place) a character inside `g` from the settings `c`. */
export function dressCharacter(g, c) {
  for (const ch of [...g.children]) {
    ch.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    g.remove(ch);
  }
  const kid = c.body === 'kid';
  const fig = new THREE.Group();
  fig.scale.setScalar(kid ? 0.7 : 1);
  g.add(fig);
  const longSleeves = c.top === 'hoodie' || c.top === 'jacket';
  const dress = c.top === 'dress';
  const bottom = dress ? 'skirt' : c.bottom;
  const lower = dress ? c.topColor : c.bottomColor;

  // Legs: hip pivot, thigh, knee pivot, shin, shoe.
  const legs = [-1, 1].map((s) => {
    const hip = new THREE.Group();
    hip.position.set(s * 0.1, 0.86, 0);
    hip.add(capsule(0.085, 0.3, bottom === 'pants' || bottom === 'shorts' ? lower : c.skin, 0, -0.2, 0));
    const knee = new THREE.Group();
    knee.position.y = -0.42;
    knee.add(capsule(0.072, 0.3, bottom === 'pants' ? lower : c.skin, 0, -0.18, 0));
    const shoe = capsule(0.065, 0.14, c.shoes, 0, -0.4, 0.045);
    shoe.rotation.x = Math.PI / 2;
    shoe.scale.set(1.05, 1, 0.75);
    knee.add(shoe);
    hip.add(knee);
    hip.userData.knee = knee;
    fig.add(hip);
    return hip;
  });
  if (bottom === 'shorts') for (const s of [-1, 1]) fig.add(capsule(0.095, 0.08, lower, s * 0.1, 0.76, 0));

  // Upper body, bobbing as a unit while walking.
  const upper = new THREE.Group();
  fig.add(upper);
  const pelvis = capsule(0.15, 0.08, lower, 0, 0.93, 0);
  pelvis.scale.set(1.3, 1, 0.82);
  upper.add(pelvis);
  if (bottom === 'skirt') {
    const skirt = mesh(new THREE.CylinderGeometry(0.19, 0.3, dress ? 0.46 : 0.4, 20, 1, true), lower, 0, dress ? 0.76 : 0.74, 0);
    skirt.material = skirt.material.clone();
    skirt.material.side = THREE.DoubleSide;
    upper.add(skirt);
  }
  const torso = capsule(0.17, 0.34, c.topColor, 0, 1.23, 0);
  torso.scale.set(1.28, 1, 0.8);
  upper.add(torso);
  if (c.top === 'jacket') {
    // Open jacket over a light shirt.
    upper.add(boxM(0.11, 0.42, 0.02, '#f4f4f0', 0, 1.24, 0.13));
    for (const s of [-1, 1]) {
      const lapel = boxM(0.04, 0.16, 0.02, c.topColor, s * 0.07, 1.39, 0.14);
      lapel.rotation.z = s * 0.35;
      upper.add(lapel);
    }
    for (let k = 0; k < 3; k++) upper.add(sphere(0.012, '#1d1a18', 0.07, 1.1 + k * 0.09, 0.138, 8, 6));
  }
  if (c.top === 'hoodie') {
    const hood = mesh(new THREE.TorusGeometry(0.12, 0.05, 8, 18), c.topColor, 0, 1.47, -0.06);
    hood.rotation.x = Math.PI / 2 + 0.5;
    const pocket = boxM(0.24, 0.1, 0.02, new THREE.Color(c.topColor).multiplyScalar(0.85).getStyle(), 0, 1.07, 0.13);
    upper.add(hood, pocket);
    for (const s of [-1, 1]) upper.add(boxM(0.01, 0.12, 0.01, '#f4f4f0', s * 0.04, 1.36, 0.14));
  }
  if (c.top === 'tshirt' || dress) {
    const collar = mesh(new THREE.TorusGeometry(0.065, 0.014, 6, 16), new THREE.Color(c.topColor).multiplyScalar(0.8).getStyle(), 0, 1.45, 0.01);
    collar.rotation.x = Math.PI / 2 - 0.25;
    upper.add(collar);
  }
  upper.add(mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.1, 12), c.skin, 0, 1.49, 0));
  const head = buildHead(c);
  head.position.y = 1.64;
  if (kid) head.scale.setScalar(1.25);
  upper.add(head);

  // Arms: shoulder pivot, upper arm, elbow pivot, forearm, hand.
  const arms = [-1, 1].map((s) => {
    const sh = new THREE.Group();
    sh.position.set(s * 0.255, 1.42, 0);
    sh.rotation.z = s * 0.07;
    sh.add(sphere(0.07, c.topColor, 0, 0, 0, 12, 10));
    sh.add(capsule(0.06, 0.18, c.topColor, 0, -0.14, 0));
    const elbow = new THREE.Group();
    elbow.position.y = -0.27;
    elbow.rotation.x = -0.15;
    elbow.add(capsule(0.052, 0.17, longSleeves ? c.topColor : c.skin, 0, -0.12, 0));
    elbow.add(sphere(0.054, c.skin, 0, -0.27, 0.005, 12, 10));
    sh.add(elbow);
    sh.userData.elbow = elbow;
    upper.add(sh);
    return sh;
  });

  if (c.backpack) {
    const bag = capsule(0.14, 0.16, c.accColor, 0, 1.22, -0.2);
    bag.scale.set(1.2, 1, 0.65);
    const flap = capsule(0.1, 0.05, new THREE.Color(c.accColor).multiplyScalar(0.8).getStyle(), 0, 1.15, -0.27);
    flap.scale.set(1.2, 1, 0.5);
    upper.add(bag, flap);
    for (const s of [-1, 1]) {
      const strap = boxM(0.04, 0.4, 0.02, '#2b2f36', s * 0.11, 1.26, 0.13);
      upper.add(strap);
      upper.add(boxM(0.04, 0.02, 0.3, '#2b2f36', s * 0.11, 1.44, -0.02));
    }
  }

  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  const phase = g.userData.phase || 0;
  g.userData = { legL: legs[0], legR: legs[1], armL: arms[0], armR: arms[1], upper, head, phase, t: 0, height: kid ? 1.25 : 1.8 };
  return g;
}

export function makeCharacter(cfg) {
  return dressCharacter(new THREE.Group(), cfg);
}

export function animateCharacter(ch, speed, dt) {
  const u = ch.userData;
  u.t += dt;
  const walking = speed > 0.1;
  u.phase += dt * (walking ? 4 + speed * 1.1 : 0);
  const swing = walking ? Math.min(0.8, 0.35 + speed * 0.07) : 0;
  const s = Math.sin(u.phase) * swing;
  const k = Math.min(1, dt * 12);
  const ease = (o, v, axis = 'x') => (o.rotation[axis] += (v - o.rotation[axis]) * k);
  ease(u.legL, s); ease(u.legR, -s);
  // Knees bend as the leg swings back.
  ease(u.legL.userData.knee, Math.max(0, s) * 1.3 + (walking ? 0.1 : 0));
  ease(u.legR.userData.knee, Math.max(0, -s) * 1.3 + (walking ? 0.1 : 0));
  ease(u.armL, -s * 0.8); ease(u.armR, s * 0.8);
  ease(u.armL.userData.elbow, walking ? -0.35 - Math.max(0, s) * 0.4 : -0.15);
  ease(u.armR.userData.elbow, walking ? -0.35 - Math.max(0, -s) * 0.4 : -0.15);
  // Body: a bob in step, a lean into a run, and slow breathing when standing.
  const bob = walking ? Math.abs(Math.cos(u.phase)) * 0.04 * Math.min(1, speed / 3) : Math.sin(u.t * 2) * 0.006;
  u.upper.position.y += (bob - u.upper.position.y) * k;
  ease(u.upper, walking ? Math.min(0.18, speed * 0.018) : 0);
  // Look around a little when idle.
  ease(u.head, walking ? 0 : Math.sin(u.t * 0.5) * 0.25, 'y');
}

// ---------- Portraits for the preset cards ----------
export function portraits(renderer, list, w = 96, h = 120) {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a66, 2.2));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(1, 2, 3);
  scene.add(key);
  const cam = new THREE.PerspectiveCamera(30, w / h, 0.1, 20);
  const rt = new THREE.WebGLRenderTarget(w, h, { samples: 4 });
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  const px = new Uint8Array(w * h * 4);
  const out = [];
  const prevTarget = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha();
  renderer.setClearColor(0x000000, 0);
  for (const cfg of list) {
    const ch = makeCharacter(cfg);
    ch.rotation.y = -0.35;
    scene.add(ch);
    const H = ch.userData.height;
    cam.position.set(0, H * 0.58, H * 1.85);
    cam.lookAt(0, H * 0.5, 0);
    renderer.setRenderTarget(rt);
    renderer.clear();
    renderer.render(scene, cam);
    renderer.readRenderTargetPixels(rt, 0, 0, w, h, px);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    const img = g.createImageData(w, h);
    for (let y = 0; y < h; y++) img.data.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
    g.putImageData(img, 0, 0);
    out.push(c.toDataURL());
    scene.remove(ch);
    ch.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
  }
  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevClear, prevAlpha);
  rt.dispose();
  return out;
}

// ---------- Customisation panel ----------
const SCHEMA = [
  { k: 'body', label: 'גוף', opts: [['adult', 'מבוגר'], ['kid', 'ילד']] },
  { k: 'skin', label: 'גוון עור', colors: SKINS },
  { k: 'hair', label: 'תסרוקת', opts: [['short', 'קצר'], ['long', 'ארוך'], ['ponytail', 'קוקו'], ['bun', 'פקעת'], ['curly', 'מתולתל'], ['bald', 'קרחת']] },
  { k: 'hairColor', label: 'צבע שיער', colors: HAIRS },
  { k: 'top', label: 'חולצה', opts: [['tshirt', 'טישרט'], ['hoodie', 'קפוצ׳ון'], ['jacket', 'ז׳קט'], ['dress', 'שמלה']] },
  { k: 'topColor', label: 'צבע חולצה', colors: CLOTHES },
  { k: 'bottom', label: 'מכנסיים', opts: [['pants', 'ארוכים'], ['shorts', 'קצרים'], ['skirt', 'חצאית']], hideIf: (c) => c.top === 'dress' },
  { k: 'bottomColor', label: 'צבע מכנסיים', colors: CLOTHES, hideIf: (c) => c.top === 'dress' },
  { k: 'shoes', label: 'נעליים', colors: CLOTHES },
  { k: 'hat', label: 'כובע', opts: [['none', 'בלי'], ['cap', 'מצחייה'], ['beanie', 'גרב'], ['sunhat', 'רחב שוליים']] },
  { k: 'glasses', label: 'משקפיים', toggle: true },
  { k: 'backpack', label: 'תיק גב', toggle: true },
  { k: 'accColor', label: 'צבע כובע ותיק', colors: CLOTHES, hideIf: (c) => c.hat === 'none' && !c.backpack && c.hair !== 'ponytail' },
];

const pick = (a) => a[Math.floor(Math.random() * a.length)];
function randomAvatar() {
  const c = {};
  for (const f of SCHEMA) c[f.k] = f.colors ? pick(f.colors) : f.toggle ? Math.random() < 0.3 : pick(f.opts)[0];
  if (Math.random() < 0.6) c.hat = 'none';
  if (c.topColor === c.bottomColor) c.bottomColor = '#23262d';
  return c;
}

/**
 * Fills `el` with the character picker. `get()` returns the current settings and
 * `set(cfg)` applies new ones (rebuilding the character).
 */
export function mountAvatarPanel(el, { renderer, get, set }) {
  el.innerHTML = `
    <div class="av-head"><b>הדמות שלי</b><button class="st-btn gold" data-av="done">✓ סיום</button></div>
    <div class="av-body">
      <div class="av-label">דמויות מוכנות</div>
      <div class="av-presets"></div>
      <div class="av-row"><div class="av-label">עיצוב אישי</div><button class="av-chip" data-av="random">🎲 הפתעה</button></div>
      <div class="av-fields"></div>
      <p class="av-hint">גררו על המסך כדי לסובב את הדמות</p>
    </div>`;
  const presetsEl = el.querySelector('.av-presets');
  let thumbs = null;
  const drawPresets = () => {
    thumbs ??= portraits(renderer, PRESETS);
    presetsEl.innerHTML = PRESETS.map((p, i) => `<button class="av-preset" data-preset="${i}"><img src="${thumbs[i]}" alt=""><span>${p.name}</span></button>`).join('');
  };
  const fieldsEl = el.querySelector('.av-fields');
  const drawFields = () => {
    const c = get();
    fieldsEl.innerHTML = SCHEMA.filter((f) => !f.hideIf?.(c)).map((f) => {
      let body;
      if (f.colors) body = f.colors.map((col) => `<button class="av-swatch${c[f.k] === col ? ' on' : ''}" data-k="${f.k}" data-v="${col}" style="background:${col}" aria-label="${col}"></button>`).join('');
      else if (f.toggle) body = `<button class="av-chip${c[f.k] ? ' on' : ''}" data-k="${f.k}" data-v="${c[f.k] ? '' : '1'}">${c[f.k] ? 'כן' : 'לא'}</button>`;
      else body = f.opts.map(([v, t]) => `<button class="av-chip${c[f.k] === v ? ' on' : ''}" data-k="${f.k}" data-v="${v}">${t}</button>`).join('');
      return `<div class="av-field"><div class="av-label">${f.label}</div><div class="av-opts">${body}</div></div>`;
    }).join('');
  };
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.preset != null) { set({ ...PRESETS[+b.dataset.preset] }); drawFields(); }
    else if (b.dataset.av === 'random') { set({ ...get(), ...randomAvatar() }); drawFields(); }
    else if (b.dataset.k) {
      const f = SCHEMA.find((q) => q.k === b.dataset.k);
      set({ ...get(), [f.k]: f.toggle ? !!b.dataset.v : b.dataset.v });
      drawFields();
    }
  });
  return {
    open() { drawPresets(); drawFields(); },
  };
}
