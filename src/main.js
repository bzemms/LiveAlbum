import Globe from 'globe.gl';
import './style.css';
import { readPhoto, placeName } from './photos.js';
import { demoAlbum } from './demo.js';

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dateFmt = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'long', year: 'numeric' });

const state = {
  photos: [], // sorted by date
  isDemo: true,
  current: -1,
  touring: null, // { cancelled: boolean }
};

// ---------- Globe ----------
const globe = new Globe($('globe'), { animateIn: true })
  .backgroundImageUrl('/night-sky.png')
  .globeImageUrl('/earth-blue-marble.jpg')
  .bumpImageUrl('/earth-topology.png')
  .globeTileEngineUrl((x, y, l) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${l}/${y}/${x}`)
  .globeTileEngineMaxLevel(17)
  .showAtmosphere(true)
  .atmosphereColor('#7cc4ff')
  .atmosphereAltitude(0.18)
  .htmlLat('lat')
  .htmlLng('lng')
  .htmlAltitude(0.005)
  .htmlElement(markerFor)
  .arcStartLat((d) => d.a.lat).arcStartLng((d) => d.a.lng).arcEndLat((d) => d.b.lat).arcEndLng((d) => d.b.lng)
  .arcColor(() => ['rgba(255,214,120,0.15)', 'rgba(255,214,120,0.95)'])
  .arcStroke(null)
  .arcAltitudeAutoScale(0.35)
  .arcDashLength(0.5)
  .arcDashGap(0.15)
  .arcDashAnimateTime(2600);

globe.controls().autoRotate = true;
globe.controls().autoRotateSpeed = 0.35;
globe.controls().enableDamping = true;
const stopSpin = () => (globe.controls().autoRotate = false);
$('globe').addEventListener('pointerdown', stopSpin);
$('globe').addEventListener('wheel', stopSpin, { passive: true });

function fit() {
  globe.width(window.innerWidth).height(window.innerHeight);
}
window.addEventListener('resize', fit);
fit();

// Photos taken within ~1 km of each other share one marker.
const keyOf = (p) => `${p.lat.toFixed(2)},${p.lng.toFixed(2)}`;

function markerFor(group) {
  // globe.gl positions the returned element with its own transform, so style an inner button.
  const wrap = document.createElement('div');
  wrap.className = 'marker-anchor';
  const el = document.createElement('button');
  el.className = 'marker';
  wrap.append(el);
  el.setAttribute('aria-label', group.photos[0].place || group.photos[0].name);
  const img = document.createElement('img');
  img.src = group.photos[0].thumb;
  img.alt = '';
  el.append(img);
  if (group.photos.length > 1) {
    const n = document.createElement('span');
    n.className = 'count';
    n.textContent = group.photos.length;
    el.append(n);
  }
  wrap.style.pointerEvents = 'auto';
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    stopTour();
    open(state.photos.indexOf(group.photos[0]), { fly: true });
  });
  return wrap;
}

function refreshGlobe() {
  const located = state.photos.filter((p) => p.lat != null);
  const groups = new Map();
  for (const p of located) {
    const k = keyOf(p);
    if (!groups.has(k)) groups.set(k, { lat: p.lat, lng: p.lng, photos: [] });
    groups.get(k).photos.push(p);
  }
  globe.htmlElementsData([...groups.values()]);
  const arcs = [];
  for (let i = 1; i < located.length; i++) {
    if (keyOf(located[i]) !== keyOf(located[i - 1])) arcs.push({ a: located[i - 1], b: located[i] });
  }
  globe.arcsData(arcs);
}

function overview(ms = 1800) {
  const located = state.photos.filter((p) => p.lat != null);
  if (!located.length) return globe.pointOfView({ lat: 30, lng: 20, altitude: 2.4 }, ms);
  // Average on the unit sphere so groups that straddle the date line still center sensibly.
  let x = 0, y = 0, z = 0;
  for (const p of located) {
    const la = (p.lat * Math.PI) / 180, lo = (p.lng * Math.PI) / 180;
    x += Math.cos(la) * Math.cos(lo); y += Math.cos(la) * Math.sin(lo); z += Math.sin(la);
  }
  const lat = (Math.atan2(z, Math.hypot(x, y)) * 180) / Math.PI;
  const lng = (Math.atan2(y, x) * 180) / Math.PI;
  globe.pointOfView({ lat, lng, altitude: 2.2 }, ms);
}

// ---------- Panel / timeline ----------
function renderTimeline() {
  const list = $('timeline');
  list.replaceChildren();
  let year = null;
  state.photos.forEach((p, i) => {
    const y = p.date ? p.date.getFullYear() : 'ללא תאריך';
    if (y !== year) {
      year = y;
      const h = document.createElement('li');
      h.className = 'year';
      h.textContent = y;
      list.append(h);
    }
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.className = 'item' + (i === state.current ? ' active' : '') + (p.lat == null ? ' no-gps' : '');
    b.dataset.index = i;
    const img = document.createElement('img');
    img.src = p.thumb; img.alt = ''; img.loading = 'lazy';
    const t = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = p.place || (p.lat == null ? 'ללא מיקום' : p.name);
    const d = document.createElement('div');
    d.className = 'date';
    d.textContent = p.date ? dateFmt.format(p.date) : '';
    t.append(name, d);
    b.append(img, t);
    b.addEventListener('click', () => { stopTour(); open(i, { fly: true }); });
    li.append(b);
    list.append(li);
  });

  const located = state.photos.filter((p) => p.lat != null);
  const places = new Set(located.map(keyOf)).size;
  const years = state.photos.filter((p) => p.date).map((p) => p.date.getFullYear());
  const span = years.length ? (Math.min(...years) === Math.max(...years) ? `${years[0]}` : `${Math.min(...years)}–${Math.max(...years)}`) : '';
  $('album-sub').textContent = [`${state.photos.length} תמונות`, `${places} מקומות`, span].filter(Boolean).join(' · ');

  const missing = state.photos.length - located.length;
  $('no-loc').hidden = !missing;
  $('no-loc').textContent = missing ? `${missing} תמונות בלי מיקום מופיעות ברשימה אבל לא על הגלובוס. בהמשך נוכל למקם אותן ידנית.` : '';
  $('tour-btn').disabled = located.length === 0;
}

function highlight() {
  document.querySelectorAll('.item').forEach((b) => b.classList.toggle('active', Number(b.dataset.index) === state.current));
  const a = document.querySelector('.item.active');
  a?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// ---------- Viewer ----------
function open(i, { fly = false } = {}) {
  const p = state.photos[i];
  if (!p) return;
  state.current = i;
  $('viewer-img').src = p.full;
  $('viewer-img').alt = p.place || p.name;
  $('viewer-place').textContent = p.place || (p.lat == null ? 'ללא מיקום' : p.name);
  $('viewer-date').textContent = p.date ? dateFmt.format(p.date) : '';
  $('v-count').textContent = `${i + 1} / ${state.photos.length}`;
  $('viewer').hidden = false;
  highlight();
  if (fly && p.lat != null) {
    stopSpin();
    globe.pointOfView({ lat: p.lat, lng: p.lng, altitude: 0.3 }, 1600);
  }
}
function close() {
  $('viewer').hidden = true;
  state.current = -1;
  highlight();
}
$('v-close').addEventListener('click', () => { stopTour(); close(); });
$('v-next').addEventListener('click', () => { stopTour(); open(Math.min(state.photos.length - 1, state.current + 1), { fly: true }); });
$('v-prev').addEventListener('click', () => { stopTour(); open(Math.max(0, state.current - 1), { fly: true }); });
window.addEventListener('keydown', (e) => {
  if ($('viewer').hidden) return;
  if (e.key === 'Escape') { stopTour(); close(); }
  // RTL: left arrow moves forward in time.
  if (e.key === 'ArrowLeft') $('v-next').click();
  if (e.key === 'ArrowRight') $('v-prev').click();
});

// ---------- Journey ----------
async function tour() {
  const run = { cancelled: false };
  state.touring = run;
  stopSpin();
  $('tour-btn').textContent = '■ עצור מסע';
  document.body.classList.add('touring');
  let prevKey = null;
  for (let i = 0; i < state.photos.length && !run.cancelled; i++) {
    const p = state.photos[i];
    if (p.lat == null) continue;
    const k = keyOf(p);
    if (k !== prevKey) {
      $('viewer').hidden = true;
      if (prevKey) {
        // Lift off before flying to the next place, so the hop reads as travel.
        const pov = globe.pointOfView();
        globe.pointOfView({ ...pov, altitude: 1.4 }, 1100);
        await sleep(1100);
        if (run.cancelled) break;
      }
      globe.pointOfView({ lat: p.lat, lng: p.lng, altitude: 0.3 }, 2200);
      await sleep(2300);
      prevKey = k;
    }
    if (run.cancelled) break;
    open(i);
    await sleep(2800);
  }
  if (!run.cancelled) {
    close();
    overview(2500);
  }
  endTour();
}
function endTour() {
  state.touring = null;
  $('tour-btn').textContent = '▶ התחל מסע';
  document.body.classList.remove('touring');
}
function stopTour() {
  if (state.touring) { state.touring.cancelled = true; endTour(); }
}
$('tour-btn').addEventListener('click', () => (state.touring ? stopTour() : (close(), tour())));

// ---------- Adding photos ----------
function toast(msg, ms = 3500) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = !msg;
  clearTimeout(toast.timer);
  if (msg && ms) toast.timer = setTimeout(() => (t.hidden = true), ms);
}

function setPhotos(list) {
  state.photos = list.sort((a, b) => (a.date ?? Infinity) - (b.date ?? Infinity));
  renderTimeline();
  refreshGlobe();
}

async function addFiles(files) {
  const imgs = [...files].filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name));
  if (!imgs.length) return toast('לא נמצאו קבצי תמונה.');
  stopTour();
  close();
  if (state.isDemo) {
    state.isDemo = false;
    state.photos = [];
    $('album-kind').textContent = 'האלבום שלי';
    $('album-title').textContent = 'התמונות שלי';
  }
  const added = [];
  let failed = 0;
  for (let i = 0; i < imgs.length; i++) {
    toast(`קורא תמונות… ${i + 1} מתוך ${imgs.length}`, 0);
    const p = await readPhoto(imgs[i]).catch(() => null);
    if (p) added.push(p); else failed++;
  }
  setPhotos([...state.photos, ...added]);
  overview();
  const located = added.filter((p) => p.lat != null).length;
  toast(
    [`נוספו ${added.length} תמונות, ${located} מהן עם מיקום.`, failed ? `${failed} קבצים לא נקראו.` : ''].filter(Boolean).join(' '),
    6000,
  );
  nameplaces(added);
}

// Fill in place names one place at a time (the public geocoder allows about one request per second).
async function nameplaces(list) {
  const seen = new Map();
  for (const p of list) {
    if (p.lat == null) continue;
    const k = keyOf(p);
    if (!seen.has(k)) {
      seen.set(k, await placeName(p.lat, p.lng));
      await sleep(1100);
    }
    p.place = seen.get(k);
    renderTimeline();
    highlight();
  }
}

$('file-input').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });

let dragDepth = 0;
window.addEventListener('dragenter', (e) => { if (e.dataTransfer?.types?.includes('Files')) { dragDepth++; $('drop').hidden = false; } });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('drop').hidden = true; } });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  $('drop').hidden = true;
  if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
});

// ---------- Panel toggle ----------
$('toggle-panel').addEventListener('click', () => { $('panel').classList.add('collapsed'); $('show-panel').hidden = false; });
$('show-panel').addEventListener('click', () => { $('panel').classList.remove('collapsed'); $('show-panel').hidden = true; });

// ---------- Start ----------
demoAlbum().then((list) => {
  if (!state.isDemo) return;
  setPhotos(list);
  globe.pointOfView({ lat: 38, lng: 20, altitude: 2.6 });
});
