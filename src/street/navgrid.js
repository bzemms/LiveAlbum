// Walkable grid over the neighbourhood and A* path finding on it, for the glowing route.

export function makeGrid(radius, cell, isBlocked) {
  const n = Math.ceil((radius * 2) / cell);
  const walk = new Uint8Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = -radius + (i + 0.5) * cell, z = -radius + (j + 0.5) * cell;
      walk[j * n + i] = isBlocked(x, z) ? 0 : 1;
    }
  }
  const toCell = (x, z) => [Math.floor((x + radius) / cell), Math.floor((z + radius) / cell)];
  const toWorld = (i, j) => [-radius + (i + 0.5) * cell, -radius + (j + 0.5) * cell];
  const ok = (i, j) => i >= 0 && j >= 0 && i < n && j < n && walk[j * n + i] === 1;

  // Nearest walkable cell to (i, j), searched in growing rings.
  function nearestOpen(i, j) {
    if (ok(i, j)) return [i, j];
    for (let r = 1; r < 12; r++) {
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) === r && ok(i + di, j + dj)) return [i + di, j + dj];
      }
    }
    return null;
  }

  /** Path from (ax, az) to (bx, bz) as world points, or null. 8-way A* with a binary heap. */
  function path(ax, az, bx, bz) {
    const s = nearestOpen(...toCell(ax, az)), t = nearestOpen(...toCell(bx, bz));
    if (!s || !t) return null;
    const N = n * n, start = s[1] * n + s[0], goal = t[1] * n + t[0];
    const g = new Float32Array(N).fill(Infinity);
    const came = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    const heap = [];
    const h = (k) => { const i = k % n, j = (k / n) | 0; const dx = Math.abs(i - t[0]), dz = Math.abs(j - t[1]); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz); };
    const push = (k, f) => { heap.push([f, k]); let c = heap.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (heap[p][0] <= heap[c][0]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let c = 0; for (;;) { const l = 2 * c + 1, r = l + 1; let m = c; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; c = m; } } return top; };
    g[start] = 0;
    push(start, h(start));
    let steps = 0;
    while (heap.length && steps++ < 60000) {
      const [, k] = pop();
      if (k === goal) break;
      if (closed[k]) continue;
      closed[k] = 1;
      const i = k % n, j = (k / n) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = i + di, nj = j + dj;
        if (!ok(ni, nj)) continue;
        if (di && dj && (!ok(i + di, j) || !ok(i, j + dj))) continue; // no corner cutting
        const nk = nj * n + ni, cost = g[k] + (di && dj ? 1.414 : 1);
        if (cost < g[nk]) { g[nk] = cost; came[nk] = k; push(nk, cost + h(nk)); }
      }
    }
    if (came[goal] === -1 && goal !== start) return null;
    const cells = [];
    for (let k = goal; k !== -1; k = came[k]) cells.push(k);
    cells.reverse();
    // Drop cells that sit on a straight line, keep the turns.
    const pts = cells.map((k) => toWorld(k % n, (k / n) | 0));
    const out = [pts[0]];
    for (let q = 1; q < pts.length - 1; q++) {
      const [x0, z0] = out[out.length - 1], [x1, z1] = pts[q], [x2, z2] = pts[q + 1];
      if (Math.abs((x1 - x0) * (z2 - z1) - (z1 - z0) * (x2 - x1)) > 1e-6) out.push(pts[q]);
    }
    if (pts.length > 1) out.push(pts[pts.length - 1]);
    out[out.length - 1] = [bx, bz];
    return out;
  }

  return { path, ok: (x, z) => ok(...toCell(x, z)) };
}
