// Colour themes: a button/highlight colour ("accent") and a gradient background
// generated from one chosen colour. Each tree can have its own look; otherwise
// it uses the device's usual look (set in Settings).

import { h } from './ui.js';

export const ACCENTS = [
  { id: 'blue', name: 'Blue', light: '#2563eb', dark: '#60a5fa' },
  { id: 'sky', name: 'Sky', light: '#0284c7', dark: '#38bdf8' },
  { id: 'indigo', name: 'Indigo', light: '#4f46e5', dark: '#818cf8' },
  { id: 'purple', name: 'Purple', light: '#7c3aed', dark: '#a78bfa' },
  { id: 'pink', name: 'Pink', light: '#db2777', dark: '#f472b6' },
  { id: 'red', name: 'Red', light: '#dc2626', dark: '#f87171' },
  { id: 'orange', name: 'Orange', light: '#ea580c', dark: '#fb923c' },
  { id: 'gold', name: 'Gold', light: '#b45309', dark: '#fbbf24' },
  { id: 'green', name: 'Green', light: '#16a34a', dark: '#4ade80' },
  { id: 'teal', name: 'Teal', light: '#0d9488', dark: '#2dd4bf' },
  { id: 'slate', name: 'Slate', light: '#475569', dark: '#94a3b8' },
];

export const BG_COLOURS = [
  '#3b82f6', '#0ea5e9', '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e',
  '#f97316', '#eab308', '#22c55e', '#14b8a6', '#64748b', '#a16207',
];

export const BG_STYLES = [
  ['soft', 'Soft'],
  ['diagonal', 'Diagonal'],
  ['glow', 'Glow'],
  ['blend', 'Blend'],
  ['bold', 'Bold'],
  ['plain', 'Plain'],
];

export const DEFAULT_LOOK = { accent: 'blue', bg: { colour: '#3b82f6', style: 'soft', dots: true } };

const LOOK_KEY = 'ftc.look';

export function usualLook() {
  try {
    const v = JSON.parse(localStorage.getItem(LOOK_KEY));
    if (v && v.bg) return { ...DEFAULT_LOOK, ...v, bg: { ...DEFAULT_LOOK.bg, ...v.bg } };
  } catch { /* ignore */ }
  return structuredClone(DEFAULT_LOOK);
}

// The usual look syncs between devices (see sync.js, settings.json in the repo).
const LOOK_DIRTY = 'ftc.look.dirty';
let lookListener = null;
export function onUsualLookEdited(fn) { lookListener = fn; }

// Saved after she edits it here: marked to send to GitHub.
export function setUsualLook(look) {
  localStorage.setItem(LOOK_KEY, JSON.stringify({ ...look, updatedAt: Date.now() }));
  localStorage.setItem(LOOK_DIRTY, '1');
  if (lookListener) lookListener();
}

// Saved after it arrived from another device.
export function storeSyncedLook(look) {
  localStorage.setItem(LOOK_KEY, JSON.stringify(look));
  localStorage.removeItem(LOOK_DIRTY);
}

export const usualLookDirty = () => localStorage.getItem(LOOK_DIRTY) === '1';
export const markUsualLookSent = () => localStorage.removeItem(LOOK_DIRTY);
export function usualLookTime() {
  try { return JSON.parse(localStorage.getItem(LOOK_KEY))?.updatedAt || 0; } catch { return 0; }
}

// ---------- colour maths ----------

function hexToHsl(hex) {
  let m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) m = ['', '3b82f6'];
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let hh = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) hh = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) hh = (b - r) / d + 2;
    else hh = (r - g) / d + 4;
    hh *= 60;
  }
  return [hh, s * 100, l * 100];
}

const hsl = (hh, s, l) => `hsl(${Math.round(((hh % 360) + 360) % 360)}, ${Math.round(Math.max(0, Math.min(100, s)))}%, ${Math.round(Math.max(0, Math.min(100, l)))}%)`;

export function isDark() {
  const t = document.documentElement.dataset.theme;
  if (t === 'dark') return true;
  if (t === 'light') return false;
  return matchMedia('(prefers-color-scheme: dark)').matches;
}

// Accent colours for the current mode.
export function accentColours(accent, dark) {
  const preset = ACCENTS.find((a) => a.id === accent);
  let main;
  if (preset) main = dark ? preset.dark : preset.light;
  else {
    const [hh, s, l] = hexToHsl(accent);
    main = dark ? hsl(hh, s, Math.max(l, 68)) : hsl(hh, s, Math.min(l, 48));
  }
  const [hh, s] = hexToHsl(preset ? preset.light : accent);
  return {
    accent: main,
    soft: dark ? hsl(hh, s * 0.45, 22) : hsl(hh, s * 0.85, 92),
    ink: dark ? '#0b1220' : '#ffffff',
  };
}

// Describes the background gradient for a colour + style, in either mode.
export function gradientSpec(bg, dark) {
  const [hh, s0] = hexToHsl(bg.colour);
  const s = Math.min(s0, 82);
  const L = (light, dk) => (dark ? dk : light);
  switch (bg.style) {
    case 'diagonal':
      return { kind: 'linear', angle: 135, stops: [hsl(hh, s * 0.8, L(95, 12)), hsl(hh + 35, s * 0.8, L(83, 22))] };
    case 'glow':
      return { kind: 'radial', stops: [hsl(hh, s * 0.6, L(98, 24)), hsl(hh, s * 0.85, L(82, 9))] };
    case 'blend':
      return { kind: 'linear', angle: 120, stops: [hsl(hh - 40, s * 0.75, L(91, 15)), hsl(hh, s * 0.75, L(87, 19)), hsl(hh + 40, s * 0.75, L(90, 15))] };
    case 'bold':
      return {
        kind: 'linear', angle: 145, stops: [hsl(hh, s, L(62, 34)), hsl(hh + 25, s, L(44, 17))],
        line: L(hsl(hh, 35, 18), hsl(hh, 30, 85)), dots: 'rgba(255,255,255,0.14)',
      };
    case 'plain':
      return { kind: 'linear', angle: 180, stops: [hsl(hh, s * 0.35, L(96, 12)), hsl(hh, s * 0.35, L(96, 12))] };
    case 'soft':
    default:
      return { kind: 'linear', angle: 180, stops: [hsl(hh, s * 0.7, L(97, 13)), hsl(hh, s * 0.8, L(86, 21))] };
  }
}

export function gradientCss(spec) {
  if (spec.kind === 'radial') return `radial-gradient(circle at 50% 35%, ${spec.stops.join(', ')})`;
  return `linear-gradient(${spec.angle}deg, ${spec.stops.join(', ')})`;
}

// SVG version of the same gradient (for exports).
export function gradientSvg(spec, id) {
  const stops = spec.stops.map((c, i) => `<stop offset="${spec.stops.length > 1 ? i / (spec.stops.length - 1) : 0}" stop-color="${c}"/>`).join('');
  if (spec.kind === 'radial') return `<radialGradient id="${id}" cx="0.5" cy="0.35" r="0.85">${stops}</radialGradient>`;
  const a = (spec.angle * Math.PI) / 180;
  const dx = Math.sin(a) / 2, dy = -Math.cos(a) / 2;
  return `<linearGradient id="${id}" x1="${0.5 - dx}" y1="${0.5 - dy}" x2="${0.5 + dx}" y2="${0.5 + dy}">${stops}</linearGradient>`;
}

// ---------- applying ----------

let current = DEFAULT_LOOK;

export function applyLook(look) {
  current = look || usualLook();
  const dark = isDark();
  const root = document.documentElement.style;
  const a = accentColours(current.accent, dark);
  root.setProperty('--accent', a.accent);
  root.setProperty('--accent-soft', a.soft);
  root.setProperty('--accent-ink', a.ink);
  const spec = gradientSpec(current.bg, dark);
  root.setProperty('--canvas-bg', gradientCss(spec));
  if (spec.line) root.setProperty('--line', spec.line); else root.removeProperty('--line');
  if (spec.dots) root.setProperty('--dots', spec.dots); else root.removeProperty('--dots');
  document.getElementById('canvas')?.classList.toggle('dotted', current.bg.dots !== false);
  const meta = document.querySelectorAll('meta[name="theme-color"]');
  meta.forEach((m) => m.setAttribute('content', getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()));
}

export const currentLook = () => current;

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyLook(current));

// ---------- picker ----------

// A panel of controls for choosing a look. onChange(newLook) is called on every change.
export function lookEditor(look, onChange) {
  const box = h('div', { class: 'sec' });
  const draw = () => {
    const set = (patch) => {
      look = { ...look, ...patch, bg: { ...look.bg, ...(patch.bg || {}) } };
      onChange(look);
      draw();
    };
    const dark = isDark();
    const a = accentColours(look.accent, dark);
    const preview = h('div', { class: 'theme-preview', style: { background: gradientCss(gradientSpec(look.bg, dark)) } },
      h('span', {}, 'Character'), h('b', { style: { background: a.accent, color: a.ink } }, 'Button'));

    const customAccent = !ACCENTS.some((x) => x.id === look.accent);
    const accents = h('div', { class: 'accent-swatches' },
      ACCENTS.map((x) => h('button', {
        class: 'swatch', type: 'button', title: x.name, 'aria-label': x.name, 'aria-pressed': String(look.accent === x.id),
        style: { background: dark ? x.dark : x.light }, onclick: () => set({ accent: x.id }),
      })),
      h('label', { class: 'custom-colour' + (customAccent ? ' on' : ''), title: 'Pick any colour' },
        h('input', { type: 'color', 'aria-label': 'Pick any button colour', value: customAccent ? look.accent : '#2563eb', onchange: (e) => set({ accent: e.target.value }) })));

    const customBg = !BG_COLOURS.includes(look.bg.colour);
    const bgColours = h('div', { class: 'colour-row' },
      BG_COLOURS.map((c) => h('button', {
        class: 'swatch', type: 'button', 'aria-label': c, 'aria-pressed': String(look.bg.colour === c), style: { background: c, width: '36px', height: '36px' },
        onclick: () => set({ bg: { colour: c } }),
      })),
      h('label', { class: 'custom-colour small' + (customBg ? ' on' : ''), title: 'Pick any colour' },
        h('input', { type: 'color', 'aria-label': 'Pick any background colour', value: look.bg.colour, onchange: (e) => set({ bg: { colour: e.target.value } }) })));

    const styles = h('div', { class: 'bg-styles' }, BG_STYLES.map(([id, name]) => h('button', {
      class: 'bg-style', type: 'button', 'aria-pressed': String(look.bg.style === id), onclick: () => set({ bg: { style: id } }),
    }, h('span', { class: 'tile', style: { background: gradientCss(gradientSpec({ ...look.bg, style: id }, dark)) } }), name)));

    const dots = h('input', { type: 'checkbox', checked: look.bg.dots !== false, onchange: (e) => set({ bg: { dots: e.target.checked } }) });

    box.replaceChildren(
      preview,
      h('h3', {}, 'Button colour'), accents,
      h('h3', {}, 'Background colour'), bgColours,
      h('h3', {}, 'Background style'), styles,
      h('label', { class: 'toggle-row' }, 'Dotted grid', dots));
  };
  draw();
  return box;
}
