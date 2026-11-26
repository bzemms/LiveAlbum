import Globe from 'globe.gl';
import './style.css';
import { readPhoto, placeName, searchPlaces } from './photos.js';
import { readVideo, isVideoFile } from './video.js';
import * as cloud from './cloud.js';
import { demoAlbum } from './demo.js';

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dateFmt = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'long', year: 'numeric' });

const state = {
  user: null,
  albums: [],
  albumId: null,
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

// On wide screens the globe sits beside the list instead of behind it, so a place
// the camera flies to is never hidden under the panel.
const PANEL_SPACE = 372;
function fit() {
  const beside = window.innerWidth > 760 && !$('panel').classList.contains('collapsed');
  globe.width(window.innerWidth - (beside ? PANEL_SPACE : 0)).height(window.innerHeight);
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
  if (group.photos.some((p) => p.video)) { const v = document.createElement('span'); v.className = 'vid-dot'; v.textContent = '▶'; el.append(v); }
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
    if (p.video) { const badge = document.createElement('span'); badge.className = 'vid-badge'; badge.textContent = '▶'; b.append(badge); }
    b.addEventListener('click', () => { stopTour(); open(i, { fly: true }); });
    li.append(b);
    list.append(li);
  });

  if (!state.photos.length) {
    const li = document.createElement('li');
    li.className = 'empty-hint';
    li.textContent = 'האלבום ריק. הוסיפו תמונות וסרטונים, והם יישמרו כאן בענן.';
    list.append(li);
  }
  const located = state.photos.filter((p) => p.lat != null);
  const places = new Set(located.map(keyOf)).size;
  const years = state.photos.filter((p) => p.date).map((p) => p.date.getFullYear());
  const span = years.length ? (Math.min(...years) === Math.max(...years) ? `${years[0]}` : `${Math.min(...years)}–${Math.max(...years)}`) : '';
  $('album-sub').textContent = [`${state.photos.length} תמונות`, `${places} מקומות`, span].filter(Boolean).join(' · ');

  const missing = state.photos.length - located.length;
  $('no-loc').hidden = !missing;
  $('no-loc-text').textContent = missing === 1 ? 'תמונה אחת בלי מיקום.' : `${missing} תמונות בלי מיקום.`;
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
  const vid = $('viewer-video');
  if (p.video && p.playable) {
    $('viewer-img').hidden = true;
    vid.hidden = false;
    if (vid.dataset.src !== p.video) { vid.src = p.video; vid.dataset.src = p.video; vid.poster = p.full; }
    vid.muted = !!state.touring; // the journey plays videos silently; opening one yourself plays with sound
    vid.play().catch(() => {});
  } else {
    vid.pause();
    vid.hidden = true;
    $('viewer-img').hidden = false;
    $('viewer-img').src = p.full;
    $('viewer-img').alt = p.place || p.name;
  }
  $('viewer-place').textContent = p.place || (p.lat == null ? 'ללא מיקום' : p.name);
  $('viewer-date').textContent = p.date ? dateFmt.format(p.date) : '';
  $('v-count').textContent = `${i + 1} / ${state.photos.length}`;
  $('v-locate').textContent = p.lat == null ? '📍 הוסף מיקום' : '📍 שנה מיקום';
  $('v-street').hidden = p.lat == null;
  $('viewer').hidden = false;
  highlight();
  if (fly && p.lat != null) {
    stopSpin();
    globe.pointOfView({ lat: p.lat, lng: p.lng, altitude: 0.3 }, 1600);
  }
}
function close() {
  $('viewer-video').pause();
  $('viewer').hidden = true;
  state.current = -1;
  highlight();
}
$('v-close').addEventListener('click', () => { stopTour(); close(); });

// ---------- Down to the street ----------
// The globe is how you travel; the place itself is a 3D street you walk through.
let streetSession = null;
async function goStreet(photo) {
  if (streetSession || photo?.lat == null) return;
  stopTour();
  close();
  stopSpin();
  const group = state.photos.filter((p) => p.lat != null && keyOf(p) === keyOf(photo));
  globe.pointOfView({ lat: photo.lat, lng: photo.lng, altitude: 0.02 }, 2200);
  const modP = import('./street/street.js');
  await sleep(1900);
  $('dive').hidden = false;
  await sleep(450);
  const { enterStreet } = await modP;
  $('street').hidden = false;
  document.body.classList.add('in-street');
  globe.pauseAnimation();
  streetSession = await enterStreet({
    root: $('street'),
    photos: group,
    place: photo.place,
    lat: photo.lat,
    lng: photo.lng,
    onExit: () => {
      streetSession = null;
      // Fade back out to the globe instead of cutting.
      $('dive').classList.remove('out');
      $('dive').hidden = false;
      setTimeout(() => { $('dive').classList.add('out'); setTimeout(() => { $('dive').hidden = true; $('dive').classList.remove('out'); }, 700); }, 60);
      $('street').hidden = true;
      document.body.classList.remove('in-street');
      globe.resumeAnimation();
      globe.pointOfView({ lat: photo.lat, lng: photo.lng, altitude: 0.02 });
      globe.pointOfView({ lat: photo.lat, lng: photo.lng, altitude: 0.5 }, 2000);
    },
  }).catch((e) => {
    console.error(e);
    $('street').hidden = true;
    document.body.classList.remove('in-street');
    globe.resumeAnimation();
    toast('לא הצלחנו לבנות את הרחוב. נסו שוב.');
    return null;
  });
  // Reveal the street with a fade rather than a cut.
  $('dive').classList.add('out');
  setTimeout(() => { $('dive').hidden = true; $('dive').classList.remove('out'); }, 700);
  window.__street = streetSession; // handy for debugging in the console
}
$('v-street').addEventListener('click', () => goStreet(state.photos[state.current]));

// ---------- Placing photos by hand ----------
// Photos shared through chat apps lose their location. Let people search for the place
// or click the exact spot on the globe, for one photo or every photo still missing one.
const locator = { photo: null, results: [], searchTimer: 0 };
const unplaced = () => state.photos.filter((p) => p.lat == null);

function openLocator(photo) {
  stopTour();
  locator.photo = photo;
  const missing = unplaced().filter((p) => p !== photo).length;
  $('loc-all-row').hidden = !(photo && missing);
  $('loc-all').checked = true;
  $('loc-all-label').textContent = `גם ל-${missing} התמונות האחרות בלי מיקום`;
  $('loc-title').textContent = photo ? 'איפה צולמה התמונה?' : `איפה צולמו ${unplaced().length} התמונות?`;
  $('loc-q').value = '';
  $('loc-results').replaceChildren();
  $('locator').hidden = false;
  $('viewer').hidden = true;
  document.body.classList.add('locating');
  $('loc-q').focus();
}
function closeLocator() {
  $('locator').hidden = true;
  document.body.classList.remove('locating');
  locator.photo = null;
}

async function applyLocation(lat, lng, label) {
  const targets = locator.photo
    ? [locator.photo, ...($('loc-all').checked ? unplaced().filter((p) => p !== locator.photo) : [])]
    : unplaced();
  const first = targets[0];
  closeLocator();
  for (const p of targets) { p.lat = lat; p.lng = lng; p.place = label || null; }
  saveLocations(targets, 'manual');
  renderTimeline();
  refreshGlobe();
  stopSpin();
  globe.pointOfView({ lat, lng, altitude: 0.3 }, 1600);
  toast(targets.length === 1 ? 'המיקום נשמר.' : `${targets.length} תמונות מוקמו.`);
  if (first) open(state.photos.indexOf(first));
  if (!label) {
    const name = await placeName(lat, lng);
    for (const p of targets) if (p.lat === lat && p.lng === lng) p.place = name;
    saveLocations(targets.filter((p) => p.lat === lat && p.lng === lng), 'manual');
    renderTimeline();
    highlight();
    if (first && state.current === state.photos.indexOf(first)) $('viewer-place').textContent = name || first.name;
  }
}

function renderResults(list, msg) {
  const box = $('loc-results');
  box.replaceChildren();
  if (msg) {
    const d = document.createElement('div');
    d.className = 'loc-msg';
    d.textContent = msg;
    box.append(d);
  }
  for (const r of list) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'loc-result';
    b.textContent = r.label;
    b.addEventListener('click', () => applyLocation(r.lat, r.lng, r.label));
    box.append(b);
  }
}

async function runSearch() {
  const q = $('loc-q').value.trim();
  if (q.length < 2) return renderResults([]);
  renderResults([], 'מחפש…');
  try {
    const list = await searchPlaces(q);
    if ($('loc-q').value.trim() !== q) return;
    renderResults(list, list.length ? '' : 'לא נמצא. נסו שם של עיר או רחוב, או לחצו על הגלובוס במקום המדויק.');
  } catch {
    renderResults([], 'החיפוש לא זמין כרגע. אפשר ללחוץ על הגלובוס במקום המדויק.');
  }
}
$('loc-q').addEventListener('input', () => {
  clearTimeout(locator.searchTimer);
  locator.searchTimer = setTimeout(runSearch, 600); // the public geocoder allows about one request per second
});
$('loc-form').addEventListener('submit', (e) => { e.preventDefault(); clearTimeout(locator.searchTimer); runSearch(); });
$('loc-cancel').addEventListener('click', () => {
  const p = locator.photo;
  closeLocator();
  if (p) open(state.photos.indexOf(p));
});
$('v-locate').addEventListener('click', () => openLocator(state.photos[state.current]));
$('no-loc-btn').addEventListener('click', () => openLocator(null));
globe.onGlobeClick(({ lat, lng }) => {
  if (!$('locator').hidden) applyLocation(lat, lng, null);
});
$('v-next').addEventListener('click', () => { stopTour(); open(Math.min(state.photos.length - 1, state.current + 1), { fly: true }); });
$('v-prev').addEventListener('click', () => { stopTour(); open(Math.max(0, state.current - 1), { fly: true }); });
window.addEventListener('keydown', (e) => {
  if (!$('locator').hidden) { if (e.key === 'Escape') $('loc-cancel').click(); return; }
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
    // Videos get time to play (up to 8 s); photos a few seconds each.
    await sleep(p.video && p.playable ? Math.min(8000, Math.max(2800, (p.duration || 3) * 1000)) : 2800);
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
  const imgs = [...files].filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name) || isVideoFile(f));
  if (!imgs.length) return toast('לא נמצאו תמונות או סרטונים.');
  stopTour();
  close();
  if (state.isDemo) {
    state.isDemo = false;
    state.photos = [];
    if (!state.albumId) {
      $('album-kind').textContent = 'במכשיר הזה בלבד';
      $('album-title').textContent = 'התמונות שלי';
    }
  }
  const added = [];
  let failed = 0;
  for (let i = 0; i < imgs.length; i++) {
    toast(`קורא קבצים… ${i + 1} מתוך ${imgs.length}`, 0);
    const p = await (isVideoFile(imgs[i]) ? readVideo(imgs[i]) : readPhoto(imgs[i])).catch(() => null);
    if (p) { added.push(p); localFiles.set(p, imgs[i]); } else failed++;
  }
  setPhotos([...state.photos, ...added]);
  overview();
  const located = added.filter((p) => p.lat != null).length;
  const vids = added.filter((p) => p.video).length;
  const unplayable = added.filter((p) => p.video && !p.playable).length;
  toast(
    [
      `נוספו ${added.length} קבצים${vids ? ` (${vids} סרטונים)` : ''}, ${located} מהם עם מיקום.`,
      failed ? `${failed} קבצים לא נקראו.` : '',
      unplayable ? `${unplayable} סרטונים בפורמט שהדפדפן הזה לא מנגן (נסו ב-Safari או ייצאו כ-MP4).` : '',
    ].filter(Boolean).join(' '),
    6000,
  );
  await nameplaces(added, { quick: true });
  if (state.albumId) await uploadAll(added);
  else updateSync();
  nameplaces(added);
}

// Fill in place names one place at a time (the public geocoder allows about one request per second).
async function nameplaces(list, { quick = false } = {}) {
  if (quick) return; // names arrive later and are saved then; uploads don't wait for them
  const seen = new Map();
  for (const p of list) {
    if (p.lat == null || p.place) continue;
    const k = keyOf(p);
    if (!seen.has(k)) {
      seen.set(k, await placeName(p.lat, p.lng));
      await sleep(1100);
    }
    p.place = seen.get(k);
    if (p.cloudId && p.place) cloud.updateMedia(p.cloudId, { place: p.place }).catch(() => {});
    renderTimeline();
    highlight();
  }
}

// ---------- Cloud: account, albums, uploads ----------
const localFiles = new WeakMap(); // item → the File it was read from (needed to upload it later)
const albumKey = 'livealbum.album';

function saveLocations(list, source) {
  for (const p of list) {
    if (!p.cloudId) continue;
    cloud.updateMedia(p.cloudId, { lat: p.lat, lng: p.lng, place: p.place, location_source: source })
      .catch(() => toast('המיקום לא נשמר בענן. נסו שוב.'));
  }
}

function updateSync() {
  const pending = state.user ? state.photos.filter((p) => !p.cloudId && localFiles.has(p)) : [];
  $('sync').hidden = !pending.length || !state.albumId;
  $('sync-text').textContent = pending.length === 1 ? 'פריט אחד עוד לא נשמר בענן' : `${pending.length} פריטים עוד לא נשמרו בענן`;
}

async function uploadAll(list) {
  const items = list.filter((p) => !p.cloudId && localFiles.has(p));
  if (!items.length || !state.albumId) return;
  let ok = 0, lastErr = null;
  for (let i = 0; i < items.length; i++) {
    toast(`☁️ שומר בענן… ${i + 1} מתוך ${items.length}`, 0);
    try {
      items[i].cloudId = await cloud.uploadItem(state.albumId, items[i], localFiles.get(items[i]));
      ok++;
    } catch (e) {
      console.warn('upload failed', e);
      lastErr = e;
    }
  }
  toast(ok === items.length ? `☁️ ${ok} פריטים נשמרו בענן.` : `נשמרו ${ok} מתוך ${items.length}. ${cloud.uploadErrorText(lastErr)}`, 6000);
  updateSync();
}
$('sync-btn').addEventListener('click', () => uploadAll(state.photos));

async function openAlbum(id) {
  const album = state.albums.find((a) => a.id === id);
  if (!album) return;
  stopTour();
  close();
  state.albumId = id;
  try { localStorage.setItem(albumKey, id); } catch { /* private mode */ }
  $('album-select').value = id;
  $('album-kind').textContent = album.role === 'owner' ? '☁️ האלבום שלך בענן' : '☁️ אלבום משותף';
  $('album-title').textContent = album.title;
  toast('טוען את האלבום…', 0);
  try {
    const items = await cloud.loadAlbum(id);
    // Keep anything added on this device but not saved yet, so nothing is lost by signing in.
    const pending = state.isDemo ? [] : state.photos.filter((p) => !p.cloudId && localFiles.has(p));
    state.isDemo = false;
    setPhotos([...items, ...pending]);
    overview();
    toast(items.length ? '' : 'האלבום ריק. הוסיפו תמונות וסרטונים.', 4000);
    updateSync();
    nameplaces(items);
  } catch (e) {
    console.warn(e);
    toast('האלבום לא נטען. בדקו את החיבור ונסו שוב.');
  }
}

function renderAlbums() {
  const sel = $('album-select');
  sel.replaceChildren(...state.albums.map((a) => {
    const o = document.createElement('option');
    o.value = a.id;
    o.textContent = a.role === 'owner' ? a.title : `${a.title} (משותף)`;
    return o;
  }));
  if (state.albumId) sel.value = state.albumId;
}

cloud.onUser(async (user) => {
  if ((user?.id || null) === (state.user?.id || null)) return;
  state.user = user;
  $('signin-btn').hidden = !!user;
  $('account-in').hidden = !user;
  if (!user) return;
  $('auth').hidden = true;
  $('who').textContent = user.email || '';
  try {
    state.albums = await cloud.listAlbums();
    if (!state.albums.length) state.albums = [await cloud.createAlbum('התמונות שלי')];
    renderAlbums();
    let last = null;
    try { last = localStorage.getItem(albumKey); } catch { /* ignore */ }
    await openAlbum(state.albums.some((a) => a.id === last) ? last : state.albums[state.albums.length - 1].id);
  } catch (e) {
    console.warn(e);
    toast('לא הצלחנו לטעון את האלבומים שלך. רעננו את הדף.');
  }
});

$('album-select').addEventListener('change', (e) => openAlbum(e.target.value));
$('new-album-btn').addEventListener('click', () => { $('new-album-form').hidden = false; $('new-album-title').focus(); });
$('new-album-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = $('new-album-title').value.trim();
  if (!title) return;
  try {
    const a = await cloud.createAlbum(title);
    state.albums.push(a);
    renderAlbums();
    $('new-album-form').hidden = true;
    $('new-album-title').value = '';
    await openAlbum(a.id);
  } catch {
    toast('האלבום לא נוצר. נסו שוב.');
  }
});
$('signout-btn').addEventListener('click', async () => {
  await cloud.signOut();
  try { localStorage.removeItem(albumKey); } catch { /* ignore */ }
  location.reload();
});

// Sign-in dialog: a link by email, nothing else to type.
const authErr = (msg) => { $('auth-err').textContent = msg || ''; $('auth-err').hidden = !msg; };
$('signin-btn').addEventListener('click', () => { $('auth').hidden = false; authErr(''); $('auth-email').focus(); });
$('auth-close').addEventListener('click', () => { $('auth').hidden = true; });
$('auth').addEventListener('click', (e) => { if (e.target === $('auth')) $('auth').hidden = true; });
$('auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('auth-email').value.trim();
  if (!email) return;
  authErr('');
  $('auth-send').disabled = true;
  try {
    await cloud.sendSignInEmail(email);
    $('auth-sent').hidden = false;
    $('auth-sent').textContent = `📧 שלחנו מייל ל-${email}. לחצו על הקישור שבו, והאלבום שלכם ייפתח. כדאי לפתוח את המייל באותו מכשיר.`;
    $('auth-send').textContent = 'שליחה חוזרת';
  } catch (err) {
    authErr(/rate|seconds/i.test(err?.message || '') ? 'שלחנו כבר מייל לפני רגע. חכו דקה ונסו שוב.' : 'המייל לא נשלח. בדקו את הכתובת ונסו שוב.');
  } finally {
    $('auth-send').disabled = false;
  }
});


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
$('toggle-panel').addEventListener('click', () => { $('panel').classList.add('collapsed'); $('show-panel').hidden = false; fit(); });
$('show-panel').addEventListener('click', () => { $('panel').classList.remove('collapsed'); $('show-panel').hidden = true; fit(); });

// ---------- Start ----------
demoAlbum().then((list) => {
  if (!state.isDemo) return;
  setPhotos(list);
  globe.pointOfView({ lat: 38, lng: 20, altitude: 2.6 });
});
