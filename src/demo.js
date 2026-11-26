// A sample album so the globe has something to show before anyone adds photos.
// The images are drawn postcards, not real photos.

const STOPS = [
  { place: 'תל אביב, ישראל', lat: 32.0809, lng: 34.7681, date: '2019-07-14', sky: ['#ff9a5a', '#ffd27a'], ground: '#1f6f8b', kind: 'sea' },
  { place: 'ירושלים, ישראל', lat: 31.7767, lng: 35.2345, date: '2019-09-30', sky: ['#f6c177', '#fde8c0'], ground: '#c9a46a', kind: 'city' },
  { place: 'רומא, איטליה', lat: 41.8902, lng: 12.4922, date: '2021-06-03', sky: ['#7ab8e6', '#d9eefb'], ground: '#b5764a', kind: 'arch' },
  { place: 'פירנצה, איטליה', lat: 43.7731, lng: 11.2560, date: '2021-06-07', sky: ['#e98a6a', '#f8cfa6'], ground: '#8a5a3c', kind: 'dome' },
  { place: 'פריז, צרפת', lat: 48.8584, lng: 2.2945, date: '2022-04-18', sky: ['#9fb7e8', '#e6ecfa'], ground: '#5d6b4a', kind: 'tower' },
  { place: 'ברצלונה, ספרד', lat: 41.4036, lng: 2.1744, date: '2023-08-11', sky: ['#4fa3d8', '#bfe3f7'], ground: '#d39b52', kind: 'spires' },
  { place: 'האלפים, שווייץ', lat: 46.5584, lng: 7.8352, date: '2024-01-27', sky: ['#a9c7e2', '#eef4fa'], ground: '#ffffff', kind: 'peaks' },
  { place: 'ניו יורק, ארה״ב', lat: 40.7484, lng: -73.9857, date: '2024-12-20', sky: ['#2d3a6b', '#e07a5f'], ground: '#2a2f3a', kind: 'skyline' },
  { place: 'קיוטו, יפן', lat: 34.9671, lng: 135.7727, date: '2025-04-05', sky: ['#f7b2c4', '#fde5ec'], ground: '#6b8f5a', kind: 'torii' },
];

function draw(stop, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, stop.sky[0]); sky.addColorStop(1, stop.sky[1]);
  g.fillStyle = sky; g.fillRect(0, 0, w, h);
  const base = h * 0.68;
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.beginPath(); g.arc(w * 0.78, h * 0.25, h * 0.08, 0, Math.PI * 2); g.fill();
  g.fillStyle = stop.ground;
  const S = (x, y, ww, hh) => g.fillRect(w * x, base - h * hh + h * y, w * ww, h * hh);
  g.save();
  g.fillStyle = 'rgba(20,30,40,0.55)';
  switch (stop.kind) {
    case 'tower':
      g.beginPath(); g.moveTo(w * 0.5, h * 0.12); g.lineTo(w * 0.6, base); g.lineTo(w * 0.4, base); g.closePath(); g.fill(); break;
    case 'skyline':
      [[0.1, 0.3], [0.2, 0.45], [0.32, 0.38], [0.45, 0.55], [0.58, 0.33], [0.7, 0.48], [0.82, 0.28]].forEach(([x, hh]) => S(x, 0, 0.09, hh)); break;
    case 'dome':
      g.beginPath(); g.arc(w * 0.5, base - h * 0.12, w * 0.14, Math.PI, 0); g.fill(); S(0.36, 0, 0.28, 0.12); break;
    case 'arch':
      S(0.15, 0, 0.7, 0.3); g.fillStyle = stop.sky[1];
      for (let i = 0; i < 5; i++) { g.beginPath(); g.arc(w * (0.23 + i * 0.135), base - h * 0.06, w * 0.04, Math.PI, 0); g.fill(); g.fillRect(w * (0.19 + i * 0.135), base - h * 0.06, w * 0.08, h * 0.06); } break;
    case 'spires':
      [0.3, 0.4, 0.6, 0.7].forEach((x, i) => { g.beginPath(); g.moveTo(w * x, h * (0.15 + (i % 2) * 0.06)); g.lineTo(w * (x + 0.04), base); g.lineTo(w * (x - 0.04), base); g.fill(); }); break;
    case 'peaks':
      g.fillStyle = 'rgba(70,90,120,0.7)'; g.beginPath(); g.moveTo(0, base); g.lineTo(w * 0.3, h * 0.2); g.lineTo(w * 0.55, base); g.lineTo(w * 0.7, h * 0.3); g.lineTo(w, base); g.fill(); break;
    case 'torii':
      S(0.3, 0, 0.05, 0.42); S(0.65, 0, 0.05, 0.42); S(0.24, -0.38, 0.52, 0.05); S(0.28, -0.3, 0.44, 0.03); break;
    case 'city':
      [[0.15, 0.18], [0.3, 0.24], [0.48, 0.2], [0.63, 0.26], [0.78, 0.17]].forEach(([x, hh]) => S(x, 0, 0.12, hh));
      g.beginPath(); g.arc(w * 0.52, base - h * 0.2, w * 0.07, Math.PI, 0); g.fillStyle = '#d9a83a'; g.fill(); break;
    default:
      g.fillStyle = 'rgba(255,255,255,0.5)'; for (let i = 0; i < 4; i++) g.fillRect(0, base + h * (0.04 + i * 0.06), w, 2);
  }
  g.restore();
  g.fillStyle = stop.ground; g.globalAlpha = 0.9; g.fillRect(0, base, w, h - base); g.globalAlpha = 1;
  return c;
}

const toUrl = (canvas) => new Promise((r) => canvas.toBlob((b) => r(URL.createObjectURL(b)), 'image/jpeg', 0.88));

export async function demoAlbum() {
  return Promise.all(
    STOPS.map(async (s, i) => ({
      id: `demo-${i}`,
      name: s.place,
      place: s.place,
      date: new Date(s.date + 'T12:00:00'),
      lat: s.lat,
      lng: s.lng,
      thumb: await toUrl(draw(s, 160, 160)),
      full: await toUrl(draw(s, 1200, 800)),
    })),
  );
}
