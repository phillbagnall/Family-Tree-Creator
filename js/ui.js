// Small UI helpers: element builder, slide-in sheet, dialogs, toasts, photo picking.

export const $ = (id) => document.getElementById(id);

// h('div', {class: 'x', onclick: fn}, child, 'text', [more])
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) {
        if (sk.startsWith('--')) el.style.setProperty(sk, sv);
        else el.style[sk] = sv;
      }
    }
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = v;
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = (c) => {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  kids.forEach(add);
  return el;
}

export const icon = (name) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.innerHTML = `<use href="#i-${name}"/>`;
  return s;
};

// ---------- sheet ----------
let sheetCleanup = null;

export function openSheet(title, body, { short = false, onClose } = {}) {
  closeSheet(true);
  $('sheetTitle').textContent = title;
  const b = $('sheetBody');
  b.replaceChildren(...(Array.isArray(body) ? body : [body]).filter((x) => x != null && x !== false));
  b.scrollTop = 0;
  $('sheet').classList.toggle('short', short);
  $('sheet').hidden = false;
  $('scrim').hidden = !isPhone();
  sheetCleanup = onClose || null;
}

export function closeSheet(silent) {
  if ($('sheet').hidden) return;
  if (document.activeElement && $('sheet').contains(document.activeElement)) document.activeElement.blur();
  $('sheet').hidden = true;
  $('scrim').hidden = true;
  const fn = sheetCleanup;
  sheetCleanup = null;
  if (fn) fn(silent);
}

export const sheetOpen = () => !$('sheet').hidden;
export const isPhone = () => window.matchMedia('(max-width: 720px)').matches;

$('sheetClose').addEventListener('click', () => closeSheet());
$('scrim').addEventListener('click', () => closeSheet());
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && sheetOpen() && !$('modal').open) closeSheet();
});

// Swipe the sheet's grip down to close on phones.
{
  let y0 = null;
  const grip = $('sheet');
  grip.addEventListener('touchstart', (e) => {
    const t = e.target;
    if (t.closest('.sheet-grip') || t.closest('.sheet-head')) y0 = e.touches[0].clientY;
  }, { passive: true });
  grip.addEventListener('touchend', (e) => {
    if (y0 != null && e.changedTouches[0].clientY - y0 > 70) closeSheet();
    y0 = null;
  });
}

// ---------- modal dialogs ----------

// fields: [{name, label, value, type, placeholder, options:[[v,l]]}]
// buttons: [{label, value, primary, danger}]
export function modal({ title, text, fields = [], buttons, body }) {
  const dlg = $('modal');
  const form = $('modalForm');
  buttons = buttons || [{ label: 'Cancel', value: '' }, { label: 'OK', value: 'ok', primary: true }];
  const inputs = {};
  const kids = [h('h2', {}, title)];
  if (text) kids.push(h('p', {}, text));
  if (body) kids.push(body);
  for (const f of fields) {
    let inp;
    if (f.options) inp = h('select', { name: f.name }, f.options.map(([v, l]) => h('option', { value: v, selected: v === f.value }, l)));
    else inp = h('input', { name: f.name, type: f.type || 'text', value: f.value ?? '', placeholder: f.placeholder || '', autocomplete: 'off' });
    inputs[f.name] = inp;
    kids.push(h('label', {}, f.label, inp));
  }
  kids.push(h('div', { class: 'modal-actions' }, buttons.map((b) =>
    h('button', { class: `btn${b.primary ? ' primary' : ''}${b.danger ? ' danger' : ''}`, value: b.value, type: b.value === '' ? 'button' : 'submit', onclick: b.value === '' ? () => dlg.close('') : null }, b.label))));
  form.replaceChildren(...kids);
  return new Promise((resolve) => {
    dlg.returnValue = '';
    dlg.onclose = () => {
      const v = dlg.returnValue;
      if (!v) return resolve(null);
      const values = {};
      for (const [k, el] of Object.entries(inputs)) values[k] = el.value;
      resolve({ button: v, values });
    };
    dlg.showModal();
    const first = Object.values(inputs)[0];
    if (first) setTimeout(() => { first.focus(); first.select && first.select(); }, 50);
  });
}

export async function confirmBox(title, text, okLabel = 'OK', danger = false) {
  const r = await modal({ title, text, buttons: [{ label: 'Cancel', value: '' }, { label: okLabel, value: 'ok', primary: !danger, danger }] });
  return !!r;
}

export async function askText(title, label, value = '', okLabel = 'Save', placeholder = '') {
  const r = await modal({ title, fields: [{ name: 'v', label, value, placeholder }], buttons: [{ label: 'Cancel', value: '' }, { label: okLabel, value: 'ok', primary: true }] });
  return r ? r.values.v.trim() : null;
}

// ---------- toast ----------
let toastTimer;
export function toast(msg, ms = 2600) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// ---------- photos ----------
export function pickFile() {
  const inp = $('filePick');
  inp.value = '';
  return new Promise((resolve) => {
    inp.onchange = () => resolve(inp.files[0] || null);
    inp.click();
  });
}

// Shrinks a photo to at most `max` px on its longest side and returns a JPEG blob.
export async function resizeImage(file, max = 720) {
  let src;
  try {
    src = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    src = await new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error('That file is not a picture this device can read'));
      img.src = URL.createObjectURL(file);
    });
  }
  const w0 = src.width, h0 = src.height;
  const s = Math.min(1, max / Math.max(w0, h0));
  const c = document.createElement('canvas');
  c.width = Math.round(w0 * s);
  c.height = Math.round(h0 * s);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob(res, 'image/jpeg', 0.85));
}

export function timeAgo(t) {
  if (!t) return '';
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = new Date(t);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}
