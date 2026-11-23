// Draws the tree as SVG. Everything is vector (text, lines, cards), so it
// stays sharp at any zoom level and in exports.

import { CARD_W, CARD_H } from './layout.js';

export const FONT = "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif";
export const UI_FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const measureCtx = document.createElement('canvas').getContext('2d');
function fit(text, font, max) {
  text = String(text || '');
  measureCtx.font = font;
  if (measureCtx.measureText(text).width <= max) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (measureCtx.measureText(text.slice(0, mid) + '…').width <= max) lo = mid; else hi = mid - 1;
  }
  return text.slice(0, lo).trimEnd() + '…';
}

export function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function lifespan(p) {
  const b = (p.born || '').trim();
  const d = (p.died || '').trim();
  if (b && d) return `${b} – ${d}`;
  if (b) return `b. ${b}`;
  if (d) return `d. ${d}`;
  return '';
}

const CHILD_DASH = { birth: '', adopted: '7 5', step: '2 5', foster: '10 4 2 4' };

// Colours come from CSS variables in the app; exports pass a fixed palette.
export const LIGHT = {
  card: '#ffffff', cardLine: '#d3dbe7', text: '#1c2433', muted: '#5f6b7d', line: '#7d8aa0',
  accent: '#2563eb', photoBg: '#e6ecf5', halo: '#ffffff',
};

function partnerLine(u, a, b, c) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  const parts = [];
  const line = (o, dash, w = 2) =>
    `<line x1="${a.x + nx * o}" y1="${a.y + ny * o}" x2="${b.x + nx * o}" y2="${b.y + ny * o}" stroke="${c.line}" stroke-width="${w}" ${dash ? `stroke-dasharray="${dash}"` : ''} stroke-linecap="round"/>`;
  if (u.type === 'married') parts.push(line(-3), line(3));
  else if (u.type === 'engaged') parts.push(line(0, '8 6'));
  else if (u.type === 'affair') parts.push(line(0, '1 6', 2.5));
  else if (u.type === 'unknown') parts.push(line(0, '3 4', 1.5));
  else parts.push(line(0));
  if (u.status === 'divorced' || u.status === 'separated') {
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const ux = dx / len, uy = dy / len;
    for (const s of u.status === 'divorced' ? [-5, 5] : [0]) {
      const cx = mx + ux * (s + 18), cy = my + uy * (s + 18);
      parts.push(`<line x1="${cx - nx * 9 - ux * 4}" y1="${cy - ny * 9 - uy * 4}" x2="${cx + nx * 9 + ux * 4}" y2="${cy + ny * 9 + uy * 4}" stroke="${c.line}" stroke-width="2"/>`);
    }
  }
  return parts.join('');
}

function childLines(u, pt, pos, c, preferredBus, childX) {
  if (!u.children.length) return '';
  const tops = u.children.map((ch) => ({ ...ch, x: (childX && childX[`${u.id}:${ch.id}`]) ?? pos[ch.id].x, top: pos[ch.id].y - CARD_H / 2 }));
  let busY = preferredBus ?? Math.min(...tops.map((t) => t.top)) - 30;
  if (busY < pt.y + 12) busY = (pt.y + Math.min(...tops.map((t) => t.top))) / 2;
  const xs = tops.map((t) => t.x).concat(pt.x);
  let s = `<path d="M${pt.x},${pt.y} V${busY} M${Math.min(...xs)},${busY} H${Math.max(...xs)}" stroke="${c.line}" stroke-width="2" fill="none"/>`;
  for (const t of tops) {
    const dash = CHILD_DASH[t.kind] || '';
    s += `<path d="M${t.x},${busY} V${t.top}" stroke="${c.line}" stroke-width="2" fill="none" ${dash ? `stroke-dasharray="${dash}"` : ''}/>`;
  }
  if (u.partners.length !== 1) {
    s += `<circle cx="${pt.x}" cy="${pt.y}" r="${u.partners.length ? 4.5 : 6}" fill="${u.partners.length ? c.line : c.card}" stroke="${c.line}" stroke-width="2"/>`;
  }
  return s;
}

function linkPath(l, a, b) {
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const bow = Math.min(150, len * 0.3 + 30);
  const cx = mx - (dy / len) * bow, cy = my + (dx / len) * bow;
  return { d: `M${a.x},${a.y} Q${cx},${cy} ${b.x},${b.y}`, lx: (a.x + 2 * cx + b.x) / 4, ly: (a.y + 2 * cy + b.y) / 4 };
}

// Returns SVG markup (without the outer <svg>) for the whole tree.
// opts.photo(id) -> href string or null
export function treeMarkup({ doc, view, lay, selected, multi, matches, colours = LIGHT, photo }) {
  const c = colours;
  const pos = lay.pos;
  const groups = doc.groups;
  const dim = (id) => (matches && !matches.has(id) ? ' opacity="0.22"' : '');
  let back = '';
  let mid = '';
  let cards = '';
  let labels = '';

  for (const l of view.links) {
    const { d, lx, ly } = linkPath(l, pos[l.a], pos[l.b]);
    back += `<path d="${d}" stroke="${esc(l.colour)}" stroke-width="2.5" fill="none" stroke-dasharray="6 5" stroke-linecap="round"/>`;
    if (l.label) {
      const t = esc(fit(l.label, `600 13px ${UI_FONT}`, 160));
      labels += `<text x="${lx}" y="${ly + 4}" text-anchor="middle" font-family="${UI_FONT}" font-size="13" font-weight="600" fill="${esc(l.colour)}" stroke="${c.halo}" stroke-width="5" paint-order="stroke" stroke-linejoin="round">${t}</text>`;
    }
  }

  for (const u of view.unions) {
    const pt = lay.unionPts[u.id];
    if (u.partners.length === 2) mid += partnerLine(u, pos[u.partners[0]], pos[u.partners[1]], c);
    mid += childLines(u, pt, pos, c, lay.busY && lay.busY[u.id], lay.childX);
  }

  for (const id of Object.keys(view.people)) {
    const p = view.people[id];
    const { x, y } = pos[id];
    const gx = x - CARD_W / 2, gy = y - CARD_H / 2;
    const sel = selected === id || (multi && multi.has(id));
    const pg = (p.groups || []).map((g) => groups[g]).filter((g) => g && !g.deleted);
    let stripes = '';
    pg.slice(0, 3).forEach((g, i) => {
      stripes += `<rect x="${i * 7}" y="0" width="7" height="${CARD_H}" fill="${esc(g.colour)}"/>`;
    });
    const href = p.photo ? photo(p.photo) : null;
    const px = 14 + Math.min(pg.length, 3) * 7 + 24;
    const photoEl = href
      ? `<circle cx="${px}" cy="36" r="25" fill="${c.photoBg}"/><image href="${esc(href)}" x="${px - 24}" y="12" width="48" height="48" preserveAspectRatio="xMidYMid slice" clip-path="url(#ph${Math.min(pg.length, 3)})"/>`
      : `<circle cx="${px}" cy="36" r="24" fill="${pg[0] ? esc(pg[0].colour) : c.photoBg}" fill-opacity="${pg[0] ? 0.18 : 1}"/><text x="${px}" y="42" text-anchor="middle" font-family="${FONT}" font-size="17" font-weight="700" fill="${pg[0] ? esc(pg[0].colour) : c.muted}">${esc(initials(p.name))}</text>`;
    const tx = px + 34;
    const maxW = CARD_W - tx - 10;
    const name = esc(fit(p.name || 'Unnamed', `700 15px ${FONT}`, maxW));
    const sub = [p.aka, lifespan(p)].filter(Boolean);
    let lines = `<text x="${tx}" y="${sub.length ? 31 : 41}" font-family="${FONT}" font-size="15" font-weight="700" fill="${c.text}">${name}</text>`;
    if (sub[0]) lines += `<text x="${tx}" y="49" font-family="${UI_FONT}" font-size="11.5" fill="${c.muted}" ${p.aka && sub[0] === p.aka ? 'font-style="italic"' : ''}>${esc(fit(sub[0], `11.5px ${UI_FONT}`, maxW))}</text>`;
    if (sub[1]) lines += `<text x="${tx}" y="63" font-family="${UI_FONT}" font-size="11.5" fill="${c.muted}">${esc(fit(sub[1], `11.5px ${UI_FONT}`, maxW))}</text>`;
    const notes = p.notes && p.notes.trim()
      ? `<path d="M${CARD_W - 18},8 h10 v10 h-10z M${CARD_W - 16},11.5 h6 M${CARD_W - 16},14.5 h6" stroke="${c.muted}" stroke-width="1.2" fill="none"/>` : '';
    cards += `<g class="card" data-id="${id}" transform="translate(${gx},${gy})"${dim(id)}>`
      + `<rect x="1" y="3" width="${CARD_W}" height="${CARD_H}" rx="12" fill="#000" fill-opacity="0.07"/>`
      + `<g clip-path="url(#cardClip)"><rect width="${CARD_W}" height="${CARD_H}" fill="${c.card}"/>${stripes}</g>`
      + `<rect width="${CARD_W}" height="${CARD_H}" rx="12" fill="none" stroke="${sel ? c.accent : c.cardLine}" stroke-width="${sel ? 3 : 1.2}"/>`
      + photoEl + lines + notes + '</g>';
  }

  return `<g class="links">${back}</g><g class="lines">${mid}</g><g class="cards">${cards}</g><g class="labels">${labels}</g>`;
}

export function defsMarkup() {
  let s = `<clipPath id="cardClip"><rect width="${CARD_W}" height="${CARD_H}" rx="12"/></clipPath>`;
  for (let i = 0; i <= 3; i++) s += `<clipPath id="ph${i}"><circle cx="${14 + i * 7 + 24}" cy="36" r="24"/></clipPath>`;
  return s;
}
