// Automatic family-tree layout.
//
// 1. Give everyone a generation (row): children one row below their parents,
//    partners on the same row.
// 2. Order each row by walking the families, so partners sit together and
//    siblings sit together under their parents.
// 3. Work out x positions: repeatedly centre parents over their children and
//    children under their parents, packing each row so cards never overlap
//    (isotonic regression / "pool adjacent violators" keeps the row order and
//    the minimum gaps while staying as close as possible to the ideal spots).
// 4. Apply any nudges she made by dragging (stored as offsets from the
//    automatic spot, so they travel with the family when the tree grows).

export const CARD_W = 224;
export const CARD_H = 72;
export const ROW_H = 176;
const GAP_PARTNER = 48;
const GAP_SIB = 26;
const GAP_FAMILY = 64;

function pav(desired, gaps) {
  const n = desired.length;
  const off = new Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) { acc += gaps[i]; off[i] = acc; }
  const blocks = [];
  for (let i = 0; i < n; i++) {
    blocks.push({ sum: desired[i] - off[i], n: 1 });
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1];
      const a = blocks[blocks.length - 2];
      if (a.sum / a.n <= b.sum / b.n) break;
      a.sum += b.sum;
      a.n += b.n;
      blocks.pop();
    }
  }
  const out = [];
  for (const b of blocks) for (let j = 0; j < b.n; j++) out.push(b.sum / b.n + off[out.length]);
  return out;
}

export function layout(view, offsets = {}) {
  const ids = Object.keys(view.people);
  const partnerU = new Map(ids.map((id) => [id, []]));
  const parentU = new Map(ids.map((id) => [id, []]));
  for (const u of view.unions) {
    for (const p of u.partners) partnerU.get(p).push(u);
    for (const c of u.children) parentU.get(c.id).push(u);
  }

  // ---- 1. generations ----
  const gen = Object.fromEntries(ids.map((id) => [id, 0]));
  const maxIter = ids.length + 10;
  for (let it = 0; it < maxIter; it++) {
    let changed = false;
    const raise = (id, g) => { if (gen[id] < g) { gen[id] = g; changed = true; } };
    for (const u of view.unions) {
      let g = -Infinity;
      for (const p of u.partners) g = Math.max(g, gen[p]);
      if (u.children.length && u.partners.length) {
        // Parents with no parents of their own sit just above their eldest-row child.
        const minChild = Math.min(...u.children.map((c) => gen[c.id]));
        for (const p of u.partners) if (!parentU.get(p).length) g = Math.max(g, minChild - 1);
      }
      for (const p of u.partners) raise(p, g);
      if (u.partners.length) {
        for (const c of u.children) raise(c.id, g + 1);
      } else {
        const m = Math.max(...u.children.map((c) => gen[c.id]));
        for (const c of u.children) raise(c.id, m);
      }
    }
    if (!changed) break;
  }
  const minGen = Math.min(0, ...Object.values(gen));
  for (const id of ids) gen[id] -= minGen;
  const maxGen = Math.max(0, ...Object.values(gen));

  // ---- 2. row order ----
  const rows = Array.from({ length: maxGen + 1 }, () => []);
  const placed = new Set();

  const partnersOf = (id) => {
    const out = [];
    for (const u of partnerU.get(id)) for (const q of u.partners) if (q !== id) out.push(q);
    return out;
  };

  // A run of people joined by partnerships, with `id` in the middle.
  function cluster(id) {
    const chain = (start) => {
      const out = [];
      const stack = [start];
      while (stack.length) {
        const p = stack.pop();
        if (placed.has(p) || gen[p] !== gen[id]) continue;
        placed.add(p);
        out.push(p);
        for (const q of partnersOf(p).reverse()) stack.push(q);
      }
      return out;
    };
    placed.add(id);
    const ps = partnersOf(id).filter((q) => !placed.has(q) && gen[q] === gen[id]);
    const right = ps.length ? chain(ps[0]) : [];
    const left = ps.length > 1 ? chain(ps[1]).reverse() : [];
    const rest = ps.slice(2).flatMap((q) => chain(q));
    return [...left, id, ...right, ...rest];
  }

  function place(id) {
    if (placed.has(id)) return;
    const group = cluster(id);
    rows[gen[id]].push(...group);
    for (const p of group) {
      for (const u of partnerU.get(p)) for (const c of u.children) place(c.id);
    }
    // Partnerless sibling groups.
    for (const u of parentU.get(id)) if (!u.partners.length) for (const c of u.children) place(c.id);
  }

  const starts = [...ids].sort((a, b) => gen[a] - gen[b]);
  for (const id of starts) if (!parentU.get(id).some((u) => u.partners.length)) place(id);
  for (const id of starts) place(id);

  // Reduce crossing lines: repeatedly sort each row's partner-runs by the
  // average position of their parents (downward) or children (upward).
  const isPartner = (a, b) => partnerU.get(a).some((u) => u.partners.includes(b));
  const isSibling = (a, b) => parentU.get(a).some((u) => u.children.some((c) => c.id === b));
  const runs = (row) => {
    const out = [];
    for (const id of row) {
      const last = out[out.length - 1];
      const prev = last && last[last.length - 1];
      if (prev && (isPartner(prev, id) || isSibling(prev, id))) last.push(id);
      else out.push([id]);
    }
    return out;
  };
  const rel = (g) => {
    const m = new Map();
    rows[g].forEach((id, i) => m.set(id, (i + 0.5) / rows[g].length));
    return m;
  };
  const reorder = (g, neighbours) => {
    const here = rel(g);
    const other = rel(neighbours.g);
    const keyed = runs(rows[g]).map((run, i) => {
      const xs = [];
      for (const id of run) for (const n of neighbours.of(id)) if (other.has(n)) xs.push(other.get(n));
      const key = xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : here.get(run[0]);
      return { run, key, i };
    });
    keyed.sort((a, b) => a.key - b.key || a.i - b.i);
    rows[g] = keyed.flatMap((k) => k.run);
  };
  const parentsOf = (id) => parentU.get(id).flatMap((u) => (u.partners.length ? u.partners : u.children.map((c) => c.id).filter((c) => c !== id)));
  const childrenOf = (id) => partnerU.get(id).flatMap((u) => u.children.map((c) => c.id));
  for (let sweep = 0; sweep < 4; sweep++) {
    for (let g = 0; g < maxGen; g++) reorder(g, { g: g + 1, of: childrenOf });
    for (let g = 1; g <= maxGen; g++) reorder(g, { g: g - 1, of: parentsOf });
  }

  // ---- 3. x positions ----
  const x = {};
  const step = (gap) => CARD_W + gap;
  const rowGaps = rows.map((row) => row.map((id, i) => {
    if (i === 0) return 0;
    const prev = row[i - 1];
    if (partnerU.get(id).some((u) => u.partners.includes(prev))) return step(GAP_PARTNER);
    if (parentU.get(id).some((u) => u.children.some((c) => c.id === prev))) return step(GAP_SIB);
    return step(GAP_FAMILY);
  }));
  rows.forEach((row, g) => {
    const xs = pav(row.map(() => 0), rowGaps[g]);
    row.forEach((id, i) => { x[id] = xs[i]; });
  });

  const unionX = (u) => {
    if (u.partners.length) return u.partners.reduce((s, p) => s + x[p], 0) / u.partners.length;
    return u.children.reduce((s, c) => s + x[c.id], 0) / u.children.length;
  };

  function packRow(g, want) {
    const row = rows[g];
    const xs = pav(row.map((id) => want[id] ?? x[id]), rowGaps[g]);
    row.forEach((id, i) => { x[id] = xs[i]; });
  }

  function downPass() {
    for (let g = 1; g <= maxGen; g++) {
      const want = {};
      const seen = new Set();
      for (const id of rows[g]) {
        const pu = parentU.get(id).find((u) => u.partners.length);
        if (!pu || seen.has(pu.id)) continue;
        seen.add(pu.id);
        const kids = rows[g].filter((k) => pu.children.some((c) => c.id === k));
        const ux = unionX(pu);
        const s = step(GAP_SIB);
        kids.forEach((k, i) => { want[k] = ux + (i - (kids.length - 1) / 2) * s; });
      }
      // Married-in partners follow their spouse.
      for (const id of rows[g]) {
        if (want[id] !== undefined) continue;
        const sp = partnersOf(id).find((q) => want[q] !== undefined && gen[q] === g);
        if (sp) want[id] = want[sp] + (x[id] < x[sp] ? -1 : 1) * step(GAP_PARTNER);
      }
      packRow(g, want);
    }
  }

  // Parents move as a block (with all their partners) to sit over their children.
  function upPass() {
    for (let g = maxGen - 1; g >= 0; g--) {
      const want = {};
      const row = rows[g];
      let i = 0;
      while (i < row.length) {
        let j = i + 1;
        while (j < row.length && partnerU.get(row[j]).some((u) => u.partners.includes(row[j - 1]))) j++;
        const run = row.slice(i, j);
        const seen = new Set();
        let shift = 0, n = 0;
        for (const id of run) for (const u of partnerU.get(id)) {
          if (seen.has(u.id) || !u.children.length) continue;
          seen.add(u.id);
          const w = u.children.length;
          shift += w * (u.children.reduce((s, c) => s + x[c.id], 0) / u.children.length - unionX(u));
          n += w;
        }
        if (n) for (const id of run) want[id] = x[id] + shift / n;
        i = j;
      }
      packRow(g, want);
    }
  }

  for (let i = 0; i < 6; i++) { upPass(); downPass(); }
  upPass();

  // ---- 4. final positions (card centres) ----
  const pos = {};
  for (const id of ids) {
    const o = offsets[id];
    pos[id] = { x: x[id] + (o ? o.x : 0), y: gen[id] * ROW_H + (o ? o.y : 0) };
  }
  const auto = {};
  for (const id of ids) auto[id] = { x: x[id], y: gen[id] * ROW_H };

  const unionPts = {};
  for (const u of view.unions) {
    if (u.partners.length === 2) {
      const [a, b] = u.partners.map((p) => pos[p]);
      unionPts[u.id] = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    } else if (u.partners.length === 1) {
      const a = pos[u.partners[0]];
      unionPts[u.id] = { x: a.x, y: a.y + CARD_H / 2 };
    } else {
      const cx = u.children.reduce((s, c) => s + pos[c.id].x, 0) / u.children.length;
      const cy = Math.min(...u.children.map((c) => pos[c.id].y));
      unionPts[u.id] = { x: cx, y: cy - CARD_H / 2 - 56 };
    }
  }

  // Give overlapping child "buses" in the same row different heights so families don't merge.
  const busY = {};
  const byRow = new Map();
  for (const u of view.unions) {
    if (!u.children.length) continue;
    const top = Math.min(...u.children.map((c) => pos[c.id].y)) - CARD_H / 2;
    const xs = u.children.map((c) => pos[c.id].x).concat(unionPts[u.id].x);
    const key = Math.round(top);
    if (!byRow.has(key)) byRow.set(key, []);
    byRow.get(key).push({ u, top, lo: Math.min(...xs) - 6, hi: Math.max(...xs) + 6 });
  }
  for (const list of byRow.values()) {
    list.sort((a, b) => a.lo - b.lo);
    const levels = []; // right edge of last bus on each level
    for (const b of list) {
      let lv = levels.findIndex((r) => r < b.lo);
      if (lv < 0) { lv = levels.length; levels.push(0); }
      levels[lv] = b.hi;
      busY[b.u.id] = b.top - 24 - (lv % 4) * 14;
    }
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of Object.values(pos)) {
    minX = Math.min(minX, p.x - CARD_W / 2);
    maxX = Math.max(maxX, p.x + CARD_W / 2);
    minY = Math.min(minY, p.y - CARD_H / 2);
    maxY = Math.max(maxY, p.y + CARD_H / 2);
  }
  for (const p of Object.values(unionPts)) { minY = Math.min(minY, p.y - 10); }
  const bounds = ids.length ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY } : { x: -200, y: -100, w: 400, h: 200 };

  return { pos, auto, unionPts, busY, gen, bounds };
}
