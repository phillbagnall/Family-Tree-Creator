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

// Everything lines up on a 24px grid: cards are 9 x 3 grid squares.
export const GRID = 24;
export const CARD_W = 216;
export const CARD_H = 72;
export const ROW_H = 168;
const GAP_PARTNER = 48;
const GAP_SIB = 32;
const GAP_FAMILY = 72;

// Move a card centre so the card's corners sit on grid dots.
const snapX = (x) => Math.round((x - CARD_W / 2) / GRID) * GRID + CARD_W / 2;
const snapY = (y) => Math.round((y - CARD_H / 2) / GRID) * GRID + CARD_H / 2;

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

export function layout(view, offsets = {}, { snap = true } = {}) {
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
      if (prev && (last.some((m) => isPartner(m, id)) || isSibling(prev, id))) last.push(id);
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
        while (j < row.length && row.slice(i, j).some((m) => partnerU.get(row[j]).some((u) => u.partners.includes(m)))) j++;
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
  // Automatic spots always sit on the grid; dragged ones snap too unless snapping is off.
  const auto = {};
  const pos = {};
  for (const id of ids) {
    auto[id] = { x: snapX(x[id]), y: snapY(gen[id] * ROW_H) };
    const o = offsets[id];
    const px = auto[id].x + (o ? o.x : 0), py = auto[id].y + (o ? o.y : 0);
    pos[id] = snap ? { x: snapX(px), y: snapY(py) } : { x: px, y: py };
  }

  // Centre children exactly under their parents when they're nearly there (within two grid
  // squares): this removes the small jog grid-snapping can leave, and catches children she
  // dropped almost in the middle. Only done when it doesn't push anyone closer to another card.
  // Families are handled from the top down, so grandchildren follow their (moved) parents.
  const CENTRE_PULL = 2 * GRID;
  const families = view.unions
    .filter((u) => u.partners.length && u.children.length)
    .sort((a, b) => Math.min(...a.partners.map((p) => pos[p].y)) - Math.min(...b.partners.map((p) => pos[p].y)));
  const sideGap = (a, b) => Math.abs(a.x - b.x) - CARD_W;
  const sameBand = (a, b) => Math.abs(a.y - b.y) < CARD_H + GRID;
  for (const u of families) {
    const kids = u.children.map((c) => c.id);
    if (kids.some((k) => u.partners.includes(k))) continue;
    const ux = u.partners.reduce((sum, p) => sum + pos[p].x, 0) / u.partners.length;
    const xs = kids.map((k) => pos[k].x);
    const d = ux - (Math.min(...xs) + Math.max(...xs)) / 2;
    if (!d || Math.abs(d) > CENTRE_PULL) continue;
    // Partners who married into the family (no parents of their own here) move with them.
    const group = new Set(kids);
    for (const k of kids) {
      for (const q of partnersOf(k)) {
        if (!parentU.get(q).length && !u.partners.includes(q) && Math.abs(pos[q].y - pos[k].y) < CARD_H) group.add(q);
      }
    }
    const kidSet = group;
    const ok = [...group].every((k) => {
      const before = pos[k];
      const after = { x: before.x + d, y: before.y };
      return ids.every((o) => {
        if (kidSet.has(o) || !sameBand(pos[o], after)) return true;
        return sideGap(pos[o], after) >= Math.min(GRID, sideGap(pos[o], before));
      });
    });
    if (ok) for (const k of group) pos[k] = { x: pos[k].x + d, y: pos[k].y };
  }

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

  // Where each line enters a child's card: normally the middle of its top edge, but if
  // another family's line comes down close by, slide it along the card so lines from
  // different families stay at least LINE_GAP apart.
  const LINE_GAP = 48; // two grid squares
  const childX = {};
  const bandOf = (u) => Math.round(Math.min(...u.children.map((c) => pos[c.id].y)) - CARD_H / 2);
  const bands = new Map(); // gap above a row -> vertical lines in it [{u, x}]
  for (const u of view.unions) {
    if (!u.children.length) continue;
    const k = bandOf(u);
    if (!bands.has(k)) bands.set(k, []);
    bands.get(k).push({ u: u.id, x: unionPts[u.id].x });
  }
  for (const u of view.unions) {
    if (!u.children.length) continue;
    const lines = bands.get(bandOf(u));
    for (const c of u.children) {
      const cx = pos[c.id].x;
      const others = lines.filter((l) => l.u !== u.id);
      const clear = (x) => others.every((l) => Math.abs(l.x - x) >= LINE_GAP);
      let best = cx;
      if (!clear(cx)) {
        const near = others.reduce((m, l) => (Math.abs(l.x - cx) < Math.abs(m.x - cx) ? l : m));
        const away = cx >= near.x ? 1 : -1;
        const limit = CARD_W / 2 - 30;
        for (let d = GRID / 2; d <= limit; d += GRID / 2) {
          if (clear(cx + away * d)) { best = cx + away * d; break; }
          if (clear(cx - away * d)) { best = cx - away * d; break; }
        }
      }
      childX[`${u.id}:${c.id}`] = best;
      lines.push({ u: u.id, x: best });
    }
  }

  // Give overlapping (or nearly touching) child "buses" in the same gap different heights,
  // spaced well apart, so families don't merge.
  const busY = {};
  const byRow = new Map();
  for (const u of view.unions) {
    if (!u.children.length) continue;
    const top = Math.min(...u.children.map((c) => pos[c.id].y)) - CARD_H / 2;
    const xs = u.children.map((c) => childX[`${u.id}:${c.id}`]).concat(unionPts[u.id].x);
    const key = Math.round(top);
    if (!byRow.has(key)) byRow.set(key, []);
    byRow.get(key).push({ u, top, lo: Math.min(...xs) - LINE_GAP / 2, hi: Math.max(...xs) + LINE_GAP / 2 });
  }
  for (const list of byRow.values()) {
    list.sort((p, q) => p.lo - q.lo);
    const levels = []; // right edge of last bus on each level
    for (const bus of list) {
      let lv = levels.findIndex((r) => r < bus.lo);
      if (lv < 0) { lv = levels.length; levels.push(0); }
      levels[lv] = bus.hi;
      busY[bus.u.id] = bus.top - 22 - (lv % 3) * 22;
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

  return { pos, auto, unionPts, busY, childX, gen, bounds };
}
