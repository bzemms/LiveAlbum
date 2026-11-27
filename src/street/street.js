// Street level: a stylised 3D neighbourhood built from the real map around a photo spot.
// The visitor walks as a character (third person). The photos stand in front of the venue,
// and a glowing door leads into a hall with every photo from that place on its walls.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { loadArea } from './osm.js';
import { makeGrid } from './navgrid.js';
import { makeMinimap } from './minimap.js';
import { peopleFrom } from './figures.js';
import { depthOf } from './depth.js';
import { buildCity } from './buildings.js';
import { dressStreet } from './dressing.js';
import { TYPES, scoreMap, scorePhotos, decide } from './placetype.js';
import { generated } from './osm.js';

// How each kind of place opens. `door`: the label of a door into an interior (none: an open place).
// `fill`: what to build when the map has no buildings ('city': a generated block, 'open': nothing).
const SCENES = {
  event: { door: 'כניסה לאירוע', inside: 'event', exit: 'יציאה לרחוב', fill: 'city', title: 'האירוע' },
  restaurant: { door: 'כניסה למסעדה', inside: 'restaurant', exit: 'יציאה לרחוב', fill: 'city', title: 'המסעדה' },
  home: { door: 'כניסה הביתה', inside: 'home', exit: 'יציאה החוצה', fill: 'city', title: 'הבית' },
  city: { door: null, fill: 'city' },
  beach: { door: null, fill: 'open', ground: [0xe8d6a4, 0x8a7f6a], sea: true },
  nature: { door: null, fill: 'open', ground: [0x93bf6c, 0x415c3e], forest: true },
};

const DAY = {
  sky: 0xa9d3f0, fog: 0xc9e2f2, ground: 0xd8d2c4, road: 0x55595f, foot: 0xc9bea6, walk: 0xc4c2bd, curb: 0xe9e7e1,
  hemiSky: 0xffffff, hemiGround: 0xb9a98a, hemi: 1.1, sun: 0xfff1d6, sunI: 2.2,
  walls: ['#efe3cf', '#e6d2b5', '#d9dfe2', '#ecc9b8', '#c9d6e6', '#f3ead9', '#dcbfae', '#e9dcc4'],
};
const NIGHT = {
  sky: 0x1c2b57, fog: 0x2a3863, ground: 0x7a7884, road: 0x3a3d46, foot: 0x8a8690, walk: 0x8b8994, curb: 0xa3a1aa,
  hemiSky: 0x9fb0e8, hemiGround: 0x4a4250, hemi: 1.35, sun: 0xc4d0ff, sunI: 0.9,
  walls: ['#c9bfb4', '#bdb3c4', '#aab7c6', '#cdb8b4', '#a9b6cc', '#d2c8cf', '#c3b2ad', '#b9bccf'],
};

const isTouch = matchMedia('(pointer: coarse)').matches;
const dateFmt = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'long', year: 'numeric' });

// ---------- 2D geometry helpers (x, z in metres) ----------
function inPoly(x, z, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function closestOnPoly(x, z, pts) {
  let best = null;
  for (let i = 0; i < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % pts.length];
    const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2));
    const px = ax + t * dx, pz = az + t * dz, d = Math.hypot(x - px, z - pz);
    if (!best || d < best.d) best = { x: px, z: pz, d, ex: dx, ez: dz, len: Math.sqrt(len2) };
  }
  return best;
}
const bbox = (pts) => pts.reduce((b, [x, z]) => [Math.min(b[0], x), Math.min(b[1], z), Math.max(b[2], x), Math.max(b[3], z)], [Infinity, Infinity, -Infinity, -Infinity]);

// ---------- Canvas textures ----------
function textSprite(text, { size = 56, color = '#fff', bg = 'rgba(15,22,32,0.78)', scale = 1 } = {}) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  g.font = `700 ${size}px Rubik, Heebo, system-ui, sans-serif`;
  const w = Math.ceil(g.measureText(text).width) + size * 1.2, h = Math.ceil(size * 1.7);
  c.width = w; c.height = h;
  g.font = `700 ${size}px Rubik, Heebo, system-ui, sans-serif`;
  g.fillStyle = bg;
  g.beginPath(); g.roundRect(0, 0, w, h, h / 2); g.fill();
  g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle'; g.direction = 'rtl';
  g.fillText(text, w / 2, h / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  s.scale.set((w / h) * 0.6 * scale, 0.6 * scale, 1);
  return s;
}
function planksTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const g = c.getContext('2d');
  const tones = ['#7a5536', '#83603f', '#6f4c30', '#8a6646', '#764f33'];
  for (let i = 0; i < 8; i++) {
    g.fillStyle = tones[i % tones.length];
    g.fillRect(0, i * 64, 512, 64);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(0, i * 64, 512, 2);
    const off = (i * 173) % 512;
    g.fillRect(off, i * 64, 2, 64);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(6, 4);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------- Character ----------
function makeCharacter() {
  const g = new THREE.Group();
  const shirt = new THREE.MeshLambertMaterial({ color: 0xf4f4f0 });
  const pants = new THREE.MeshLambertMaterial({ color: 0x23262d });
  const skin = new THREE.MeshLambertMaterial({ color: 0xe0b48f });
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.5, 4, 10), shirt);
  torso.position.y = 1.2;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), skin);
  head.position.y = 1.72;
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.205, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.2), pants);
  hair.position.y = 1.74;
  const limb = (w, h, mat) => {
    const pivot = new THREE.Group();
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), mat);
    m.position.y = -h / 2;
    pivot.add(m);
    return pivot;
  };
  const legL = limb(0.17, 0.82, pants), legR = limb(0.17, 0.82, pants);
  legL.position.set(-0.12, 0.84, 0); legR.position.set(0.12, 0.84, 0);
  const armL = limb(0.12, 0.62, shirt), armR = limb(0.12, 0.62, shirt);
  armL.position.set(-0.36, 1.48, 0); armR.position.set(0.36, 1.48, 0);
  g.add(torso, head, hair, legL, legR, armL, armR);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  g.userData = { legL, legR, armL, armR, phase: 0 };
  return g;
}
function animateCharacter(ch, speed, dt) {
  const u = ch.userData;
  u.phase += dt * (speed > 0.1 ? 4 + speed * 1.1 : 0);
  const swing = speed > 0.1 ? Math.min(0.8, 0.35 + speed * 0.07) : 0;
  const s = Math.sin(u.phase) * swing;
  const ease = (o, v) => (o.rotation.x += (v - o.rotation.x) * Math.min(1, dt * 12));
  ease(u.legL, s); ease(u.legR, -s); ease(u.armL, -s * 0.8); ease(u.armR, s * 0.8);
}

// ---------- Photo frame ----------
function photoFrame(photo, width, { posts = true, loader, maxH = 2.1, videoFor = null }) {
  const g = new THREE.Group();
  const frameMat = new THREE.MeshLambertMaterial({ color: 0xfbfaf6 });
  const frame = new THREE.Mesh(new THREE.BoxGeometry(width + 0.24, width * 0.75 + 0.24, 0.08), frameMat);
  const pic = new THREE.Mesh(new THREE.PlaneGeometry(width, width * 0.75), new THREE.MeshBasicMaterial({ color: 0xdddddd }));
  pic.position.z = 0.045;
  pic.userData.photo = photo;
  frame.userData.photo = photo;
  g.add(frame, pic);
  const postMat = new THREE.MeshLambertMaterial({ color: 0x2b2f36 });
  const postsM = posts ? [-1, 1].map(() => new THREE.Mesh(new THREE.BoxGeometry(0.08, 1, 0.08), postMat)) : [];
  postsM.forEach((m) => g.add(m));
  // Fit the picture inside width × maxH whatever its shape, so portrait phone photos and
  // videos stay life-sized instead of towering; easels keep the picture's bottom at ~1 m.
  const fit = (tex, a) => {
    let w = width, h = width / a;
    if (h > maxH) { h = maxH; w = h * a; }
    pic.geometry.dispose();
    pic.geometry = new THREE.PlaneGeometry(w, h);
    frame.geometry.dispose();
    frame.geometry = new THREE.BoxGeometry(w + 0.24, h + 0.24, 0.08);
    if (tex) { pic.material.map = tex; pic.material.color.set(0xffffff); pic.material.needsUpdate = true; }
    if (posts) {
      const bottom = 0.95;
      g.position.y = bottom + h / 2 + 0.12;
      postsM.forEach((m, i) => {
        m.scale.y = bottom + 0.12;
        m.position.set((i ? 1 : -1) * Math.min(w / 2.4, 0.9), -h / 2 - 0.12 - (bottom + 0.12) / 2, -0.02);
      });
    }
    g.userData.height = h;
  };
  fit(null, 4 / 3);
  if (photo.video && photo.playable && videoFor) {
    // A moving picture: frames are copied into a small canvas, so even a 4K phone video only
    // uploads a few hundred pixels to the GPU per frame.
    const v = videoFor(photo);
    v.onSize((a) => fit(v.tex, a));
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    return { group: g, pick: [pic, frame], video: v };
  }
  loader.load(photo.full, (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    fit(tex, tex.image.width / tex.image.height || 4 / 3);
  });
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { group: g, pick: [pic, frame] };
}

// ---------- Cardboard figure of a person cut out of a photo ----------
const shadowTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grd.addColorStop(0, 'rgba(0,0,0,0.55)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
function makeStandee(fig) {
  const g = new THREE.Group();
  // Whole people stand on the ground at life size; people cut off by the photo's bottom edge
  // become a bust on a post, so they keep a believable head height.
  let h = fig.cut ? 1.05 : 1.75;
  let w = h * fig.aspect;
  if (w > 2.4) { w = 2.4; h = w / fig.aspect; }
  const lift = fig.cut ? 1.85 - h : 0;
  const tex = new THREE.CanvasTexture(fig.canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const card = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.45, side: THREE.DoubleSide }));
  card.position.y = lift + h / 2;
  g.add(card);
  if (fig.cut) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.07, lift + 0.2, 0.05), new THREE.MeshLambertMaterial({ color: 0x9c7a54 }));
    post.position.set(0, (lift + 0.2) / 2, -0.03);
    g.add(post);
  }
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(0.9, w * 0.8), 0.7), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.03;
  g.add(shadow);
  g.userData.grow = 0;
  g.scale.setScalar(0.01);
  return g;
}

// ---------- Main ----------
export async function enterStreet({ root, photos, place, lat, lng, onExit, type: wantType = null, onTypeChange = null, neighbors = {}, onPlace = null, startAt = null }) {
  const night = photos.filter((p) => p.date && (p.date.getHours() >= 18 || p.date.getHours() < 6)).length > photos.length / 2;
  let T = night ? NIGHT : DAY;

  root.innerHTML = `
    <canvas class="st-canvas"></canvas>
    <div class="st-top">
      <div class="st-actions"><button class="st-btn" data-act="exit">🌍 חזרה לגלובוס</button><button class="st-btn gold" data-act="leave-photo" hidden>↩ יציאה מהתמונה</button><button class="st-btn" data-act="nav-mode" type="button"></button></div>
      <div class="st-place"><b></b><span></span><button class="st-type" data-act="type" type="button"></button></div>
    </div>
    <div class="st-types" hidden></div>
    <div class="st-prompt" hidden></div>
    <div class="st-radar"><div class="st-count" hidden></div><canvas class="st-map"></canvas><div class="st-map-hint">הקישו על מקום במפה כדי לקפוץ אליו</div></div>
    <div class="st-toast" hidden></div>
    <div class="st-status" hidden></div>
    <div class="st-title"><b></b><span></span></div>
    <div class="st-help">${isTouch ? 'ג׳ויסטיק להליכה · גרירה לסיבוב המצלמה · הקשה על תמונה להגדלה · הקשה על המפה להגדלה' : 'WASD או חצים להליכה · Shift לריצה · גרירה לסיבוב · E או לחיצה על תמונה להגדלה · M או לחיצה על המפה להגדלה'}</div>
    <div class="st-strip" hidden></div>
    <div class="st-choose" hidden>
      <div class="st-choose-card">
        <h2>איך תרצו לעבור בין התמונות?</h2>
        <button class="st-choice" data-act="pick-nav" data-nav="album" type="button"><b>📖 אלבום</b><span>התמונות נפתחות אחת אחרי השנייה בלחיצה על "הבא". בלי הליכה.</span></button>
        <button class="st-choice" data-act="pick-nav" data-nav="game" type="button"><b>🎮 משחק</b><span>הולכים ברחוב, מחפשים את הזכרונות ונכנסים פנימה.</span></button>
        <p>אפשר להחליף בכל רגע מהכפתור למעלה.</p>
      </div>
    </div>
    <div class="st-album"><button class="st-btn" data-act="prev" type="button">‹ הקודם</button><span class="st-album-count"></span><button class="st-btn gold" data-act="next" type="button">הבא ›</button></div>
    <div class="st-joy" ${isTouch ? '' : 'hidden'}><div class="st-knob"></div></div>
    <div class="st-photo" hidden><figure><img alt=""><video controls playsinline hidden></video><figcaption><b></b><span></span></figcaption></figure><div class="st-photo-actions"><button class="st-btn" data-act="prev" type="button">‹</button><button class="st-btn" data-act="enter-photo">🔮 היכנסו לתמונה</button><button class="st-btn" data-act="close-photo">✕ סגור</button><button class="st-btn gold st-next-photo" data-act="next" type="button">הבא ›</button></div></div>
    <div class="st-loading"><div class="st-spinner"></div><div>יורדים לרחוב…</div></div>`;
  const $ = (s) => root.querySelector(s);
  $('.st-place b').textContent = place || 'המקום';

  const renderer = new THREE.WebGLRenderer({ canvas: $('.st-canvas'), antialias: true });
  const maxPR = Math.min(devicePixelRatio, isTouch ? 1.75 : 2);
  renderer.setPixelRatio(maxPR);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = !isTouch;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 900);
  const loader = new THREE.TextureLoader();

  // ----- Street scene -----
  const street = new THREE.Scene();
  street.background = new THREE.Color(T.sky);
  street.fog = new THREE.Fog(T.fog, night ? 70 : 90, night ? 260 : 320);
  street.add(new THREE.HemisphereLight(T.hemiSky, T.hemiGround, T.hemi));
  const sun = new THREE.DirectionalLight(T.sun, T.sunI);
  sun.position.set(-60, 120, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 400 });
  sun.shadow.bias = -0.0005;
  street.add(sun, sun.target);

  let area = await loadArea(lat, lng);
  // The kind of place: the visitor's choice, else a guess from the map and the photos.
  let type = TYPES[wantType] ? wantType : null;
  const autoType = !type;
  if (!type) {
    $('.st-loading div:last-child').textContent = 'מזהים איזה מקום זה…';
    let photoScores = null;
    try { photoScores = await Promise.race([scorePhotos(photos), new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), 8000))]); } catch { /* map only */ }
    type = decide(scoreMap(area), photoScores);
    $('.st-loading div:last-child').textContent = 'יורדים לרחוב…';
  }
  const CFG = SCENES[type];
  const mapped = area.source === 'osm';
  // A street-type place with no mapped buildings gets a generated block; open places stay open.
  if (CFG.fill === 'city' && area.buildings.length < 3) area = { ...generated(Math.round(Math.abs(lat * 1000 + lng * 1000))), source: 'generated' };
  $('.st-place span').textContent = mapped ? 'לפי מפת OpenStreetMap' : area.source === 'generated' ? 'שכונה לדוגמה: אין מפה לאזור' : 'אין מפה לאזור';
  $('.st-type').textContent = `${TYPES[type].icon} ${TYPES[type].label}${autoType ? ' (זוהה)' : ''} ▾`;
  // Open places: grass or sand underfoot, and the sky a little brighter.
  if (CFG.ground) T = { ...T, ground: CFG.ground[night ? 1 : 0] };
  const R = 260;
  const ground = new THREE.Mesh(new THREE.CircleGeometry(R + 120, 64), new THREE.MeshLambertMaterial({ color: T.ground }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  street.add(ground);

  // Beaches: if the map has no water near the spot, put the sea on the side away from the streets.
  let seaDir = null, seaEdge = 0;
  if (CFG.sea && !(area.water || []).some((r) => r.some(([x, z]) => Math.hypot(x, z) < 220))) {
    let cx = 0, cz = 0, n = 0;
    for (const b of area.buildings) for (const [x, z] of b.pts) { cx += x; cz += z; n++; }
    for (const r of area.roads) for (const [x, z] of r.pts) { cx += x; cz += z; n++; }
    seaDir = new THREE.Vector2(n ? -cx / n : -1, n ? -cz / n : 0);
    if (seaDir.length() < 2) seaDir.set(-1, 0);
    seaDir.normalize();
    seaEdge = 24;
    const seaGeo = new THREE.PlaneGeometry(1400, 1400);
    seaGeo.rotateX(-Math.PI / 2);
    seaGeo.rotateY(-Math.atan2(seaDir.y, seaDir.x));
    const sea = new THREE.Mesh(seaGeo, new THREE.MeshLambertMaterial({ color: night ? 0x1d3a63 : 0x2f8fc9 }));
    sea.position.set(seaDir.x * (seaEdge + 700), 0.04, seaDir.y * (seaEdge + 700));
    street.add(sea);
    const foamGeo = new THREE.PlaneGeometry(1.6, 1400);
    foamGeo.rotateX(-Math.PI / 2);
    foamGeo.rotateY(-Math.atan2(seaDir.y, seaDir.x));
    const foam = new THREE.Mesh(foamGeo, new THREE.MeshBasicMaterial({ color: 0xf4fbff, transparent: true, opacity: 0.8 }));
    foam.position.set(seaDir.x * seaEdge, 0.06, seaDir.y * seaEdge);
    street.add(foam);
  }
  const inSea = (x, z) => !!seaDir && x * seaDir.x + z * seaDir.y > seaEdge - 0.6;

  // Parks and water as flat shapes on the ground.
  for (const [rings, color, y] of [[area.parks || [], night ? 0x3d5a40 : 0x9cc57f, 0.008], [area.water || [], night ? 0x24406a : 0x6fb2dc, 0.012]]) {
    const geos = [];
    for (const ring of rings) {
      try {
        const g = new THREE.ShapeGeometry(new THREE.Shape(ring.map(([x, z]) => new THREE.Vector2(x, -z))));
        g.rotateX(-Math.PI / 2);
        g.translate(0, y, 0);
        g.deleteAttribute('uv');
        geos.push(g);
      } catch { /* skip a broken ring */ }
    }
    if (geos.length) {
      const m = new THREE.Mesh(mergeGeometries(geos), new THREE.MeshLambertMaterial({ color }));
      m.receiveShadow = true;
      street.add(m);
      geos.forEach((g) => g.dispose());
    }
  }

  // Roads, sidewalks and cars are laid out further down (dressing.js), once the photo spots are known.

  // Buildings: extruded footprints, coloured per building, merged into one mesh.
  const solids = area.buildings.map((b) => ({ ...b, box: bbox(b.pts) }));
  // The street nearest to the photo spot: photos and the visitor stand there, facing the venue.
  let road = null;
  for (const r of area.roads) {
    for (let i = 0; i < r.pts.length - 1; i++) {
      const c = closestOnPoly(0, 0, [r.pts[i], r.pts[i + 1]]);
      const score = c.d + (r.foot ? 6 : 0); // prefer real streets over footpaths
      if (!road || score < road.score) road = { ...c, score, width: r.width, dir: new THREE.Vector2(c.ex, c.ez).normalize() };
    }
  }
  if (road && road.d > 80) road = null;
  const focus = road ? [road.x, road.z] : [0, 0];

  // The venue: the building the photo spot falls in, else the one nearest the street spot, else a pavilion.
  let venue = solids.find((b) => inPoly(0, 0, b.pts));
  if (!venue) {
    let best = null;
    for (const b of solids) {
      const c = closestOnPoly(focus[0], focus[1], b.pts);
      if (c.d < 45 && (!best || c.d < best.c.d)) best = { b, c };
    }
    venue = best?.b;
  }
  if (!CFG.door) venue = null; // open places and city walks have no door to walk into
  else if (!venue) {
    venue = { id: -1, pts: [[-8, -16], [8, -16], [8, -6], [-8, -6]], h: 6, name: null };
    venue.box = bbox(venue.pts);
    solids.push(venue);
  }

  // Spatial index of building footprints (16 m cells), so collision and camera checks only look
  // at the few buildings nearby instead of every building in the neighbourhood.
  const CELL = 16;
  const cells = new Map();
  solids.forEach((b, i) => {
    b.stamp = 0;
    for (let cx = Math.floor(b.box[0] / CELL); cx <= Math.floor(b.box[2] / CELL); cx++) {
      for (let cz = Math.floor(b.box[1] / CELL); cz <= Math.floor(b.box[3] / CELL); cz++) {
        const k = cx * 100003 + cz;
        if (!cells.has(k)) cells.set(k, []);
        cells.get(k).push(b);
      }
    }
  });
  let stampNow = 0;
  const nearbyHit = (x, z, r, test) => {
    stampNow++;
    for (let cx = Math.floor((x - r) / CELL); cx <= Math.floor((x + r) / CELL); cx++) {
      for (let cz = Math.floor((z - r) / CELL); cz <= Math.floor((z + r) / CELL); cz++) {
        const list = cells.get(cx * 100003 + cz);
        if (!list) continue;
        for (const b of list) {
          if (b.stamp === stampNow) continue;
          b.stamp = stampNow;
          if (x > b.box[0] - r && x < b.box[2] + r && z > b.box[1] - r && z < b.box[3] + r && test(b)) return true;
        }
      }
    }
    return false;
  };
  // Height of the tallest roof at (x, z) within r metres (0 on open ground).
  const roofAt = (x, z, r = 2) => {
    let h = 0;
    nearbyHit(x, z, r, (b) => { if ((inPoly(x, z, b.pts) || closestOnPoly(x, z, b.pts).d < r) && b.h > h) h = b.h; return false; });
    return h;
  };
  const solidNear = (x, z, r) => inSea(x, z) || nearbyHit(x, z, r, (b) => inPoly(x, z, b.pts) || (r > 0 && closestOnPoly(x, z, b.pts).d < r));

  // A named place inside the venue (from the map's points of interest) names the venue.
  if (venue && !venue.name) venue.name = (area.pois || []).find((p) => p.name && inPoly(p.x, p.z, venue.pts))?.name || null;

  buildCity(street, { solids, venue, walls: T.walls, night, shadows: renderer.shadowMap.enabled });

  // Door on the venue wall facing the street, and the outward direction from it.
  // Without a venue, the "door" is just the spot where the photos gather, facing along the street.
  let doorAt = venue ? closestOnPoly(focus[0], focus[1], venue.pts) : { x: focus[0], z: focus[1], ex: road ? road.dir.x : 1, ez: road ? road.dir.y : 0, len: 10 };
  if (venue && doorAt.len < 3) {
    // Too narrow a wall for a door: use the longest wall instead.
    let longest = null;
    venue.pts.forEach(([ax, az], i) => {
      const [bx, bz] = venue.pts[(i + 1) % venue.pts.length];
      const len = Math.hypot(bx - ax, bz - az);
      if (!longest || len > longest.len) longest = { x: (ax + bx) / 2, z: (az + bz) / 2, ex: bx - ax, ez: bz - az, len };
    });
    doorAt = longest;
  }
  const edge = new THREE.Vector2(doorAt.ex, doorAt.ez).normalize();
  let out = new THREE.Vector2(-edge.y, edge.x);
  if (venue && inPoly(doorAt.x + out.x * 0.5, doorAt.z + out.y * 0.5, venue.pts)) out.negate();
  const door = new THREE.Vector3(doorAt.x, 0, doorAt.z);
  const facing = Math.atan2(out.x, out.y); // rotation.y that makes +z face `out`

  // Door: glowing frame, a GTA-style marker on the ground, and a sign.
  const doorGroup = new THREE.Group();
  doorGroup.position.copy(door).add(new THREE.Vector3(out.x * 0.06, 0, out.y * 0.06));
  doorGroup.rotation.y = facing;
  const glow = new THREE.MeshBasicMaterial({ color: 0xffd678 });
  const fr = (w, h, x, y) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.12), glow); m.position.set(x, y, 0); doorGroup.add(m); };
  fr(0.16, 2.7, -1.0, 1.35); fr(0.16, 2.7, 1.0, 1.35); fr(2.16, 0.16, 0, 2.7);
  const inner = new THREE.Mesh(new THREE.PlaneGeometry(1.84, 2.62), new THREE.MeshBasicMaterial({ color: night ? 0xffb85c : 0x3a2a18, transparent: true, opacity: 0.92 }));
  inner.position.set(0, 1.31, 0.01);
  doorGroup.add(inner);
  const sign = textSprite(CFG.door || '', { size: 54, color: '#241a05', bg: '#ffd678', scale: 1.4 });
  sign.position.set(0, 3.45, 0.2);
  doorGroup.add(sign);
  if (CFG.door) street.add(doorGroup);
  const markerMat = new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });
  const marker = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 1.6, 32, 1, true), markerMat);
  const markerPos = door.clone().add(new THREE.Vector3(out.x * 1.6, 0.8, out.y * 1.6));
  marker.position.copy(markerPos);
  if (CFG.door) street.add(marker);
  if (place && venue) {
    const name = textSprite(venue.name || place, { size: 64, scale: 1.8 });
    name.position.copy(door).add(new THREE.Vector3(out.x * 0.5, Math.min(venue.h + 2.2, 14), out.y * 0.5));
    street.add(name);
  }

  // Photos in front of the venue: a short exhibition on both sides of the path to the door.
  const pickables = [];
  const videoFrames = [];
  // One <video> per clip, shared by its street easel and its hall frame (phones limit how many
  // videos can decode at once). It draws into a small canvas used as the texture.
  const videoShared = new Map();
  const isPhone = matchMedia('(pointer: coarse)').matches;
  function videoFor(photo) {
    if (videoShared.has(photo)) return videoShared.get(photo);
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous'; // cloud videos: keep the canvas readable for WebGL
    Object.assign(video, { muted: true, loop: true, playsInline: true, preload: 'metadata', src: photo.video });
    video.setAttribute('playsinline', '');
    video.setAttribute('muted', '');
    const canvas = document.createElement('canvas');
    canvas.width = 4; canvas.height = 3;
    const ctx = canvas.getContext('2d');
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sizeFns = [];
    const entry = { video, tex, last: 0, ready: false, onSize: (fn) => { sizeFns.push(fn); if (entry.aspect) fn(entry.aspect); } };
    const setSize = (w, h) => {
      const k = Math.min(1, (isPhone ? 480 : 720) / Math.max(w, h));
      canvas.width = Math.max(2, Math.round(w * k));
      canvas.height = Math.max(2, Math.round(h * k));
      entry.aspect = w / h;
      sizeFns.forEach((fn) => fn(entry.aspect));
    };
    // Show the poster frame until the clip plays.
    const poster = new Image();
    poster.crossOrigin = 'anonymous';
    poster.onload = () => {
      if (!entry.aspect) setSize(poster.width, poster.height);
      if (!entry.ready) { ctx.drawImage(poster, 0, 0, canvas.width, canvas.height); tex.needsUpdate = true; }
    };
    poster.src = photo.full;
    video.addEventListener('loadedmetadata', () => { if (video.videoWidth) setSize(video.videoWidth, video.videoHeight); });
    entry.draw = (now) => {
      if (video.paused || video.readyState < 2 || now - entry.last < (isPhone ? 40 : 30)) return;
      entry.last = now;
      entry.ready = true;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      tex.needsUpdate = true;
    };
    videoShared.set(photo, entry);
    return entry;
  }
  const streetPhotos = photos.slice(0, 6);
  const tangent = new THREE.Vector2(out.y, -out.x);
  // Candidate easel spots fan out from the door; spots inside or against a building are skipped.
  const easelSpots = [];
  for (let k = 0; k < 8 && easelSpots.length < streetPhotos.length; k++) {
    for (const side of [1, -1]) {
      const along = side * (2.9 + k * 3.1), dist = 4.2 + k * 1.2;
      const x = door.x + out.x * dist + tangent.x * along, z = door.z + out.y * dist + tangent.y * along;
      const clear = !solidNear(x, z, 1.4);
      if (clear) easelSpots.push({ x, z, side });
    }
  }
  // A game of finding memories: a couple of photos wait at the door, the rest are scattered
  // along nearby streets, each marked by a beam of light you can see over the roofs.
  const clearAt = (x, z, r) => !solidNear(x, z, r);
  const nearCount = Math.min(easelSpots.length, streetPhotos.length <= 3 ? 1 : 2);
  const roadSpots = [];
  for (const r of area.roads) {
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      for (let t = 4; t < len - 2; t += 7) {
        const x = ax + ((bx - ax) * t) / len, z = az + ((bz - az) * t) / len;
        const d = Math.hypot(x - door.x, z - door.z);
        if (d > 22 && d < 85 && clearAt(x, z, 2.5)) roadSpots.push({ x, z, d, dir: Math.atan2(bx - ax, bz - az) });
      }
    }
  }
  // Few or no roads (a beach, a forest): add spots on open ground around the place.
  if (roadSpots.length < (streetPhotos.length - nearCount) * 3) {
    for (let i = 0; i < 90; i++) {
      const ang = i * 2.399, rr = 22 + (i % 9) * 7;
      const x = door.x + Math.cos(ang) * rr, z = door.z + Math.sin(ang) * rr;
      if (clearAt(x, z, 2.5)) roadSpots.push({ x, z, d: rr, dir: ang });
    }
  }
  // Spread them out: each next spot is the one farthest from those already taken (within reach).
  const scattered = [];
  const want = streetPhotos.length - nearCount;
  roadSpots.sort((a, b) => a.d - b.d);
  while (scattered.length < want && roadSpots.length) {
    let best = null, bestScore = -1;
    for (const c of roadSpots) {
      const gap = Math.min(Math.hypot(c.x - door.x, c.z - door.z), ...scattered.map((q) => Math.hypot(c.x - q.x, c.z - q.z)));
      const score = Math.min(gap, 40) - c.d * 0.15;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    scattered.push(best);
    roadSpots.splice(roadSpots.indexOf(best), 1);
  }
  const memories = [];
  const beamGeo = new THREE.CylinderGeometry(0.55, 0.55, 40, 16, 1, true);
  beamGeo.translate(0, 20, 0);
  const spots = [
    ...easelSpots.slice(0, nearCount).map((e) => ({ x: e.x, z: e.z, rot: facing + e.side * 0.32 })),
    ...scattered.map((q) => ({ x: q.x, z: q.z, rot: Math.atan2(door.x - q.x, door.z - q.z) })),
  ];
  streetPhotos.slice(0, spots.length).forEach((p, i) => {
    const { x: ex, z: ez, rot } = spots[i];
    const { group, pick, video } = photoFrame(p, 2.3, { loader, videoFor });
    if (video) videoFrames.push({ video, group });
    group.position.set(ex, group.position.y, ez);
    group.rotation.y = rot;
    street.add(group);
    pickables.push(...pick);
    const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    beam.position.set(ex, 0, ez);
    street.add(beam);
    memories.push({ x: ex, z: ez, rot, photo: p, found: false, beam });
    if (night) {
      const l = new THREE.PointLight(0xffd9a0, 6, 7, 1.6);
      l.position.set(group.position.x + out.x * 1.2, 3.4, group.position.z + out.y * 1.2);
      street.add(l);
    }
  });
  if (night) {
    const l = new THREE.PointLight(0xffc070, 14, 10, 1.4);
    l.position.copy(door).add(new THREE.Vector3(out.x * 2, 3, out.y * 2));
    street.add(l);
  }

  // Trees along the bigger roads, and lamp posts at night.
  const treeSpots = [], lampSpots = [];
  const blocked = (x, z) => nearbyHit(x, z, 1, (b) => inPoly(x, z, b.pts));
  for (const r of area.roads) {
    if (r.foot) continue;
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const nx = -(bz - az) / len, nz = (bx - ax) / len;
      for (let s = 6; s < len - 3; s += 13) {
        const t = s / len, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
        const side = (Math.floor(s / 13) % 2 ? 1 : -1) * (r.width / 2 + 1.6);
        const px = x + nx * side, pz = z + nz * side;
        if (Math.hypot(px, pz) > R || blocked(px, pz) || Math.hypot(px - door.x, pz - door.z) < 9) continue;
        if (treeSpots.length < 400) treeSpots.push([px, pz]);
        if (s % 26 < 13 && lampSpots.length < 200) lampSpots.push([x - nx * side, z - nz * side]);
      }
    }
  }
  const nearMemory = (x, z, r) => memories.some((m) => Math.hypot(m.x - x, m.z - z) < r) || Math.hypot(x - door.x, z - door.z) < r + 4;
  if (CFG.forest) {
    // Woods around the trail, thinning out near the photos.
    for (let i = 0; i < 320 && treeSpots.length < 520; i++) {
      const ang = i * 2.399 + 0.3, rr = 7 + Math.sqrt(i / 320) * 170;
      const x = Math.cos(ang) * rr, z = Math.sin(ang) * rr;
      if (!blocked(x, z) && !nearMemory(x, z, 4.5)) treeSpots.push([x, z]);
    }
    const hills = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 7), new THREE.MeshLambertMaterial({ color: night ? 0x34503a : 0x6f9a55, flatShading: true }), 14);
    const hd = new THREE.Object3D();
    for (let i = 0; i < 14; i++) {
      const ang = (i / 14) * Math.PI * 2 + (i % 3) * 0.2, rr = 200 + (i % 4) * 25;
      hd.position.set(Math.cos(ang) * rr, 0, Math.sin(ang) * rr);
      hd.scale.set(60 + (i % 5) * 14, 26 + (i % 4) * 12, 60 + (i % 3) * 18);
      hd.position.y = hd.scale.y / 2;
      hd.updateMatrix();
      hills.setMatrixAt(i, hd.matrix);
    }
    street.add(hills);
  }
  if (seaDir) {
    // Beach umbrellas along the shore.
    const tx = -seaDir.y, tz = seaDir.x;
    const colors = [0xe2445c, 0xf2b134, 0x2f9fd8, 0x4caf50, 0xffffff];
    for (let i = -5; i <= 5; i++) {
      const along = i * 9 + (i % 2) * 3, inland = 7 + (Math.abs(i) % 3) * 4;
      const x = seaDir.x * (seaEdge - inland) + tx * along, z = seaDir.y * (seaEdge - inland) + tz * along;
      if (blocked(x, z) || nearMemory(x, z, 3)) continue;
      const u = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.4, 6), new THREE.MeshLambertMaterial({ color: 0xdddddd }));
      pole.position.y = 1.2;
      const top = new THREE.Mesh(new THREE.ConeGeometry(1.3, 0.55, 10), new THREE.MeshLambertMaterial({ color: colors[(i + 5) % colors.length], flatShading: true }));
      top.position.y = 2.45;
      u.add(pole, top);
      u.position.set(x, 0, z);
      u.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      street.add(u);
    }
  }
  const dummy = new THREE.Object3D();
  const instanced = (geo, mat, spots, y, scaleRand = 0) => {
    if (!spots.length) return;
    const m = new THREE.InstancedMesh(geo, mat, spots.length);
    spots.forEach(([x, z], i) => {
      const s = 1 + ((i * 37) % 10) / 10 * scaleRand;
      dummy.position.set(x, y * s, z); dummy.scale.setScalar(s); dummy.rotation.y = i; dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    });
    m.castShadow = true;
    street.add(m);
  };
  instanced(new THREE.CylinderGeometry(0.12, 0.16, 2.2, 6), new THREE.MeshLambertMaterial({ color: 0x6b4a2f }), treeSpots, 1.1, 0.4);
  instanced(new THREE.IcosahedronGeometry(1.5, 0), new THREE.MeshLambertMaterial({ color: night ? 0x2f5a3a : 0x6aa84f, flatShading: true }), treeSpots, 3.1, 0.4);
  // Tree pits: a dark square of soil around each trunk.
  const pit = new THREE.PlaneGeometry(1.3, 1.3);
  pit.rotateX(-Math.PI / 2);
  instanced(pit, new THREE.MeshLambertMaterial({ color: night ? 0x3a3330 : 0x6b5a48, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -10 }), treeSpots, 0.03);
  instanced(new THREE.CylinderGeometry(0.06, 0.09, 5, 6), new THREE.MeshLambertMaterial({ color: 0x30343b }), lampSpots, 2.5);
  instanced(new THREE.SphereGeometry(0.28, 10, 8), night ? new THREE.MeshBasicMaterial({ color: 0xffe2a8 }) : new THREE.MeshLambertMaterial({ color: 0xf4f1e6, emissive: 0x333028 }), lampSpots, 5.1);

  // Sidewalks, asphalt, markings, parked and passing cars, benches.
  const dressing = dressStreet(street, {
    roads: area.roads, R, T, night, shadows: renderer.shadowMap.enabled, trees: [...treeSpots, ...lampSpots],
    blocked: (x, z, r) => solidNear(x, z, r),
    avoid: [
      { x: door.x, z: door.z, r: 10 },
      { x: markerPos.x, z: markerPos.z, r: 4 },
      { x: focus[0], z: focus[1], r: 7 },
      ...memories.map((m) => ({ x: m.x, z: m.z, r: 3 })),
    ],
  });

  // Collision: building footprints (2D) with a small body radius.
  const BODY = 0.35;
  const blockedAt = (x, z) => solidNear(x, z, BODY) || dressing.carAt(x, z, BODY) || dressing.furnitureAt(x, z, BODY);

  // ----- Interior: an event hall, a restaurant or a living room -----
  const inside = CFG.inside || 'event';
  const hall = new THREE.Scene();
  hall.background = new THREE.Color(0x0e1222);
  const [HW, HD, HH] = inside === 'home' ? [7, 6, 3.2] : inside === 'restaurant' ? [9.5, 7, 3.8] : [13, 8, 5.2];
  hall.add(new THREE.HemisphereLight(0xffe7c4, 0x3a2a1c, inside === 'event' ? 0.9 : 1.15));
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(HW * 2, HD * 2), new THREE.MeshLambertMaterial({ map: planksTexture() }));
  floor.material.map.repeat.set(HW / 2.2, HD / 2);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  hall.add(floor);
  const wallColor = inside === 'home' ? 0xf3ece1 : inside === 'restaurant' ? 0xe9cfb6 : 0xf1e9dc;
  const room = new THREE.Mesh(new THREE.BoxGeometry(HW * 2, HH, HD * 2), new THREE.MeshLambertMaterial({ color: wallColor, side: THREE.BackSide }));
  room.position.y = HH / 2 - 0.01;
  hall.add(room);
  const tables = [];    // anchor points the cardboard figures gather around
  const obstacles = []; // [x, z, radius] the visitor walks around
  const box = (w, h, d, color, x, y, z, ry = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
    m.position.set(x, y, z);
    m.rotation.y = ry;
    m.castShadow = true;
    hall.add(m);
    return m;
  };
  const lamp = (x, z, y, intensity = 10, range = 9) => {
    const l = new THREE.PointLight(0xffd59a, intensity, range, 1.3);
    l.position.set(x, y, z);
    hall.add(l);
  };

  if (inside === 'event') {
    // String lights across the ceiling, like an evening terrace.
    const bulbGeo = new THREE.SphereGeometry(0.07, 8, 6);
    const bulbMat = new THREE.MeshBasicMaterial({ color: 0xfff0c2 });
    const bulbs = [];
    for (let line = -2; line <= 2; line++) {
      const z = line * 3.2;
      for (let x = -HW + 0.6; x <= HW - 0.6; x += 0.9) bulbs.push([x, HH - 0.3 - 0.7 * (1 - (x / HW) ** 2), z]);
    }
    const bulbMesh = new THREE.InstancedMesh(bulbGeo, bulbMat, bulbs.length);
    bulbs.forEach(([x, y, z], i) => { dummy.position.set(x, y, z); dummy.scale.setScalar(1); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); bulbMesh.setMatrixAt(i, dummy.matrix); });
    hall.add(bulbMesh);
    for (const [x, z] of [[-7, -3], [0, 0], [7, 3], [-7, 4], [7, -4]]) lamp(x, z, HH - 1, 14, 16);
    // Round tables with white cloths and chairs, as at a family event.
    const cloth = new THREE.MeshLambertMaterial({ color: 0xf7f5f0 });
    const chairMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    for (const [x, z] of [[-7, -3.2], [-7, 3.2], [7, -3.2], [7, 3.2], [0, -4.2]]) {
      tables.push([x, z]);
      obstacles.push([x, z, 1.95]);
      const t = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.25, 0.78, 28), cloth);
      t.position.set(x, 0.39, z);
      t.castShadow = true;
      hall.add(t);
      for (let a = 0; a < 8; a++) {
        const ang = (a / 8) * Math.PI * 2;
        const c = new THREE.Group();
        const seat = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.06, 0.42), chairMat);
        seat.position.y = 0.46;
        const back = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.55, 0.05), chairMat);
        back.position.set(0, 0.75, 0.2);
        c.add(seat, back);
        c.position.set(x + Math.cos(ang) * 1.65, 0, z + Math.sin(ang) * 1.65);
        c.rotation.y = -ang + Math.PI / 2;
        hall.add(c);
      }
    }
  } else if (inside === 'restaurant') {
    // Small square tables for two and four, a counter along the back, pendant lamps.
    for (const [x, z] of [[-5.5, -2.5], [-5.5, 2.2], [0, 0.5], [5.5, -2.5], [5.5, 2.2], [0, -3.6]]) {
      tables.push([x, z]);
      obstacles.push([x, z, 1.35]);
      box(1.1, 0.06, 1.1, 0x6e4a30, x, 0.76, z);
      box(0.12, 0.74, 0.12, 0x3b2a1e, x, 0.37, z);
      for (const [dx, dz, ry] of [[0, 0.85, Math.PI], [0, -0.85, 0], [0.85, 0, -Math.PI / 2], [-0.85, 0, Math.PI / 2]]) {
        box(0.42, 0.05, 0.42, 0x2c2c30, x + dx, 0.46, z + dz, ry);
        const back = box(0.42, 0.5, 0.05, 0x2c2c30, x + dx * 1.22, 0.72, z + dz * 1.22, ry);
        back.rotation.y = ry;
      }
      const shade = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.3, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xffcf7a, side: THREE.DoubleSide }));
      shade.position.set(x, HH - 1.1, z);
      hall.add(shade);
      lamp(x, z, HH - 1.3, 6, 6);
    }
    box(7, 1.1, 0.8, 0x7a5236, -HW + 4.2, 0.55, -HD + 0.6);
    obstacles.push([-HW + 2.4, -HD + 0.6, 1.4], [-HW + 4.2, -HD + 0.6, 1.4], [-HW + 6, -HD + 0.6, 1.4]);
  } else {
    // A living room: rug, sofa, armchair, coffee table, bookshelf and warm lamps.
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 3.6), new THREE.MeshLambertMaterial({ color: 0x9c4f3e }));
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(0, 0.012, -0.6);
    hall.add(rug);
    box(3.4, 0.45, 1, 0x4a5d7a, 0, 0.32, -3.4);
    box(3.4, 0.7, 0.25, 0x4a5d7a, 0, 0.75, -3.85);
    box(0.25, 0.6, 1, 0x4a5d7a, -1.75, 0.5, -3.4);
    box(0.25, 0.6, 1, 0x4a5d7a, 1.75, 0.5, -3.4);
    box(1.1, 0.42, 0.9, 0x8a6a4a, -3.4, 0.3, -0.8, 0.6);
    box(1.6, 0.4, 0.8, 0x6e4a30, 0, 0.22, -1.4);
    box(2.4, 2.4, 0.4, 0x6e4a30, HW - 1.6, 1.2, -HD + 0.25);
    for (const [x, z] of [[0, -3.4], [-3.4, -0.8], [0, -1.4]]) tables.push([x, z]);
    obstacles.push([0, -3.4, 1.9], [-3.4, -0.8, 1], [0, -1.4, 1.1], [HW - 1.6, -HD + 0.25, 1.4]);
    lamp(-HW + 1.2, -HD + 1.2, 1.9, 9, 10);
    lamp(HW - 1.4, 1.5, 2.2, 7, 9);
    lamp(0, 0, HH - 0.4, 6, 10);
  }
  // Photos on the walls: back wall, then the side walls, two rows when there are many.
  const slots = [];
  const addRow = (y) => {
    for (let x = -HW + 2.4; x <= HW - 2.4; x += 3.6) if (inside !== 'home' || x < HW - 3.4) slots.push({ pos: [x, y, -HD + 0.06], rot: 0 });
    for (let z = -HD + 2.6; z <= HD - 2.6; z += 3.4) slots.push({ pos: [-HW + 0.06, y, z], rot: Math.PI / 2 });
    for (let z = -HD + 2.6; z <= HD - 2.6; z += 3.4) slots.push({ pos: [HW - 0.06, y, z], rot: -Math.PI / 2 });
  };
  addRow(inside === 'event' ? 2.05 : 1.75);
  if (photos.length > slots.length && HH > 4.5) addRow(4.0);
  const hallStops = [];
  photos.slice(0, slots.length).forEach((p, i) => {
    {
      const nrm = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), slots[i].rot);
      hallStops.push({ scene: 'hall', photo: p, fx: slots[i].pos[0], fz: slots[i].pos[2], nx: nrm.x, nz: nrm.z });
    }
    const big = inside === 'event' && photos.length <= 14;
    const { group, pick, video } = photoFrame(p, big ? 2.2 : 1.6, { posts: false, loader, videoFor, maxH: big ? 2.2 : 1.4 });
    if (video) videoFrames.push({ video, group });
    group.position.set(...slots[i].pos);
    group.rotation.y = slots[i].rot;
    hall.add(group);
    pickables.push(...pick);
    const spot = new THREE.SpotLight(0xfff1d6, 18, 6, 0.5, 0.6, 1.2);
    const dir = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), slots[i].rot);
    spot.position.set(slots[i].pos[0] + dir.x * 1.6, HH - 0.3, slots[i].pos[2] + dir.z * 1.6);
    spot.target = group;
    hall.add(spot);
  });
  const title = textSprite(`${(inside === 'home' ? CFG.title : place) || CFG.title || ''}${photos[0]?.date ? ' · ' + dateFmt.format(photos[0].date) : ''}`, { size: 60, scale: 2 });
  title.position.set(0, HH - (inside === "event" ? 1.2 : 0.45), -HD + 0.4);
  hall.add(title);
  // Exit door on the front wall.
  const exit = new THREE.Group();
  exit.position.set(0, 0, HD - 0.05);
  exit.rotation.y = Math.PI;
  const eGlow = new THREE.MeshBasicMaterial({ color: 0x9fe0ff });
  for (const [w, h, x, y] of [[0.16, 2.7, -1, 1.35], [0.16, 2.7, 1, 1.35], [2.16, 0.16, 0, 2.7]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.12), eGlow);
    m.position.set(x, y, 0);
    exit.add(m);
  }
  const exitSign = textSprite(CFG.exit || 'יציאה', { size: 54, scale: 1.3 });
  exitSign.position.set(0, Math.min(3.4, HH - 0.35), 0.2);
  exit.add(exitSign);
  hall.add(exit);
  const exitPos = new THREE.Vector3(0, 0, HD - 1.4);
  const hallBlocked = (x, z) => Math.abs(x) > HW - BODY - 0.1 || Math.abs(z) > HD - BODY - 0.1 || obstacles.some(([ox, oz, r]) => Math.hypot(x - ox, z - oz) < r);

  // ----- Player -----
  const player = makeCharacter();
  let mode = 'street';
  let scene = street;
  // Start a short walk from the door, on open ground: straight out if possible, else a bit to the side.
  // Start on the street in front of the venue, with room around the visitor.
  const roomy = (x, z, r) => !solidNear(x, z, r);
  const spawnStreet = () => {
    const tries = [];
    if (road) for (const s2 of [0, 6, -6, 12, -12]) tries.push([road.x + road.dir.x * s2, road.z + road.dir.y * s2]);
    for (let d = 12; d >= 5; d -= 1) for (const side of [0, 2, -2, 4, -4, 7, -7]) tries.push([door.x + out.x * d + tangent.x * side, door.z + out.y * d + tangent.y * side]);
    for (const need of [3, 2, 1]) {
      for (const [x, z] of tries) {
        const d = Math.hypot(x - markerPos.x, z - markerPos.z);
        if (d > 4 && d < 30 && roomy(x, z, need)) return new THREE.Vector3(x, 0, z);
      }
    }
    return door.clone().add(new THREE.Vector3(out.x * 6, 0, out.y * 6));
  };
  player.position.copy(spawnStreet());
  // The camera sits at player + dir(yaw) and looks back at the player: put it on the far side
  // of the visitor from the door, so the first view is the venue.
  let yaw = Math.atan2(player.position.x - door.x, player.position.z - door.z);
  player.rotation.y = yaw + Math.PI;
  street.add(player);

  // Walkable grid for the route, the chevrons that draw it on the street, and the radar.
  const grid = makeGrid(R, 2.5, (x, z) => !clearAt(x, z, 0.9) || dressing.carAt(x, z, 0));
  const chevShape = new THREE.Shape([new THREE.Vector2(-0.55, -0.3), new THREE.Vector2(0, 0.35), new THREE.Vector2(0.55, -0.3), new THREE.Vector2(0.55, -0.05), new THREE.Vector2(0, 0.6), new THREE.Vector2(-0.55, -0.05)].map((v) => v));
  const chevGeo = new THREE.ShapeGeometry(chevShape);
  chevGeo.rotateX(-Math.PI / 2);
  const chevMat = new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.9, depthWrite: false });
  const MAXCHEV = 90;
  const chevrons = new THREE.InstancedMesh(chevGeo, chevMat, MAXCHEV);
  chevrons.count = 0;
  chevrons.frustumCulled = false;
  street.add(chevrons);
  const drawMap = makeMinimap($('.st-map'), { radius: R, buildings: solids, roads: area.roads, night });
  let route = null, routeAt = -1, routeFrom = new THREE.Vector3(1e9, 0, 0);
  // Tap the radar to open it large; tap a place on the large map to jump there.
  let mapBig = false;
  const setMapBig = (on) => { mapBig = on; $('.st-radar').classList.toggle('big', on); };
  const jumpTo = (tx, tz) => {
    const lim = R - 6, d0 = Math.hypot(tx, tz);
    if (d0 > lim) { tx *= lim / d0; tz *= lim / d0; }
    let spot = null;
    for (let r = 0; r <= 14 && !spot; r += 0.75) {
      const n = r ? Math.ceil((r * Math.PI * 2) / 1.2) : 1;
      for (let q = 0; q < n; q++) {
        const a = (q / n) * Math.PI * 2, x = tx + Math.cos(a) * r, z = tz + Math.sin(a) * r;
        if (Math.hypot(x, z) < lim && roomy(x, z, 0.9)) { spot = [x, z]; break; }
      }
    }
    if (!spot) { showToast('אי אפשר להגיע לשם'); return; }
    fadeSwap(() => {
      player.position.set(spot[0], 0, spot[1]);
      vel.set(0, 0);
      routeAt = -1e9;
    });
  };
  $('.st-map').addEventListener('click', (e) => {
    e.stopPropagation();
    if (mode !== 'street' || fading) return;
    if (!mapBig) { setMapBig(true); return; }
    const p = drawMap.pick(e.clientX, e.clientY);
    if (!p) return;
    setMapBig(false);
    jumpTo(p.x, p.z);
  });
  $('.st-radar').addEventListener('click', (e) => { if (mapBig && e.target === $('.st-radar')) setMapBig(false); });
  const target = () => memories.find((m) => !m.found) || (CFG.door ? { x: markerPos.x, z: markerPos.z, door: true } : null);
  const updateCount = () => {
    const n = memories.filter((m) => m.found).length;
    $('.st-count').textContent = memories.length ? `📸 זכרונות שנמצאו ${n}/${memories.length}` : '';
    $('.st-count').hidden = !memories.length;
  };
  updateCount();
  let allFoundShown = false;
  let pitch = 0.32;
  let camDist = 7;
  let cooldown = 1.5;

  // Soft fade through dark: run `fn` while the screen is covered, then reveal.
  let fading = false;
  const fadeSwap = (fn) => {
    if (fading) return;
    fading = true;
    cooldown = 9;
    root.classList.add('st-fade');
    setTimeout(() => {
      fn();
      cooldown = 1.2;
      camera.position.copy(followPos());
      lookAt.copy(player.position).y += 1.6;
      requestAnimationFrame(() => { root.classList.remove('st-fade'); fading = false; });
    }, 320);
  };
  const goHall = () => {
    mode = 'hall';
    $('.st-radar').hidden = true;
    setMapBig(false);
    scene = hall;
    hall.add(player);
    player.position.set(0, 0, HD - 4.5);
    player.rotation.y = Math.PI;
    yaw = 0;
  };
  const goStreet = () => {
    mode = 'street';
    $('.st-radar').hidden = false;
    scene = street;
    street.add(player);
    player.position.copy(door).add(new THREE.Vector3(out.x * 4, 0, out.y * 4));
    player.rotation.y = facing;
    yaw = facing + Math.PI;
  };

  // ----- People from the photos, cut out on the device and stood up as cardboard figures -----
  const standees = [];
  const status = (msg) => { const el = $('.st-status'); el.textContent = msg || ''; el.hidden = !msg; };
  const streetSpotsFor = (m) => {
    const rot = m.rot ?? 0;
    const fx = Math.sin(rot), fz = Math.cos(rot), tx = fz, tz = -fx;
    const outSpots = [];
    for (const [f, t] of [[1.6, -1.7], [1.6, 1.7], [2.6, -2.9], [2.6, 2.9], [3.4, 0.9], [3.4, -0.9], [1.0, -3.2], [1.0, 3.2]]) {
      const x = m.x + fx * f + tx * t, z = m.z + fz * f + tz * t;
      if (clearAt(x, z, 0.5) && !dressing.carAt(x, z, 0.5)) outSpots.push([x, z]);
    }
    return outSpots;
  };
  const hallSpots = [];
  // Round-robin over the tables so the figures spread through the room.
  for (const a of [0.6, 3.8, 2.2, 5.2]) for (const [tx2, tz2] of tables) hallSpots.push([tx2 + Math.cos(a) * 2.55, tz2 + Math.sin(a) * 2.55]);
  for (let x = -HW + 2; x <= HW - 2; x += 4.2) hallSpots.push([x, -HD + 1.6]);
  const hallFree = hallSpots.filter(([x, z]) => !hallBlocked(x, z) && Math.hypot(x - exitPos.x, z - exitPos.z) > 2.5);
  let hallNext = 0;
  async function populate() {
    const list = photos.slice(0, 12);
    let done = 0;
    for (const p of list) {
      if (!running) return;
      status(`✨ מזהה אנשים בתמונות ${done + 1}/${list.length}`);
      let figs = [];
      try { figs = await peopleFrom(p, 4); } catch (e) {
        console.warn('people cut-out failed', e);
        if (done === 0) { status(''); return; }
      }
      if (!running) return;
      const m = memories.find((q) => q.photo === p);
      const spotsS = m ? streetSpotsFor(m) : [];
      figs.forEach((fig, i) => {
        if (spotsS[i]) {
          const st = makeStandee(fig);
          st.position.set(spotsS[i][0], 0, spotsS[i][1]);
          street.add(st);
          standees.push(st);
        }
        if (hallNext < hallFree.length) {
          const st = makeStandee(fig);
          const [hx, hz] = hallFree[hallNext++];
          st.position.set(hx, 0, hz);
          hall.add(st);
          standees.push(st);
        }
      });
      done++;
    }
    const n = standees.length;
    status('');
    if (n) showToast(`👨‍👩‍👧 ${n} דמויות מהתמונות הצטרפו לאירוע`);
  }

  // ----- Input -----
  const keys = new Set();
  const joy = { x: 0, y: 0, id: null };
  const onKey = (e) => {
    if (e.type === 'keydown') {
      skipIntro();
      if (e.code === 'Escape') { if (mapBig) setMapBig(false); else if (!$('.st-photo').hidden) closePhoto(); else if (mode === 'photo') leavePhoto(); return; }
      if (e.code === 'KeyM' && mode === 'street') { setMapBig(!mapBig); return; }
      if (e.code === 'KeyE' && near) { openPhoto(near); return; }
      if (e.code === 'KeyQ' && near && mode !== 'photo') { enterPhoto(near); return; }
      if (e.code === 'Space' || e.code === 'PageDown') { e.preventDefault(); albumStep(1); return; }
      if (viewing && e.code === 'ArrowLeft') { e.preventDefault(); albumStep(1); return; }
      if (viewing && e.code === 'ArrowRight') { e.preventDefault(); albumStep(-1); return; }
      if (e.code === 'Backspace' || e.code === 'PageUp') { e.preventDefault(); albumStep(-1); return; }
      keys.add(e.code);
    } else keys.delete(e.code);
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKey);

  const canvas = $('.st-canvas');
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    skipIntro();
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    yawGoal = null;
    yaw -= (e.clientX - drag.x) * 0.006;
    pitch = Math.max(0.05, Math.min(1.1, pitch + (e.clientY - drag.y) * 0.004));
    drag.x = e.clientX; drag.y = e.clientY;
  });
  const ray = new THREE.Raycaster();
  canvas.addEventListener('pointerup', (e) => {
    if (drag && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 8) {
      const r = canvas.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
      const hit = ray.intersectObjects(pickables.filter((m) => isIn(m, scene)), false)[0];
      if (hit && hit.distance < 30) openPhoto(hit.object.userData.photo);
    }
    drag = null;
  });
  const isIn = (o, sc) => { while (o) { if (o === sc) return true; o = o.parent; } return false; };
  canvas.addEventListener('wheel', (e) => { camDist = Math.max(3, Math.min(16, camDist + e.deltaY * 0.01)); }, { passive: true });

  const joyEl = $('.st-joy'), knob = $('.st-knob');
  joyEl.addEventListener('pointerdown', (e) => { joy.id = e.pointerId; joyEl.setPointerCapture(e.pointerId); moveJoy(e); });
  joyEl.addEventListener('pointermove', (e) => { if (e.pointerId === joy.id) moveJoy(e); });
  const endJoy = () => { joy.id = null; joy.x = joy.y = 0; knob.style.transform = ''; };
  joyEl.addEventListener('pointerup', endJoy);
  joyEl.addEventListener('pointercancel', endJoy);
  function moveJoy(e) {
    const r = joyEl.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const m = Math.hypot(dx, dy), max = r.width / 2 - 18;
    if (m > max) { dx = (dx / m) * max; dy = (dy / m) * max; }
    joy.x = dx / max; joy.y = dy / max;
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  // ----- Photo overlay -----
  let viewing = null;
  let toastTimer = 0;
  function showToast(msg, ms = 3500) {
    const t = $('.st-toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), ms);
  }
  function markFound(m) {
    if (m.found) return;
    m.found = true;
    m.beam.visible = false;
    updateCount();
    const left = memories.filter((q) => !q.found).length;
    if (nav === 'album') { /* no game messages in album mode */ } else if (left) showToast(`✨ מצאתם זיכרון! נשארו עוד ${left}`);
    else if (!allFoundShown) { allFoundShown = true; showToast(CFG.door ? `🎉 מצאתם את כל הזכרונות! עכשיו פנימה: ${CFG.door}` : '🎉 מצאתם את כל הזכרונות במקום הזה!', 5000); }
    routeAt = -1;
  }
  function openPhoto(p) {
    const m = memories.find((q) => q.photo === p);
    if (m && mode === 'street') markFound(m);
    viewing = p;
    const ov = $('.st-photo video');
    if (p.video && p.playable) {
      $('.st-photo img').hidden = true;
      ov.hidden = false;
      ov.src = p.video;
      ov.poster = p.full;
      ov.play().catch(() => {});
    } else {
      ov.pause();
      ov.hidden = true;
      $('.st-photo img').hidden = false;
    }
    $('.st-photo img').src = p.full;
    $('.st-photo b').textContent = p.place || place || '';
    $('.st-photo span').textContent = p.date ? dateFmt.format(p.date) : '';
    $('.st-photo').hidden = false;
  }
  function closePhoto() { viewing = null; $('.st-photo video').pause(); $('.st-photo').hidden = true; }

  // ----- Inside a photo: the picture becomes a relief you can walk around (AI depth) -----
  const dio = { scene: null, photo: null, depth: 2, w: 8, back: null, busy: false };
  const photoBlocked = (x, z) => Math.abs(x) > dio.w / 2 + 2.5 || z < dio.depth + 0.6 || z > dio.depth + 11;
  const texOf = (url) => new Promise((res, rej) => loader.load(url, (t) => { t.colorSpace = THREE.SRGBColorSpace; res(t); }, undefined, rej));
  function buildDiorama(depth, tex) {
    const sc = new THREE.Scene();
    sc.background = new THREE.Color(0x070a12);
    sc.fog = new THREE.Fog(0x070a12, 16, 34);
    sc.add(new THREE.HemisphereLight(0xffffff, 0x2a2c3a, 1.6));
    const key = new THREE.DirectionalLight(0xfff1dc, 1.6);
    key.position.set(3, 8, 12);
    sc.add(key);
    const aspect = depth.width / depth.height;
    let W = 9, H = W / aspect;
    if (H > 6.5) { H = 6.5; W = H * aspect; }
    const D = Math.min(W, H) * 0.45;
    const segX = 240, segY = Math.max(8, Math.round(segX / aspect));
    const geo = new THREE.PlaneGeometry(W, H, segX, segY);
    // Light blur of the depth so edges stretch smoothly instead of tearing.
    const { data, width: dw, height: dh, channels: ch } = depth;
    const at = (cx, cy) => data[(Math.min(dh - 1, Math.max(0, cy)) * dw + Math.min(dw - 1, Math.max(0, cx))) * ch] / 255;
    const pos = geo.attributes.position;
    const r = Math.max(1, Math.round(dw / segX));
    for (let i = 0; i < pos.count; i++) {
      const u = pos.getX(i) / W + 0.5, v = 0.5 - pos.getY(i) / H;
      const cx = Math.round(u * (dw - 1)), cy = Math.round(v * (dh - 1));
      let sum = 0, n = 0;
      for (let oy = -r; oy <= r; oy += r) for (let ox = -r; ox <= r; ox += r) { sum += at(cx + ox, cy + oy); n++; }
      pos.setZ(i, (sum / n) * D);
    }
    geo.computeVertexNormals();
    const relief = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
    relief.position.y = H / 2 + 0.05;
    sc.add(relief);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(18, 48), new THREE.MeshLambertMaterial({ color: 0x141826 }));
    floor.rotation.x = -Math.PI / 2;
    sc.add(floor);
    // Drifting specks of light, for the feeling of being inside a memory.
    const N = 500, pp = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { pp[i * 3] = (Math.random() - 0.5) * W * 1.6; pp[i * 3 + 1] = Math.random() * H * 1.3; pp[i * 3 + 2] = Math.random() * (D + 9); }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(pp, 3));
    const specks = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0xffe2a0, size: 0.05, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
    specks.userData.spin = true;
    sc.add(specks);
    const cap = textSprite([place, viewingDate].filter(Boolean).join(' · ') || 'זיכרון', { size: 56, scale: 1.6 });
    cap.position.set(0, H + 0.9, D * 0.3);
    sc.add(cap);
    dio.depth = D;
    dio.w = W;
    return sc;
  }
  let viewingDate = '';
  async function enterPhoto(p) {
    if (dio.busy || mode === 'photo') return;
    dio.busy = true;
    closePhoto();
    viewingDate = p.date ? dateFmt.format(p.date) : '';
    try {
      status('🔮 מכינים את התמונה…');
      const [depth, tex] = await Promise.all([
        depthOf(p, (f) => status(f >= 0.999 ? '🔮 מחשבים את העומק של התמונה…' : `🔮 טוען את מודל העומק (פעם אחת בלבד)… ${Math.round(f * 100)}%`)).then((d) => (status('🔮 בונים את התמונה בתלת-ממד…'), d)),
        texOf(p.full),
      ]);
      if (!running) return;
      if (dio.scene && dio.photo !== p) dio.scene.traverse((o) => { o.geometry?.dispose(); o.material?.map?.dispose?.(); o.material?.dispose?.(); });
      if (dio.photo !== p) { dio.scene = buildDiorama(depth, tex); dio.photo = p; }
      status('');
      fadeSwap(() => {
        dio.back = { mode, scene, pos: player.position.clone(), rot: player.rotation.y, yaw, pitch };
        mode = 'photo';
        scene = dio.scene;
        scene.add(player);
        // Portrait screens see less width: stand further back so the whole picture fits.
        player.position.set(0, 0, dio.depth + (root.clientHeight > root.clientWidth ? 6 : 3.2));
        player.rotation.y = Math.PI;
        yaw = 0;
        pitch = 0.12;
        vel.set(0, 0);
        $('.st-radar').hidden = true;
        $('[data-act="leave-photo"]').hidden = false;
        $('[data-act="exit"]').hidden = true;
        showToast('🔮 אתם בתוך התמונה. הסתובבו כדי לראות את העומק');
      });
    } catch (e) {
      console.warn('depth failed', e);
      status('');
      showToast('לא הצלחנו להיכנס לתמונה הפעם. נסו שוב.');
    } finally {
      dio.busy = false;
    }
  }
  function leavePhoto() {
    if (mode !== 'photo' || !dio.back) return;
    const b = dio.back;
    fadeSwap(() => {
      mode = b.mode;
      scene = b.scene;
      scene.add(player);
      player.position.copy(b.pos);
      player.rotation.y = b.rot;
      yaw = b.yaw;
      pitch = b.pitch;
      vel.set(0, 0);
      $('.st-radar').hidden = mode !== 'street';
      $('[data-act="leave-photo"]').hidden = true;
      $('[data-act="exit"]').hidden = false;
    });
  }
  // The root element outlives each scene (a new place or type reuses it), so this listener is
  // removed in stop(); otherwise an old scene's buttons would keep firing.
  const onRootClick = (e) => {
    if (!running) return;
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'close-photo') closePhoto();
    if (act === 'next') albumStep(1);
    if (act === 'nav-mode') setNav(nav === 'album' ? 'game' : 'album');
    if (act === 'pick-nav') { $('.st-choose').hidden = true; setNav(e.target.closest('[data-nav]').dataset.nav, true); }
    if (act === 'thumb') goToStop(Number(e.target.closest('[data-i]').dataset.i));
    if (act === 'prev') albumStep(-1);
    if (act === 'type') {
      const menu = $('.st-types');
      if (!menu.hidden) { menu.hidden = true; return; }
      menu.replaceChildren(...[['', '✨ זיהוי אוטומטי'], ...Object.entries(TYPES).map(([k, v]) => [k, `${v.icon} ${v.label}`])].map(([k, label]) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'st-btn' + ((k || null) === (autoType ? null : type) ? ' gold' : '');
        b.dataset.act = 'set-type';
        b.dataset.type = k;
        b.textContent = label;
        return b;
      }));
      menu.hidden = false;
    }
    if (act === 'set-type') {
      $('.st-types').hidden = true;
      const t = e.target.closest('[data-type]').dataset.type || null;
      if (onTypeChange && t !== (autoType ? null : type)) { stop({ quiet: true }); onTypeChange(t); }
    }
    if (act === 'enter-photo' && viewing) enterPhoto(viewing);
    if (act === 'leave-photo') leavePhoto();
    if (act === 'exit') stop();
  };
  root.addEventListener('click', onRootClick);
  $('.st-photo').addEventListener('click', (e) => { if (e.target === $('.st-photo')) closePhoto(); });

  setTimeout(() => populate(), 1200);

  // ----- Album mode: "next" walks you to each photo in turn, then on to the next place -----
  // Street photos first (in date order), then, behind a door, the wall photos not already seen.
  const stops = [];
  const standFrom = (fx, fz, nx, nz, ok, dists) => {
    for (const d of dists) for (const side of [0, 0.8, -0.8, 1.6, -1.6]) {
      const x = fx + nx * d - nz * side, z = fz + nz * d + nx * side;
      if (ok(x, z)) return [x, z];
    }
    return [fx + nx * dists[0], fz + nz * dists[0]];
  };
  for (const m of memories) {
    const nx = Math.sin(m.rot), nz = Math.cos(m.rot);
    const [sx, sz] = standFrom(m.x, m.z, nx, nz, (x, z) => !blockedAt(x, z), [3.2, 2.6, 4, 4.8]);
    stops.push({ scene: 'street', photo: m.photo, fx: m.x, fz: m.z, sx, sz });
  }
  if (CFG.door) {
    const seen = new Set(memories.map((m) => m.photo));
    for (const h of hallStops) {
      if (seen.has(h.photo)) continue;
      const [sx, sz] = standFrom(h.fx, h.fz, h.nx, h.nz, (x, z) => !hallBlocked(x, z), [2.6, 2.1, 3.2, 3.8]);
      stops.push({ ...h, sx, sz });
    }
  }
  let stopIdx = -1;
  let auto = null; // { pts, i, done } while walking to a photo by itself
  let yawGoal = null;
  const updateAlbum = () => {
    $('.st-album-count').textContent = stops.length ? `${Math.max(0, stopIdx + 1)} / ${stops.length}` : '';
    root.querySelectorAll('.st-thumb').forEach((t, i) => t.classList.toggle('on', i === stopIdx));
    root.querySelector('.st-thumb.on')?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    const last = stopIdx >= stops.length - 1;
    const label = !last ? 'הבא ›' : neighbors.next ? `${neighbors.next.label} ›` : 'סוף האלבום';
    root.querySelectorAll('[data-act="next"]').forEach((b) => { b.textContent = label; b.disabled = last && !neighbors.next; });
    root.querySelectorAll('[data-act="prev"]').forEach((b) => { b.disabled = stopIdx <= 0 && !neighbors.prev; });
  };
  // Navigation mode: 'album' (photos one after another, no walking HUD) or 'game' (walk and explore).
  const NAV_KEY = 'livealbum.nav';
  let nav = (() => { try { return localStorage.getItem(NAV_KEY); } catch { return null; } })();
  const firstTime = !nav;
  if (!nav) nav = 'album';
  function setNav(m, start = false) {
    nav = m;
    try { localStorage.setItem(NAV_KEY, m); } catch { /* private mode */ }
    root.classList.toggle('nav-album', m === 'album');
    $('[data-act="nav-mode"]').textContent = m === 'album' ? '🎮 מצב משחק' : '📖 מצב אלבום';
    $('.st-strip').hidden = m !== 'album' || !stops.length;
    chevrons.visible = m !== 'album';
    for (const mm of memories) mm.beam.visible = m !== 'album' && !mm.found;
    if (m === 'album' && (start || stopIdx < 0) && intro >= 1 && stops.length) goToStop(Math.max(0, stopIdx));
  }
  // Thumbnails of every stop, to jump straight to any photo.
  $('.st-strip').replaceChildren(...stops.map((st, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'st-thumb';
    b.dataset.act = 'thumb';
    b.dataset.i = i;
    b.title = st.photo.place || '';
    const im = document.createElement('img');
    im.src = st.photo.thumb;
    im.alt = '';
    im.crossOrigin = 'anonymous';
    b.append(im);
    if (st.photo.video) { const v = document.createElement('span'); v.textContent = '▶'; b.append(v); }
    return b;
  }));
  // Swipe the open photo sideways to move on (right = next, as pages turn in Hebrew).
  {
    let sw = null;
    const fig = $('.st-photo figure');
    fig.addEventListener('pointerdown', (e) => { sw = { x: e.clientX, y: e.clientY, t: performance.now() }; });
    fig.addEventListener('pointerup', (e) => {
      if (!sw) return;
      const dx = e.clientX - sw.x, dy = e.clientY - sw.y, quick = performance.now() - sw.t < 700;
      sw = null;
      if (quick && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) albumStep(dx > 0 ? 1 : -1);
    });
    fig.style.touchAction = 'pan-y';
  }
  function arriveAt(st) {
    auto = null;
    vel.set(0, 0);
    yawGoal = Math.atan2(player.position.x - st.fx, player.position.z - st.fz);
    player.rotation.y = yawGoal + Math.PI;
    const i = stopIdx;
    setTimeout(() => { if (running && stopIdx === i && !viewing) openPhoto(st.photo); }, 550);
  }
  function goToStop(i) {
    const st = stops[i];
    if (!st) return;
    stopIdx = i;
    updateAlbum();
    closePhoto();
    const place = () => {
      if (st.scene === 'hall' && mode !== 'hall') goHall();
      if (st.scene === 'street' && mode !== 'street') goStreet();
      player.position.set(st.sx, 0, st.sz);
      yaw = Math.atan2(st.sx - st.fx, st.sz - st.fz);
    };
    const jump = () => { fadeSwap(place); setTimeout(() => { if (stopIdx === i) arriveAt(st); }, 700); };
    if (mode === 'photo') { leavePhoto(); setTimeout(() => goToStop(i), 800); return; }
    if (st.scene !== mode) return jump();
    const d = Math.hypot(st.sx - player.position.x, st.sz - player.position.z);
    if (d < 0.6) return arriveAt(st);
    let pts = mode === 'street' ? grid.path(player.position.x, player.position.z, st.sx, st.sz) : [[player.position.x, player.position.z], [st.sx, st.sz]];
    if (pts) pts = [[player.position.x, player.position.z], ...pts.slice(1), [st.sx, st.sz]];
    const len = pts ? pts.reduce((s2, p, k) => (k ? s2 + Math.hypot(p[0] - pts[k - 1][0], p[1] - pts[k - 1][1]) : 0), 0) : Infinity;
    if (!pts || len > 36) return jump(); // far away: a quick fade instead of a long walk (≤ 4 s)
    auto = { pts, i: 1, st };
  }
  function albumStep(dir) {
    if (intro < 1) { introSpeed = 3.5; return; }
    const n = stopIdx + dir;
    if (n >= 0 && n < stops.length) return goToStop(n);
    const nb = dir > 0 ? neighbors.next : neighbors.prev;
    if (nb && onPlace) {
      closePhoto();
      showToast(`✈️ ממשיכים: ${nb.label}`, 2000);
      setTimeout(() => { stop({ quiet: true }); onPlace(dir); }, 900);
    } else if (dir > 0) {
      closePhoto();
      showToast('🎉 זה סוף האלבום', 3000);
    }
  }
  updateAlbum();

  // ----- Loop -----
  const resize = () => {
    const w = root.clientWidth, h = root.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  resize();

  let near = null;
  let running = true;
  let last = performance.now();
  const camPos = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  const orbit = new THREE.Vector3();
  const INTRO_S = 3.2;
  let intro = 0;
  const introAng0 = Math.atan2(out.x, out.y);
  let introSpeed = 1;
  const skipIntro = () => { if (intro > 0 && intro < 1) introSpeed = 3.5; }; // speed up, don't cut
  // Frame positions per scene, worked out once (frames never move).
  const frameCache = new Map();
  const pickFrames = () => {
    let c = frameCache.get(scene);
    if (!c || c.n !== pickables.length) {
      const list = pickables.filter((m) => m.geometry.type === 'PlaneGeometry' && isIn(m, scene)).map((m) => { m.getWorldPosition(tmp); return { x: tmp.x, z: tmp.z, photo: m.userData.photo }; });
      c = { n: pickables.length, list };
      frameCache.set(scene, c);
    }
    return c.list;
  };
  const vel = new THREE.Vector2();
  const lookAt = new THREE.Vector3();
  const head = new THREE.Vector3();
  const dir = new THREE.Vector3();
  let camPitchUsed = 0.32, camDistUsed = 7;
  // Where the follow camera wants to be right now (also used to place it instantly after a fade).
  function followPos() {
    head.copy(player.position).y += 1.6;
    const camBad = (p) => mode === 'photo' ? p.y < 0.3 || p.z < dio.depth + 0.4 : mode === 'street'
      ? nearbyHit(p.x, p.z, 0.3, (b) => p.y < b.h + 0.6 && (inPoly(p.x, p.z, b.pts) || closestOnPoly(p.x, p.z, b.pts).d < 0.3))
      : Math.abs(p.x) > HW - 0.3 || Math.abs(p.z) > HD - 0.3 || p.y > HH - 0.3;
    const clearPath = (d) => { for (let t = 0.35; t <= 1.001; t += 0.13) { tmp.copy(head).addScaledVector(dir, d * t); if (camBad(tmp)) return false; } return true; };
    // In narrow streets, rise above the roofs before pulling in close (as street games do).
    for (let pt = pitch; pt <= 1.45; pt += 0.15) {
      dir.set(Math.sin(yaw) * Math.cos(pt), Math.sin(pt), Math.cos(yaw) * Math.cos(pt));
      const far = mode === 'street' && pt > 0.85 ? Math.max(camDist, 18) : camDist;
      for (let d = far; d >= Math.min(camDist, 3); d -= 1) if (clearPath(d)) { camPitchUsed = pt; camDistUsed = d; return new THREE.Vector3().copy(head).addScaledVector(dir, d); }
    }
    dir.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    let d = camDist;
    while (d > 1.2 && !clearPath(d)) d -= 0.4;
    camPitchUsed = pitch; camDistUsed = d;
    return new THREE.Vector3().copy(head).addScaledVector(dir, d);
  }

  function step(now) {
    if (!running) return;
    requestAnimationFrame(step);
    const t0 = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    cooldown = Math.max(0, cooldown - dt);

    // Movement relative to the camera.
    let ix = 0, iz = 0;
    if (!viewing) {
      if (keys.has('KeyW') || keys.has('ArrowUp')) iz -= 1;
      if (keys.has('KeyS') || keys.has('ArrowDown')) iz += 1;
      if (keys.has('KeyA') || keys.has('ArrowLeft')) ix -= 1;
      if (keys.has('KeyD') || keys.has('ArrowRight')) ix += 1;
      // Joystick: ignore the first 12% of travel, then a soft curve for fine control.
      const jm = Math.hypot(joy.x, joy.y);
      if (jm > 0.12) { const k = Math.pow((jm - 0.12) / 0.88, 1.3) / jm; ix += joy.x * k; iz += joy.y * k; }
    }
    if (intro < 1 || fading) ix = iz = 0;
    if (auto && Math.hypot(ix, iz) > 0.05) auto = null; // walking yourself takes over
    if (auto) {
      // Walk the path at a steady pace; the camera swings round behind.
      const [tx, tz] = auto.pts[auto.i];
      let dx = tx - player.position.x, dz = tz - player.position.z;
      const dd = Math.hypot(dx, dz), sp = 9;
      if (dd < sp * dt + 0.05) {
        player.position.set(tx, 0, tz);
        if (++auto.i >= auto.pts.length) arriveAt(auto.st);
      } else {
        dx /= dd; dz /= dd;
        vel.set(dx * sp, dz * sp);
        player.position.x += dx * sp * dt;
        player.position.z += dz * sp * dt;
        let rd = Math.atan2(dx, dz) - player.rotation.y;
        rd = Math.atan2(Math.sin(rd), Math.cos(rd));
        player.rotation.y += rd * (1 - Math.exp(-dt * 10));
        yawGoal = Math.atan2(-dx, -dz);
      }
    }
    if (yawGoal != null) {
      let yd = yawGoal - yaw;
      yd = Math.atan2(Math.sin(yd), Math.cos(yd));
      yaw += yd * (1 - Math.exp(-dt * 3.5));
      if (!auto && Math.abs(yd) < 0.01) yawGoal = null;
    }
    const mag = Math.min(1, Math.hypot(ix, iz));
    const run = keys.has('ShiftLeft') || keys.has('ShiftRight') || Math.hypot(joy.x, joy.y) > 0.92;
    // Desired velocity on the ground, reached with a short acceleration so starts and stops ease.
    let wx = 0, wz = 0;
    if (mag > 0.02) {
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw); // camera forward on the ground
      const rx = -fz, rz = fx;
      const top = mag * (run ? 8.5 : 4.2);
      wx = ((rx * ix - fx * iz) / Math.hypot(ix, iz)) * top;
      wz = ((rz * ix - fz * iz) / Math.hypot(ix, iz)) * top;
    }
    const acc = 1 - Math.exp(-dt * (mag > 0.02 ? 9 : 12));
    if (!auto) { vel.x += (wx - vel.x) * acc; vel.y += (wz - vel.y) * acc; }
    const speed = Math.hypot(vel.x, vel.y);
    if (auto) { /* moved above */ } else if (speed > 0.03) {
      const nx = player.position.x + vel.x * dt, nz = player.position.z + vel.y * dt;
      const hit = mode === 'street' ? blockedAt : mode === 'hall' ? hallBlocked : photoBlocked;
      if (!hit(nx, nz)) player.position.set(nx, 0, nz);
      else if (!hit(nx, player.position.z)) { player.position.x = nx; vel.y *= 0.5; }
      else if (!hit(player.position.x, nz)) { player.position.z = nz; vel.x *= 0.5; }
      else vel.set(0, 0);
      if (speed > 0.4) {
        let d = Math.atan2(vel.x, vel.y) - player.rotation.y;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        player.rotation.y += d * (1 - Math.exp(-dt * 10));
      }
    } else vel.set(0, 0);
    animateCharacter(player, speed, dt);
    if (mode === 'street') dressing.update(dt, player.position);
    // Play the three nearest video frames in view range; pause the rest to spare the device.
    if (videoFrames.length && now - (step.vidAt || 0) > 500) {
      step.vidAt = now;
      const ranked = videoFrames
        .map((v) => { v.group.getWorldPosition(tmp); return { v, d: isIn(v.group, scene) && !viewing ? tmp.distanceTo(player.position) : Infinity }; })
        .sort((a, b) => a.d - b.d);
      const play = new Set(ranked.filter((r) => r.d < 16).slice(0, isPhone ? 2 : 3).map((r) => r.v.video));
      for (const e of videoShared.values()) {
        if (play.has(e)) { if (e.video.paused) e.video.play().catch(() => {}); }
        else if (!e.video.paused) e.video.pause();
      }
    }
    for (const e of videoShared.values()) e.draw(now);
    if (mode === 'photo') scene.traverse((o) => { if (o.userData.spin) o.rotation.y = Math.sin(now / 6000) * 0.05; });
    for (const st of standees) {
      if (st.userData.grow < 1) { st.userData.grow = Math.min(1, st.userData.grow + dt * 1.8); const k = st.userData.grow; st.scale.setScalar(k < 1 ? 1 - Math.pow(1 - k, 3) * (1 - 0.01) : 1); }
      if (st.parent !== scene) continue;
      const want = Math.atan2(camera.position.x - st.position.x, camera.position.z - st.position.z);
      let d = want - st.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      st.rotation.y += d * Math.min(1, dt * 5);
    }

    // Memories: found by walking up to them; the route then leads to the next one, then the door.
    if (mode === 'street') {
      for (const m of memories) {
        if (!m.found && intro >= 1 && Math.hypot(m.x - player.position.x, m.z - player.position.z) < 4) markFound(m);
        if (!m.found) m.beam.material.opacity = 0.16 + 0.1 * Math.sin(now / 400 + m.x);
      }
      const t = target();
      if (!t) route = null;
      else if (now - routeAt > 500 && (player.position.distanceTo(routeFrom) > 1.5 || now - routeAt > 3000)) {
        route = grid.path(player.position.x, player.position.z, t.x, t.z);
        routeAt = now;
        routeFrom.copy(player.position);
      }
      // Chevrons every 2.2 m along the route, drifting forward.
      let n = 0;
      if (route && t && Math.hypot(t.x - player.position.x, t.z - player.position.z) > 3) {
        const pts = [[player.position.x, player.position.z], ...route.slice(1)];
        let carry = 1.6 + ((now / 900) % 1) * 2.2;
        for (let q = 0; q < pts.length - 1 && n < MAXCHEV; q++) {
          const [ax, az] = pts[q], [bx, bz] = pts[q + 1];
          const len = Math.hypot(bx - ax, bz - az);
          const ang = Math.atan2(bx - ax, bz - az);
          for (; carry < len && n < MAXCHEV; carry += 2.2) {
            dummy.position.set(ax + ((bx - ax) * carry) / len, 0.06, az + ((bz - az) * carry) / len);
            dummy.rotation.set(0, ang + Math.PI, 0);
            dummy.scale.setScalar(1);
            dummy.updateMatrix();
            chevrons.setMatrixAt(n++, dummy.matrix);
          }
          carry -= len;
        }
      }
      chevrons.count = n;
      chevrons.instanceMatrix.needsUpdate = true;
      chevMat.opacity = 0.65 + 0.3 * Math.sin(now / 250);
      if (mapBig || (step.mapTick = (step.mapTick || 0) + 1) % 2 === 0) drawMap({ x: player.position.x, z: player.position.z, yaw, route, memories, door: CFG.door ? { x: markerPos.x, z: markerPos.z } : null, scale: mapBig ? 0.5 : 1.25 });
    }

    // Doors.
    if (cooldown === 0) {
      if (mode === 'street' && CFG.door && Math.hypot(player.position.x - markerPos.x, player.position.z - markerPos.z) < 1.1) fadeSwap(() => { goHall(); vel.set(0, 0); });
      else if (mode === 'hall' && Math.hypot(player.position.x - exitPos.x, player.position.z - exitPos.z) < 1.0) fadeSwap(() => { goStreet(); vel.set(0, 0); });
    }
    marker.material.opacity = 0.25 + 0.15 * Math.sin(now / 300);
    marker.rotation.y += dt;

    // Nearest photo for the prompt.
    near = null;
    let nd = 3.6;
    for (const f of pickFrames()) {
      const d = Math.hypot(f.x - player.position.x, f.z - player.position.z);
      if (d < nd) { nd = d; near = f.photo; }
    }
    const prompt = $('.st-prompt');
    const doorDist = mode === 'street' && CFG.door ? Math.hypot(player.position.x - markerPos.x, player.position.z - markerPos.z) : Infinity;
    if (near && !viewing && mode !== 'photo') { prompt.textContent = isTouch ? '📸 הקישו על התמונה להגדלה ולכניסה אליה' : '📸 E להגדלה · Q כדי להיכנס לתמונה'; prompt.hidden = false; }
    else if (doorDist < 7 && !viewing) { prompt.textContent = `✨ היכנסו לעיגול המואר: ${CFG.door}`; prompt.hidden = false; }
    else prompt.hidden = true;

    // Third-person camera: eased toward where it wants to be, so collision moves never snap.
    camPos.copy(followPos());
    const headNow = tmp2.copy(player.position); headNow.y += 1.6;
    if (intro < 1) {
      // Opening shot: circle down from above the venue to behind the visitor.
      intro = Math.min(1, intro + (dt * introSpeed) / INTRO_S);
      const e = intro < 0.5 ? 4 * intro ** 3 : 1 - Math.pow(-2 * intro + 2, 3) / 2;
      const ang = introAng0 + (1 - e) * Math.PI * 0.9;
      const r = 34 * (1 - e) + 8 * e, h = 42 * (1 - e) + 4 * e;
      orbit.set(door.x + Math.sin(ang) * r, h, door.z + Math.cos(ang) * r);
      orbit.y = Math.max(orbit.y, roofAt(orbit.x, orbit.z, 3) + 3); // never fly through a building
      camera.position.lerpVectors(orbit, camPos, e * e);
      lookAt.lerpVectors(door, headNow, e);
      $('.st-title').style.opacity = String(Math.max(0, Math.min(1, (0.85 - intro) * 4)));
      if (intro >= 1) {
        $('.st-title').hidden = true;
        root.classList.remove('st-intro');
        if (startAt && stops.length) goToStop(startAt === 'last' ? stops.length - 1 : 0);
        else if (firstTime && stops.length) $('.st-choose').hidden = false;
        else if (nav === 'album' && stops.length) goToStop(0);
      }
    } else {
      camera.position.lerp(camPos, 1 - Math.exp(-dt * 7));
      lookAt.lerp(headNow, 1 - Math.exp(-dt * 14));
    }
    camera.lookAt(lookAt);

    if (mode === 'street' && renderer.shadowMap.enabled) {
      sun.position.set(player.position.x - 60, 120, player.position.z + 40);
      sun.target.position.copy(player.position);
    }
    perf.logic = perf.logic * 0.95 + (performance.now() - t0) * 0.05;
    renderer.render(scene, camera);

    // Keep the frame rate up: lower the render resolution on struggling devices, raise it back when there's headroom.
    perf.t += dt; perf.n++;
    if (perf.t > 1.5) {
      const ms = (perf.t / perf.n) * 1000;
      const pr = renderer.getPixelRatio();
      if (ms > 26 && pr > 0.75) { renderer.setPixelRatio(Math.max(0.75, pr - 0.25)); resize(); }
      else if (ms < 15 && pr < maxPR) { renderer.setPixelRatio(Math.min(maxPR, pr + 0.25)); resize(); }
      perf.t = 0; perf.n = 0;
    }
  }
  const perf = { t: 0, n: 0, logic: 0 };

  function stop({ quiet = false } = {}) {
    if (!running) return;
    running = false;
    root.removeEventListener('click', onRootClick);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('keyup', onKey);
    window.removeEventListener('resize', resize);
    for (const sc of [street, hall]) {
      sc.traverse((o) => {
        o.geometry?.dispose();
        const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        mats.forEach((m) => { m.map?.dispose(); m.dispose(); });
      });
    }
    for (const { video } of videoShared.values()) { video.pause(); video.removeAttribute('src'); video.load(); }
    renderer.dispose();
    root.innerHTML = '';
    if (!quiet) onExit?.();
  }

  camera.position.set(door.x + Math.sin(introAng0 + Math.PI * 0.9) * 34, 42, door.z + Math.cos(introAng0 + Math.PI * 0.9) * 34);
  lookAt.copy(door);
  $('.st-title b').textContent = venue?.name || place || '';
  $('.st-title span').textContent = photos[0]?.date ? dateFmt.format(photos[0].date) : '';
  intro = 0.0001;
  setNav(nav); // after `intro` exists: applies the mode's HUD
  root.classList.add('st-intro');
  $('.st-loading').classList.add('done');
  requestAnimationFrame(step);
  return { stop, type, debug: { get logicMs() { return perf.logic; }, get pixelRatio() { return renderer.getPixelRatio(); }, player, camera, solids, dressing, venue, memories, standees, videoFrames, get mode() { return mode; }, markerPos, door, out } };
}
