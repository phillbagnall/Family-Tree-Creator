// App start-up, screens (setup, PIN lock, library) and the tree canvas.

import * as auth from './auth.js';
import * as store from './store.js';
import * as sync from './sync.js';
import * as M from './model.js';
import { GitHub } from './github.js';
import { layout, GRID, CARD_W, CARD_H } from './layout.js';
import { treeMarkup, defsMarkup, initials } from './render.js';
import { Viewport } from './viewport.js';
import { $, h, icon, openSheet, closeSheet, sheetOpen, modal, confirmBox, askText, toast, timeAgo, isPhone } from './ui.js';
import { openPerson, openTreeSettings, openProgress, addPersonFlow } from './editor.js';
import { openExport } from './export.js';
import * as theme from './theme.js';
import { openFeedback } from './feedback.js';
import { APP_VERSION } from './version.js';

const DEFAULT_REPO = 'phillbagnall/family-trees';

export const app = {
  doc: null,        // the open tree
  view: null,
  lay: null,
  selected: null,
  matches: null,
  vp: null,
};

// ---------------- screens ----------------

function show(id) {
  for (const s of ['setup', 'lock', 'library', 'tree']) $(s).hidden = s !== id;
  if (id !== 'tree') closeSheet(true);
}

async function boot() {
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  const s = auth.session();
  if (s) return connected(s);
  if (auth.isSetUp()) return showLock();
  showSetup();
}

function showSetup() {
  show('setup');
  $('setupRepo').value = auth.repoName() || DEFAULT_REPO;
  const [owner] = $('setupRepo').value.split('/');
  $('patLink').href = `https://github.com/settings/personal-access-tokens/new?name=Family+Tree+Creator&description=Lets+the+Family+Tree+Creator+app+save+trees&target_name=${encodeURIComponent(owner)}&expires_in=none&contents=write`;
}

$('setupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const repo = $('setupRepo').value.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, '');
  const token = $('setupKey').value.trim();
  const pin = $('setupPin').value;
  const err = $('setupError');
  err.textContent = '';
  if (!/^\d{4,8}$/.test(pin)) return (err.textContent = 'The PIN should be 4 to 8 numbers.');
  if (pin !== $('setupPin2').value) return (err.textContent = "The two PINs don't match.");
  const [owner, name] = repo.split('/');
  $('setupGo').disabled = true;
  $('setupGo').textContent = 'Checking…';
  try {
    await new GitHub({ owner, repo: name, token }).checkRepo();
    await auth.save({ token, repo, pin });
    $('setupKey').value = $('setupPin').value = $('setupPin2').value = '';
    connected({ token, repo });
  } catch (ex) {
    err.textContent = ex.status === 401 ? "GitHub didn't accept that key. Check it was copied fully."
      : ex.status === 404 ? "Couldn't find that repository with this key. Check the name and that the key includes it."
        : ex.status === 0 ? 'No internet connection. Connect and try again.'
          : ex.message;
  } finally {
    $('setupGo').disabled = false;
    $('setupGo').textContent = 'Connect';
  }
});

function showLock() {
  show('lock');
  $('lockPin').value = '';
  $('lockError').textContent = '';
  setTimeout(() => $('lockPin').focus(), 50);
}

$('lockForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const wait = auth.lockoutRemaining();
  if (wait) return ($('lockError').textContent = `Too many tries. Wait ${wait} seconds.`);
  try {
    const s = await auth.unlock($('lockPin').value);
    connected(s);
  } catch (ex) {
    $('lockPin').value = '';
    const w = auth.lockoutRemaining();
    $('lockError').textContent = w ? `Too many tries. Wait ${w} seconds.` : "That PIN isn't right.";
  }
});

$('forgotPin').addEventListener('click', async () => {
  const ok = await confirmBox('Forgot your PIN?', "You'll need to paste the GitHub access key again and choose a new PIN. Your trees are safe on GitHub.", 'Reconnect');
  if (!ok) return;
  auth.forget();
  showSetup();
});

async function connected({ token, repo }) {
  const [owner, name] = repo.split('/');
  const wanted = (location.hash.match(/tree=(\w+)/) || [])[1];
  sync.start({ owner, repo: name, token });
  await showLibrary();
  sync.syncAll().then(capitaliseOldNames);
  if (wanted && (await store.getTree(wanted))) openTree(wanted);
}

// Names typed before auto-capitals existed get capitalised once per tree.
async function capitaliseOldNames() {
  let changed = false;
  for (const rec of await store.allTrees()) {
    if (app.doc && app.doc.id === rec.id) continue; // the open tree is handled in openTree
    if (M.capitaliseAllNames(rec.doc)) { await sync.saveLocal(rec.doc); changed = true; }
  }
  if (changed) { sync.syncAll(); if (!$('library').hidden) renderLibrary(); }
}

// ---------------- library ----------------

let libRefreshPending = false;

async function showLibrary() {
  app.doc = null;
  theme.applyLook(theme.usualLook());
  show('library');
  history.replaceState(null, '', location.pathname);
  await renderLibrary();
}

async function renderLibrary() {
  const recs = await store.allTrees();
  const live = recs.filter((r) => !r.doc.meta.deleted).sort((a, b) => (b.doc.meta.updatedAt || 0) - (a.doc.meta.updatedAt || 0));
  const gone = recs.filter((r) => r.doc.meta.deleted);
  const grid = $('libGrid');
  grid.replaceChildren(
    h('button', { class: 'tree-card new', onclick: newTree }, icon('plus'), h('b', {}, 'New family tree'), h('span', { class: 'hint' }, 'One for each book or series')),
    ...live.map(treeCard),
  );
  $('libDeleted').hidden = !gone.length;
  $('libDeletedGrid').replaceChildren(...gone.map((r) =>
    h('div', { class: 'tree-card' }, h('h3', {}, r.doc.meta.name), h('div', { class: 'meta' }, `${M.live(r.doc.people).length} characters`),
      h('button', { class: 'btn small', onclick: () => restoreTree(r.id) }, 'Restore'))));
}

function treeCard(rec) {
  const s = M.summary(rec.doc);
  const faces = h('div', { class: 'faces' });
  const ppl = M.live(rec.doc.people);
  const withPhoto = ppl.filter((p) => p.photo).slice(0, 5);
  const shown = withPhoto.length ? withPhoto : ppl.slice(0, 5);
  for (const p of shown) {
    const span = h('span', {}, p.photo ? '' : initials(p.name));
    if (p.photo) store.imageUrl(p.photo, rec.id).then((u) => { if (u) span.style.backgroundImage = `url("${u}")`; });
    faces.append(span);
  }
  return h('button', { class: 'tree-card', onclick: () => openTree(rec.id) },
    h('h3', {}, s.name),
    s.author ? h('div', { class: 'hint' }, s.author) : null,
    shown.length ? faces : null,
    h('div', { class: 'meta' }, `${s.count} character${s.count === 1 ? '' : 's'} · ${timeAgo(rec.doc.meta.updatedAt)}`));
}

async function newTree() {
  const r = await modal({
    title: 'New family tree',
    fields: [
      { name: 'name', label: 'Book or series', placeholder: 'e.g. The Lord of the Rings' },
      { name: 'author', label: 'Author (optional)', placeholder: 'e.g. J.R.R. Tolkien' },
    ],
    buttons: [{ label: 'Cancel', value: '' }, { label: 'Create', value: 'ok', primary: true }],
  });
  if (!r) return;
  const doc = M.newTree(r.values.name.trim() || 'Untitled tree');
  doc.meta.author = r.values.author.trim();
  await sync.saveLocal(doc);
  openTree(doc.id);
}

async function restoreTree(id) {
  const rec = await store.getTree(id);
  M.setMeta(rec.doc, { deleted: false });
  await sync.saveLocal(rec.doc);
  renderLibrary();
  toast('Tree restored');
}

$('libSettings').addEventListener('click', openAppSettings);

function openAppSettings() {
  const s = auth.session();
  const themeMode = localStorage.getItem('ftc.theme') || 'auto';
  openSheet('Settings', [
    h('div', { class: 'sec' },
      h('h3', {}, 'Saving'),
      h('p', { class: 'hint' }, `Trees are saved to github.com/${s.repo}. ${sync.state.lastSync ? 'Last synced ' + timeAgo(sync.state.lastSync) + '.' : ''}`),
      h('button', { class: 'btn', onclick: () => { sync.syncAll(); toast('Syncing…'); } }, 'Sync now')),
    h('div', { class: 'sec' },
      h('h3', {}, 'Ideas & problems'),
      h('button', { class: 'btn', onclick: () => openFeedback(app) }, '💡 Suggest an improvement')),
    h('div', { class: 'sec' },
      h('h3', {}, 'Light or dark'),
      modeSwitch(themeMode)),
    h('div', { class: 'sec' },
      h('h3', {}, 'My usual look'),
      h('p', { class: 'hint' }, 'Used for the trees page and any tree without its own look, on all your devices. Each tree can also have its own look in its settings.'),
      theme.lookEditor(theme.usualLook(), (look) => { theme.setUsualLook(look); theme.applyLook(look); })),
    h('div', { class: 'sec' },
      h('h3', {}, 'Security'),
      h('button', { class: 'btn', onclick: changePin }, 'Change PIN'),
      h('button', { class: 'btn', onclick: replaceKey }, 'Replace GitHub access key'),
      h('button', { class: 'btn', onclick: () => { auth.lock(); sync.stop(); closeSheet(); showLock(); } }, 'Lock now')),
    h('div', { class: 'sec danger-zone' },
      h('h3', {}, 'This device'),
      h('p', { class: 'hint' }, 'Disconnecting removes the key and the copies of trees stored on this device. Trees on GitHub are not affected.'),
      h('button', { class: 'btn danger', onclick: disconnect }, 'Disconnect this device')),
  ]);
}

function setTheme(v) {
  localStorage.setItem('ftc.theme', v);
  if (v === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = v;
  theme.applyLook(theme.currentLook());
  if (app.doc) render();
}

function modeSwitch(cur) {
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Light or dark' });
  const draw = (v) => seg.replaceChildren(...[['auto', 'Match device'], ['light', 'Light'], ['dark', 'Dark']].map(([k, l]) =>
    h('button', { type: 'button', 'aria-pressed': String(k === v), onclick: () => { setTheme(k); draw(k); if (app.refreshLooks) app.refreshLooks(); } }, l)));
  draw(cur);
  return seg;
}

// The look for the open tree (its own, or the usual one).
export function applyTreeLook() {
  theme.applyLook(app.doc && app.doc.meta.theme ? app.doc.meta.theme : theme.usualLook());
}
app.applyTreeLook = applyTreeLook;

async function changePin() {
  const r = await modal({
    title: 'Change PIN',
    fields: [{ name: 'a', label: 'New PIN (4–8 numbers)', type: 'password' }, { name: 'b', label: 'New PIN again', type: 'password' }],
    buttons: [{ label: 'Cancel', value: '' }, { label: 'Change', value: 'ok', primary: true }],
  });
  if (!r) return;
  if (!/^\d{4,8}$/.test(r.values.a)) return toast('The PIN should be 4 to 8 numbers.');
  if (r.values.a !== r.values.b) return toast("The two PINs don't match.");
  await auth.changePin(r.values.a);
  toast('PIN changed');
}

async function replaceKey() {
  const s = auth.session();
  const r = await modal({
    title: 'Replace access key',
    text: 'Use this if the key has expired or been replaced on GitHub. Your trees are not affected.',
    fields: [
      { name: 'key', label: 'New access key', type: 'password', placeholder: 'github_pat_…' },
      { name: 'pin', label: 'Your PIN (or a new one, 4–8 numbers)', type: 'password' },
    ],
    buttons: [{ label: 'Cancel', value: '' }, { label: 'Replace', value: 'ok', primary: true }],
  });
  if (!r) return;
  const token = r.values.key.trim();
  if (!/^\d{4,8}$/.test(r.values.pin)) return toast('The PIN should be 4 to 8 numbers.');
  const [owner, name] = s.repo.split('/');
  try {
    await new GitHub({ owner, repo: name, token }).checkRepo();
  } catch (ex) {
    return toast(ex.status === 401 ? "GitHub didn't accept that key." : ex.status === 404 ? "That key can't see the trees repository." : ex.message);
  }
  await auth.save({ token, repo: s.repo, pin: r.values.pin });
  sync.stop();
  sync.start({ owner, repo: name, token });
  sync.syncAll();
  toast('Access key replaced');
}

async function disconnect() {
  const recs = await store.allTrees();
  const unsynced = recs.filter((r) => r.dirty).length;
  const ok = await confirmBox('Disconnect this device?',
    unsynced ? `${unsynced} tree(s) have changes that haven't reached GitHub yet and will be lost.` : 'You can reconnect any time with the access key.',
    'Disconnect', true);
  if (!ok) return;
  sync.stop();
  auth.forget();
  await store.clearAll();
  localStorage.removeItem('ftc.settings.sha');
  closeSheet();
  showSetup();
}

// ---------------- sync status ----------------

const SYNC_LABEL = { idle: 'Saved', pending: 'Saving…', syncing: 'Syncing…', offline: 'Offline', error: 'Sync problem' };
sync.on('status', (s) => {
  for (const el of document.querySelectorAll('[data-sync]')) {
    el.dataset.state = s.status;
    el.textContent = SYNC_LABEL[s.status] || '';
    el.title = s.status === 'offline' ? 'Changes are kept on this device and will sync when you are back online.' : s.message || SYNC_LABEL[s.status];
  }
});
for (const el of document.querySelectorAll('[data-sync]')) {
  el.textContent = 'Saved';
  el.addEventListener('click', () => {
    const s = sync.state;
    if (s.status === 'error') modal({ title: 'Sync problem', text: s.message, buttons: [{ label: 'Close', value: '' }, { label: 'Try again', value: 'ok', primary: true }] }).then((r) => r && sync.syncAll());
    else if (s.status === 'offline') toast('Offline: changes are kept here and will sync later');
    else sync.syncAll();
  });
}

// Usual look edited here: send to GitHub. Arrived from another device: show it.
theme.onUsualLookEdited(() => sync.scheduleSettings());
sync.on('settings', () => {
  if (!app.doc || !app.doc.meta.theme) theme.applyLook(theme.usualLook());
  if (app.doc) render();
});

sync.on('changed', async (id) => {
  if (app.doc && app.doc.id === id) {
    const rec = await store.getTree(id);
    app.doc = M.merge(app.doc, rec.doc);
    applyTreeLook();
    render();
    if (sheetOpen() && app.refreshSheet) app.refreshSheet();
  } else if (!$('library').hidden && !libRefreshPending) {
    libRefreshPending = true;
    setTimeout(() => { libRefreshPending = false; renderLibrary(); }, 300);
  }
});

// ---------------- tree view ----------------

const svg = $('canvas');
const world = $('world');
// Dot grid drawn in tree space (moves and zooms with the cards, which snap to it).
$('canvasDefs').innerHTML = defsMarkup()
  + `<pattern id="dotgrid" patternUnits="userSpaceOnUse" width="${GRID}" height="${GRID}"><circle id="gridDot" cx="${GRID / 2}" cy="${GRID / 2}" r="1.3" style="fill: var(--dots)"/></pattern>`;
const gridPattern = $('dotgrid');
const gridDot = $('gridDot');
function moveGrid({ x, y, k }) {
  gridPattern.setAttribute('patternTransform', `translate(${x},${y}) scale(${k}) translate(${-GRID / 2},${-GRID / 2})`);
  gridDot.setAttribute('r', String(Math.min(2.4, 1.4 / k)));
  $('gridRect').style.opacity = k < 0.3 ? String(Math.max(0, (k - 0.15) / 0.15)) : '1';
}

const snapping = () => !app.doc || app.doc.meta.snap !== false;

// ---- selecting several characters (box select) ----
app.multi = new Set();
const marquee = $('marquee');

function setSelectMode(on) {
  app.vp.selectMode = on;
  $('selectMode').setAttribute('aria-pressed', String(on));
  svg.classList.toggle('selecting', on);
  if (!on) app.multi.clear();
  if (on) { app.selected = null; closeSheet(true); }
  updateSelectBar();
  if (app.doc) render();
}
app.setSelectMode = setSelectMode;

function updateSelectBar() {
  const on = app.vp.selectMode || app.multi.size > 0;
  $('selectBar').hidden = !on;
  const n = app.multi.size;
  const phone = isPhone();
  $('selectCount').textContent = n
    ? (phone ? `${n} selected` : `${n} selected: drag one to move them all`)
    : (phone ? 'Draw a box' : 'Drag a box around characters, or tap them');
}

$('selectMode').addEventListener('click', () => setSelectMode(!app.vp.selectMode));
$('selectDone').addEventListener('click', () => setSelectMode(false));

// Select a set of characters (e.g. a whole branch) ready to move.
app.selectMany = (ids) => {
  setSelectMode(true);
  for (const id of ids) app.multi.add(id);
  updateSelectBar();
  render();
};

function boxRect(a, b) {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

let drag = null;
app.vp = new Viewport(svg, world, {
  changed: moveGrid,
  tap(id) {
    if (app.vp.selectMode) {
      if (id) { if (app.multi.has(id)) app.multi.delete(id); else app.multi.add(id); }
      else app.multi.clear();
      updateSelectBar();
      render();
      return;
    }
    if (id) app.select(id, { open: true });
    else if (app.selected) { app.selected = null; closeSheet(); render(); }
  },
  box(a, b) {
    const r = boxRect(a, b);
    marquee.hidden = false;
    marquee.setAttribute('x', r.x); marquee.setAttribute('y', r.y);
    marquee.setAttribute('width', r.w); marquee.setAttribute('height', r.h);
  },
  boxEnd(a, b, shift) {
    marquee.hidden = true;
    if (!app.vp.selectMode) setSelectMode(true); // Shift + drag on a computer
    const wa = app.vp.toWorld(a.x, a.y), wb = app.vp.toWorld(b.x, b.y);
    const r = boxRect(wa, wb);
    for (const [id, p] of Object.entries(app.lay.pos)) {
      const hit = p.x + CARD_W / 2 > r.x && p.x - CARD_W / 2 < r.x + r.w && p.y + CARD_H / 2 > r.y && p.y - CARD_H / 2 < r.y + r.h;
      if (hit) app.multi.add(id);
    }
    updateSelectBar();
    render();
  },
  boxCancel() { marquee.hidden = true; },
  dragStart(id) {
    // Dragging a selected character moves the whole selection.
    const ids = app.multi.has(id) && app.multi.size > 1 ? [...app.multi] : [id];
    const bases = {};
    for (const x of ids) {
      const o = app.doc.positions[x];
      bases[x] = o && !o.deleted ? { x: o.x || 0, y: o.y || 0 } : { x: 0, y: 0 };
    }
    drag = { ids, bases, d: null };
  },
  drag(id, dx, dy) {
    if (!drag) return;
    drag.d = { x: dx, y: dy };
    requestRender();
  },
  dragEnd() {
    if (!drag || !drag.d) { drag = null; return; }
    let { x: dx, y: dy } = drag.d;
    if (snapping()) {
      // Automatic spots are on the grid, so whole-square moves keep cards on it.
      dx = Math.round(dx / GRID) * GRID;
      dy = Math.round(dy / GRID) * GRID;
    }
    const moved = {};
    for (const id of drag.ids) {
      let x = drag.bases[id].x + dx, y = drag.bases[id].y + dy;
      if (!snapping() && drag.ids.length === 1 && Math.hypot(x, y) < 14) x = y = 0; // back to its automatic spot
      moved[id] = { x, y };
    }
    // Don't let cards land on or right against other cards: nudge to the nearest free spot.
    const shift = freeSpot(moved);
    for (const [id, o] of Object.entries(moved)) M.setPosition(app.doc, id, o.x + shift.x, o.y + shift.y);
    drag = null;
    commit();
  },
});

// Smallest grid move (for the whole group) that keeps every moved card at least one grid
// square away from the cards that stayed put.
function freeSpot(moved) {
  const ids = Object.keys(moved);
  const offs = {};
  for (const [id, o] of Object.entries(app.doc.positions)) if (!o.deleted && (o.x || o.y)) offs[id] = o;
  Object.assign(offs, moved);
  const L = layout(app.view, offs, { snap: snapping() });
  const movedSet = new Set(ids);
  const still = Object.keys(L.pos).filter((id) => !movedSet.has(id)).map((id) => L.pos[id]);
  const fits = (sx, sy) => ids.every((id) => {
    const p = L.pos[id];
    if (!p) return true;
    const x = p.x + sx, y = p.y + sy;
    return still.every((q) => Math.abs(q.x - x) >= CARD_W + GRID || Math.abs(q.y - y) >= CARD_H + GRID);
  });
  if (fits(0, 0)) return { x: 0, y: 0 };
  // Try nearby grid spots, closest first. Moving up or down counts three times as far as
  // sideways, so a card dropped onto a row stays in that row when there's room.
  const spots = [];
  for (let i = -20; i <= 20; i++) for (let j = -8; j <= 8; j++) spots.push({ x: i * GRID, y: j * GRID, cost: Math.hypot(i, j * 3) });
  spots.sort((p, q) => p.cost - q.cost);
  const ok = spots.find((c) => fits(c.x, c.y));
  if (ok) return { x: ok.x, y: ok.y };
  return { x: 0, y: 0 };
}

function offsets() {
  const out = {};
  for (const [id, o] of Object.entries(app.doc.positions)) if (!o.deleted && (o.x || o.y)) out[id] = o;
  if (drag && drag.d) for (const id of drag.ids) out[id] = { x: drag.bases[id].x + drag.d.x, y: drag.bases[id].y + drag.d.y };
  return out;
}

function themeColours() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue(n).trim();
  return { card: v('--card'), cardLine: v('--card-line'), text: v('--text'), muted: v('--muted'), line: v('--line'), accent: v('--accent'), photoBg: v('--photo-bg'), halo: v('--card') };
}

let pendingPhotos = new Set();
function photoHref(id) {
  const u = store.cachedImageUrl(id);
  if (u) return u;
  if (!pendingPhotos.has(id)) {
    pendingPhotos.add(id);
    store.imageUrl(id, app.doc.id).then((url) => {
      pendingPhotos.delete(id);
      if (url) requestRender();
    });
  }
  return null;
}

export function render() {
  if (!app.doc) return;
  app.view = M.visibleView(app.doc);
  app.lay = layout(app.view, offsets(), { snap: snapping() });
  world.innerHTML = treeMarkup({
    doc: app.doc, view: app.view, lay: app.lay, selected: app.selected, multi: app.multi, matches: app.matches,
    colours: themeColours(), photo: photoHref,
  });
  $('treeTitle').textContent = app.doc.meta.name;
  document.title = `${app.doc.meta.name} · Family Tree Creator`;
  const n = Object.keys(app.view.people).length;
  const total = M.live(app.doc.people).length;
  $('treeEmpty').hidden = total > 0;
  const m = app.doc.meta;
  const pill = $('spoilerPill');
  pill.hidden = !(m.spoilers && m.progress && m.progress.book);
  if (!pill.hidden) {
    const b = m.books.find((x) => x.id === m.progress.book);
    const hidden = total - n;
    pill.textContent = `📖 Read up to ${b ? b.title : '?'}${m.progress.chapter ? ', ch. ' + m.progress.chapter : ''}${hidden ? ` · ${hidden} hidden` : ''}`;
  }
}

let raf = 0;
export function requestRender() {
  if (raf) return;
  raf = requestAnimationFrame(() => { raf = 0; render(); });
}

let saveTimer;
// Re-draw and save after any change.
export function commit() {
  render();
  clearTimeout(saveTimer);
  const doc = app.doc;
  saveTimer = setTimeout(() => sync.saveLocal(doc), 500);
}
app.commit = commit;
app.render = render;

export async function flushSave() {
  clearTimeout(saveTimer);
  if (app.doc) await sync.saveLocal(app.doc);
}

app.select = (id, { open = false, center = false } = {}) => {
  app.selected = id;
  render();
  if (center && app.lay.pos[id]) {
    const p = app.lay.pos[id];
    app.vp.animateTo(p.x, p.y + (isPhone() && open ? 160 / app.vp.t.k : 0), Math.max(app.vp.t.k, 0.8));
  }
  if (open) openPerson(app, id);
};

async function openTree(id) {
  const rec = await store.getTree(id);
  if (!rec) return;
  app.doc = M.normalise(rec.doc);
  applyTreeLook();
  if (M.capitaliseAllNames(app.doc)) sync.saveLocal(app.doc);
  app.vp.selectMode = false;
  app.multi.clear();
  $('selectMode').setAttribute('aria-pressed', 'false');
  svg.classList.remove('selecting');
  $('selectBar').hidden = true;
  app.selected = null;
  app.matches = null;
  $('searchInput').value = '';
  $('searchCount').textContent = '';
  $('searchBox').classList.remove('open');
  show('tree');
  history.pushState({ tree: id }, '', `#tree=${id}`);
  render();
  requestAnimationFrame(() => {
    // After a refresh that reloaded the app, put the view back where it was.
    let saved = null;
    try { saved = JSON.parse(sessionStorage.getItem('ftc.view')); } catch { /* ignore */ }
    sessionStorage.removeItem('ftc.view');
    if (saved && saved.tree === id && saved.t) { app.vp.t = saved.t; app.vp.apply(); } else app.vp.fitReadable(app.lay.bounds);
  });
}
app.openTree = openTree;

// ---------------- refresh: latest trees + app updates ----------------

async function latestVersion() {
  try {
    const t = await fetch('js/version.js', { cache: 'no-store' }).then((r) => (r.ok ? r.text() : ''));
    return (t.match(/APP_VERSION = '([^']+)'/) || [])[1] || null;
  } catch { return null; }
}

async function updateApp() {
  toast('Updating the app…', 8000);
  await flushSave();
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) {
      const changed = new Promise((res) => navigator.serviceWorker.addEventListener('controllerchange', res, { once: true }));
      await reg.update();
      await Promise.race([changed, new Promise((res) => setTimeout(res, 3000))]);
    }
  } catch { /* reloading still fetches the new files */ }
  if (app.doc) sessionStorage.setItem('ftc.view', JSON.stringify({ tree: app.doc.id, t: app.vp.t }));
  location.reload();
}

const refreshButtons = () => document.querySelectorAll('[data-refresh]');
async function refreshAll() {
  refreshButtons().forEach((b) => b.classList.add('spinning'));
  try {
    await flushSave();
    await sync.syncAll();
    const latest = await latestVersion();
    if (latest && latest !== APP_VERSION) return updateApp();
    const s = sync.state;
    toast(s.status === 'offline' ? "Offline: you're seeing what's saved on this device" : s.status === 'error' ? s.message : 'Everything is up to date');
  } finally {
    refreshButtons().forEach((b) => b.classList.remove('spinning'));
  }
}
refreshButtons().forEach((b) => b.addEventListener('click', refreshAll));

// Quietly look for a new version now and then, and show a dot on the refresh button.
let updateNoticeShown = false;
async function checkForUpdate() {
  if (!navigator.onLine) return;
  const latest = await latestVersion();
  const ready = latest && latest !== APP_VERSION;
  refreshButtons().forEach((b) => { if (ready) b.dataset.update = ''; else delete b.dataset.update; });
  if (ready && !updateNoticeShown) {
    updateNoticeShown = true;
    toast('A new version of the app is ready: tap ⟳ to update', 5000);
  }
}
setTimeout(checkForUpdate, 8000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkForUpdate(); });

async function leaveTree() {
  closeSheet(true);
  await flushSave();
  showLibrary();
}
app.leaveTree = leaveTree;

window.addEventListener('popstate', () => {
  if (!$('tree').hidden) leaveTree();
});

$('treeBack').addEventListener('click', () => history.back());
$('treeTitle').addEventListener('click', () => openTreeSettings(app));
$('treeSettings').addEventListener('click', () => openTreeSettings(app));
$('spoilerPill').addEventListener('click', () => openProgress(app));
$('treeExport').addEventListener('click', () => openExport(app));
$('zoomIn').addEventListener('click', () => app.vp.zoomBy(1.4));
$('zoomOut').addEventListener('click', () => app.vp.zoomBy(1 / 1.4));
$('zoomFit').addEventListener('click', () => app.vp.fit(app.lay.bounds));
$('addPerson').addEventListener('click', () => addPersonFlow(app));
$('emptyAdd').addEventListener('click', () => addPersonFlow(app));

// ---------------- search ----------------

let matchList = [];
let matchIdx = 0;
function runSearch() {
  const q = $('searchInput').value.trim().toLowerCase();
  if (!q) {
    app.matches = null;
    matchList = [];
    $('searchCount').textContent = '';
    render();
    return;
  }
  matchList = Object.values(app.view ? app.view.people : {}).filter((p) =>
    [p.name, p.aka, p.notes, p.born, p.died].some((f) => f && f.toLowerCase().includes(q))).map((p) => p.id);
  app.matches = new Set(matchList);
  matchIdx = 0;
  $('searchCount').textContent = matchList.length ? `1 of ${matchList.length}` : 'none';
  render();
  if (matchList.length) focusMatch();
}
function focusMatch() {
  const id = matchList[matchIdx];
  const p = app.lay.pos[id];
  if (p) app.vp.animateTo(p.x, p.y, Math.max(app.vp.t.k, 0.9));
  $('searchCount').textContent = `${matchIdx + 1} of ${matchList.length}`;
}
$('searchInput').addEventListener('input', runSearch);
$('searchInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && matchList.length) {
    e.preventDefault();
    matchIdx = (matchIdx + (e.shiftKey ? matchList.length - 1 : 1)) % matchList.length;
    focusMatch();
  } else if (e.key === 'Escape') {
    $('searchInput').value = '';
    runSearch();
    $('searchBox').classList.remove('open');
  }
});
$('searchToggle').addEventListener('click', () => {
  const box = $('searchBox');
  box.classList.toggle('open');
  if (box.classList.contains('open')) $('searchInput').focus();
  else { $('searchInput').value = ''; runSearch(); }
});

window.addEventListener('resize', () => { if (app.doc) requestRender(); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushSave();
});
window.addEventListener('pagehide', () => { flushSave(); });

// Keyboard shortcuts on computers.
document.addEventListener('keydown', (e) => {
  if ($('tree').hidden || $('modal').open) return;
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
  if ((e.ctrlKey || e.metaKey) && e.key === 'f') { e.preventDefault(); $('searchBox').classList.add('open'); $('searchInput').focus(); }
  if (typing) return;
  if (e.key === 'Escape' && (app.vp.selectMode || app.multi.size) && !sheetOpen()) setSelectMode(false);
  if (e.key === '+' || e.key === '=') app.vp.zoomBy(1.25);
  if (e.key === '-') app.vp.zoomBy(0.8);
  if (e.key === '0') app.vp.fit(app.lay.bounds);
});

const savedTheme = localStorage.getItem('ftc.theme');
if (savedTheme && savedTheme !== 'auto') document.documentElement.dataset.theme = savedTheme;
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => app.doc && render());
theme.applyLook(theme.usualLook());

boot();
