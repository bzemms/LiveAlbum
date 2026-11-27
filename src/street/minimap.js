// A round radar in the corner, in the spirit of street games: the map turns with the camera,
// the visitor is the arrow in the middle, gold stars are memories still to find.

const PX = 2.2; // pixels per metre on the pre-drawn map

export function makeMinimap(canvas, { radius, buildings, roads, night }) {
  const size = Math.ceil(radius * 2 * PX);
  const base = document.createElement('canvas');
  base.width = base.height = size;
  const b = base.getContext('2d');
  const tx = (x) => (x + radius) * PX;
  b.fillStyle = night ? '#1b2236' : '#dfe6ea';
  b.fillRect(0, 0, size, size);
  b.lineCap = b.lineJoin = 'round';
  for (const r of roads) {
    b.strokeStyle = r.foot ? (night ? '#3b4560' : '#f6f7f8') : night ? '#56617f' : '#ffffff';
    b.lineWidth = Math.max(2, r.width * PX * 0.9);
    b.beginPath();
    r.pts.forEach(([x, z], i) => (i ? b.lineTo(tx(x), tx(z)) : b.moveTo(tx(x), tx(z))));
    b.stroke();
  }
  b.fillStyle = night ? '#2e3650' : '#b9c3cc';
  for (const bl of buildings) {
    b.beginPath();
    bl.pts.forEach(([x, z], i) => (i ? b.lineTo(tx(x), tx(z)) : b.moveTo(tx(x), tx(z))));
    b.closePath();
    b.fill();
  }

  const ctx = canvas.getContext('2d');
  const dpr = Math.min(2, devicePixelRatio || 1);

  // What the last frame showed, so a tap on the map can be turned back into a place in the world.
  let view = null;
  const hits = [];

  function draw({ x, z, yaw, route, memories, door, scale = 1.25 }) {
    const W = canvas.clientWidth;
    if (canvas.width !== W * dpr) { canvas.width = canvas.height = W * dpr; }
    const c = canvas.width / 2;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.beginPath();
    ctx.arc(c, c, c - 2 * dpr, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = night ? '#121827' : '#cfd8de';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // World → radar: centre on the visitor, turn so the camera's forward points up.
    const k = scale * dpr;
    view = { x, z, yaw, k, c };
    hits.length = 0;
    ctx.translate(c, c);
    ctx.rotate(yaw);
    ctx.scale(k, k);
    ctx.drawImage(base, -(x + radius) * PX, -(z + radius) * PX);
    const P = (wx, wz) => [(wx - x) * PX, (wz - z) * PX];
    if (route && route.length > 1) {
      ctx.strokeStyle = '#ffd34d';
      ctx.lineWidth = 3.2 / k * dpr;
      ctx.setLineDash([6 / k * dpr, 4 / k * dpr]);
      ctx.beginPath();
      route.forEach(([wx, wz], i) => { const [px, pz] = P(wx, wz); i ? ctx.lineTo(px, pz) : ctx.moveTo(px, pz); });
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const icon = (wx, wz, fill, r, star) => {
      let [px, pz] = P(wx, wz);
      // Keep off-radar targets pinned to the rim so they stay findable.
      const lim = (c - 10 * dpr) / k, d = Math.hypot(px, pz);
      if (d > lim) { px *= lim / d; pz *= lim / d; }
      // Where the icon lands on the canvas, so tapping it jumps to the real spot even when pinned.
      const cs = Math.cos(yaw), sn = Math.sin(yaw);
      hits.push({ x: wx, z: wz, cx: c + (px * cs - pz * sn) * k, cy: c + (px * sn + pz * cs) * k });
      ctx.save();
      ctx.translate(px, pz);
      ctx.rotate(-yaw);
      ctx.fillStyle = fill;
      ctx.strokeStyle = '#1a1405';
      ctx.lineWidth = 1.4 / k * dpr;
      ctx.beginPath();
      const rr = (r / k) * dpr;
      if (star) {
        for (let q = 0; q < 10; q++) { const a = (q * Math.PI) / 5 - Math.PI / 2, m = q % 2 ? rr * 0.45 : rr; ctx.lineTo(Math.cos(a) * m, Math.sin(a) * m); }
        ctx.closePath();
      } else ctx.rect(-rr * 0.8, -rr * 0.8, rr * 1.6, rr * 1.6);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    };
    for (const m of memories) icon(m.x, m.z, m.found ? '#8b93a3' : '#ffd34d', m.found ? 5 : 8, true);
    if (door) icon(door.x, door.z, '#ff8a4c', 6.5, false);
    ctx.restore();
    // The visitor: an arrow in the middle, always pointing up.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.translate(c, c);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#0d1a2b';
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    ctx.moveTo(0, -9 * dpr); ctx.lineTo(7 * dpr, 8 * dpr); ctx.lineTo(0, 4 * dpr); ctx.lineTo(-7 * dpr, 8 * dpr); ctx.closePath();
    ctx.stroke();
    ctx.fill();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 3 * dpr;
    ctx.beginPath();
    ctx.arc(c, c, c - 2 * dpr, 0, Math.PI * 2);
    ctx.stroke();
  }

  /** The world point under a tap at (clientX, clientY): a star or the door if one is close, else the ground. */
  draw.pick = (clientX, clientY) => {
    if (!view) return null;
    const r = canvas.getBoundingClientRect();
    const cx = ((clientX - r.left) / r.width) * canvas.width, cy = ((clientY - r.top) / r.height) * canvas.height;
    if (Math.hypot(cx - view.c, cy - view.c) > view.c) return null;
    let best = null, bd = 16 * dpr;
    for (const h of hits) { const d = Math.hypot(h.cx - cx, h.cy - cy); if (d < bd) { bd = d; best = h; } }
    if (best) return { x: best.x, z: best.z, icon: true };
    const dx = (cx - view.c) / view.k, dy = (cy - view.c) / view.k;
    const cs = Math.cos(view.yaw), sn = Math.sin(view.yaw);
    return { x: view.x + (dx * cs + dy * sn) / PX, z: view.z + (-dx * sn + dy * cs) / PX };
  };
  return draw;
}
