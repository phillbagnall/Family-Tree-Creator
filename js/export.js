// Save the tree as a picture (PNG), PDF or SVG.

import * as store from './store.js';
import { layout, CARD_W, CARD_H } from './layout.js';
import { treeMarkup, defsMarkup, LIGHT, FONT, UI_FONT } from './render.js';
import { h, openSheet, closeSheet, toast } from './ui.js';
import { gradientSpec, gradientSvg, usualLook } from './theme.js';

const MARGIN = 60;
const HEADER = 70;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fileName(app, ext) {
  return `${(app.doc.meta.name || 'family tree').replace(/[^\w\- ]+/g, '').trim() || 'family tree'}.${ext}`;
}

export async function buildSvg(app, { photos, background = true }) {
  const view = app.view;
  const offs = {};
  for (const [id, o] of Object.entries(app.doc.positions)) if (!o.deleted) offs[id] = o;
  const lay = layout(view, offs);
  const b = lay.bounds;
  const W = Math.ceil(b.w + MARGIN * 2);
  const H = Math.ceil(b.h + MARGIN * 2 + HEADER);
  const ox = MARGIN - b.x;
  const oy = MARGIN + HEADER - b.y;

  const dataUrls = {};
  if (photos === 'inline') {
    for (const p of Object.values(view.people)) if (p.photo) dataUrls[p.photo] = await store.imageDataUrl(p.photo, app.doc.id);
  }
  const look = app.doc.meta.theme || usualLook();
  const spec = background ? gradientSpec(look.bg, false) : null;
  const colours = { ...LIGHT, line: (spec && spec.line) || LIGHT.line };
  const titleColour = spec && spec.line ? spec.line : LIGHT.text;
  const markup = treeMarkup({
    doc: app.doc, view, lay, selected: null, matches: null, colours,
    photo: (id) => (photos === 'inline' ? dataUrls[id] : null),
  });
  const m = app.doc.meta;
  const title = `<text x="${MARGIN}" y="${MARGIN + 30}" font-family="${FONT}" font-size="34" font-weight="700" fill="${titleColour}">${esc(m.name)}</text>`
    + (m.author ? `<text x="${MARGIN}" y="${MARGIN + 56}" font-family="${UI_FONT}" font-size="16" fill="${titleColour}" fill-opacity="0.75">${esc(m.author)}</text>` : '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
    + `<defs>${defsMarkup()}${spec ? gradientSvg(spec, 'bgGrad') : ''}</defs><rect width="${W}" height="${H}" fill="${spec ? 'url(#bgGrad)' : '#ffffff'}"/>${title}`
    + `<g transform="translate(${ox},${oy})">${markup}</g></svg>`;
  return { svg, W, H, ox, oy, lay, view };
}

function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('Could not draw the tree'));
    img.src = src;
  });
}

// Draw the vector tree into a canvas, then paint photos on top.
// (Photos are added separately because some browsers won't draw pictures nested inside an SVG.)
export async function buildCanvas(app, withPhotos, background = true) {
  const { svg, W, H, ox, oy, lay, view } = await buildSvg(app, { photos: 'none', background });
  const maxPixels = 24e6;
  const scale = Math.max(0.5, Math.min(3, Math.sqrt(maxPixels / (W * H)), 16000 / W, 16000 / H));
  const c = document.createElement('canvas');
  c.width = Math.round(W * scale);
  c.height = Math.round(H * scale);
  const ctx = c.getContext('2d');
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = await loadImage(url);
    ctx.drawImage(img, 0, 0, c.width, c.height);
  } finally {
    URL.revokeObjectURL(url);
  }
  if (withPhotos) {
    ctx.scale(scale, scale);
    for (const p of Object.values(view.people)) {
      if (!p.photo) continue;
      const src = await store.imageUrl(p.photo, app.doc.id);
      if (!src) continue;
      const img = await loadImage(src).catch(() => null);
      if (!img) continue;
      const stripes = Math.min((p.groups || []).filter((g) => app.doc.groups[g] && !app.doc.groups[g].deleted).length, 3);
      const pos = lay.pos[p.id];
      const cx = pos.x - CARD_W / 2 + 14 + stripes * 7 + 24 + ox;
      const cy = pos.y - CARD_H / 2 + 36 + oy;
      const r = 24;
      const s = Math.max((2 * r) / img.width, (2 * r) / img.height);
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(img, cx - (img.width * s) / 2, cy - (img.height * s) / 2, img.width * s, img.height * s);
      ctx.restore();
    }
  }
  return { canvas: c, W, H };
}

async function deliver(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  const touch = matchMedia('(pointer: coarse)').matches;
  if (touch && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}

let jspdfP = null;
function loadJsPdf() {
  if (window.jspdf) return Promise.resolve(window.jspdf);
  jspdfP = jspdfP || new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'vendor/jspdf.umd.min.js';
    s.onload = () => res(window.jspdf);
    s.onerror = () => rej(new Error('Could not load the PDF maker'));
    document.head.append(s);
  });
  return jspdfP;
}

async function exportAs(app, kind, withPhotos, background) {
  toast('Preparing…', 10000);
  try {
    if (kind === 'svg') {
      const { svg } = await buildSvg(app, { photos: withPhotos ? 'inline' : 'none', background });
      await deliver(new Blob([svg], { type: 'image/svg+xml' }), fileName(app, 'svg'));
    } else if (kind === 'png') {
      const { canvas } = await buildCanvas(app, withPhotos, background);
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
      await deliver(blob, fileName(app, 'png'));
    } else {
      const [{ jsPDF }, { canvas, W, H }] = await Promise.all([loadJsPdf(), buildCanvas(app, withPhotos, background)]);
      // Page sized to the tree (in points), kept within PDF limits.
      let pw = W * 0.75, ph = H * 0.75;
      const shrink = Math.min(1, 14000 / pw, 14000 / ph);
      pw *= shrink; ph *= shrink;
      const pdf = new jsPDF({ orientation: pw > ph ? 'landscape' : 'portrait', unit: 'pt', format: [pw, ph], compress: true });
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, pw, ph);
      pdf.setProperties({ title: app.doc.meta.name, creator: 'Family Tree Creator' });
      await deliver(pdf.output('blob'), fileName(app, 'pdf'));
    }
    toast('Done');
  } catch (e) {
    console.error(e);
    toast(e.message || 'Export failed');
  }
}

export function openExport(app) {
  const photos = h('input', { type: 'checkbox', checked: true });
  const bg = h('input', { type: 'checkbox', checked: true });
  const btn = (kind, label, sub) => h('button', { class: 'btn big', type: 'button', style: { flexDirection: 'column', alignItems: 'flex-start' }, onclick: () => { closeSheet(); exportAs(app, kind, photos.checked, bg.checked); } },
    h('span', {}, label), h('span', { class: 'hint', style: { fontWeight: 400 } }, sub));
  const hidden = app.doc.meta.spoilers ? h('p', { class: 'hint' }, 'Spoiler protection is on, so characters you haven\'t reached are left out.') : null;
  openSheet('Save or share', [
    h('div', { class: 'sec' },
      btn('png', 'Picture (PNG)', 'Best for sharing in messages or setting as a wallpaper'),
      btn('pdf', 'PDF', 'Best for printing'),
      btn('svg', 'SVG', 'Sharp at any size; opens in browsers and design apps')),
    h('label', { class: 'toggle-row' }, 'Include photos', photos),
    h('label', { class: 'toggle-row' }, 'Include coloured background (off = white, saves ink)', bg),
    hidden,
  ], { short: true });
}
