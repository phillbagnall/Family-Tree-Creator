// Copies trees and photos between this device and the GitHub repo.
//
// Repo layout:
//   trees/<treeId>/tree.json          the tree document
//   trees/<treeId>/images/<id>.jpg    photos (never change once written)

import * as store from './store.js';
import { merge, imagesUsed, normalise } from './model.js';
import { GitHub, encodeText } from './github.js';
import * as theme from './theme.js';

const treePath = (id) => `trees/${id}/tree.json`;
const imagePath = (treeId, imgId) => `trees/${treeId}/images/${imgId}.jpg`;

let gh = null;
let remote = new Map();     // path -> sha, from the last listing
let chain = Promise.resolve();
let timer = null;
let pollTimer = null;
let started = false;
const listeners = { status: [], changed: [], settings: [] };

export const state = { status: 'idle', message: '', lastSync: null };

export function on(evt, fn) { listeners[evt].push(fn); }
function emit(evt, ...args) { for (const fn of listeners[evt]) fn(...args); }

function setStatus(status, message = '') {
  state.status = status;
  state.message = message;
  if (status === 'idle') state.lastSync = Date.now();
  emit('status', state);
}

// Run sync jobs one at a time.
function serial(fn) {
  const p = chain.then(fn, fn);
  chain = p.catch(() => {});
  return p;
}

export function start({ owner, repo, token }) {
  gh = new GitHub({ owner, repo, token });
  store.setImageFetcher(fetchImage);
  clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    if (document.visibilityState === 'visible') syncAll();
  }, 60000);
  if (started) return gh;
  started = true;
  window.addEventListener('online', () => syncAll());
  window.addEventListener('offline', () => setStatus('offline'));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncAll();
  });
  return gh;
}

export function stop() {
  gh = null;
  clearInterval(pollTimer);
  clearTimeout(timer);
}

async function fetchImage(imgId, treeId) {
  if (!gh || !navigator.onLine) return null;
  const path = imagePath(treeId, imgId);
  let bytes;
  const sha = remote.get(path);
  if (sha) bytes = await gh.getBlob(sha);
  else {
    const f = await gh.getFile(path);
    if (!f) return null;
    bytes = f.bytes;
  }
  return new Blob([bytes], { type: 'image/jpeg' });
}

const parse = (bytes) => normalise(JSON.parse(new TextDecoder().decode(bytes)));

async function pushTree(id) {
  let rec = await store.getTree(id);
  if (!rec || !rec.dirty) return;

  for (const imgId of imagesUsed(rec.doc)) {
    const img = await store.getImage(imgId);
    if (!img || img.uploaded) continue;
    const bytes = new Uint8Array(await img.blob.arrayBuffer());
    const path = imagePath(id, imgId);
    try {
      remote.set(path, await gh.putBytes(path, bytes, undefined, `Add photo to ${rec.doc.meta.name}`));
    } catch (e) {
      if (e.status !== 422) throw e; // 422: already there
    }
    img.uploaded = true;
    await store.putImage(img);
  }

  for (let attempt = 0; attempt < 4; attempt++) {
    rec = await store.getTree(id);
    const version = rec.version;
    try {
      const sha = await gh.putFile(
        treePath(id),
        encodeText(JSON.stringify(rec.doc, null, 1)),
        rec.remoteSha,
        `Update ${rec.doc.meta.name}`,
      );
      remote.set(treePath(id), sha);
      const latest = await store.getTree(id);
      latest.remoteSha = sha;
      if (latest.version === version) latest.dirty = false;
      await store.putTree(latest);
      return;
    } catch (e) {
      // Someone else (another device) saved first: merge their version in and retry.
      if (![409, 422, 404].includes(e.status)) throw e;
      const f = await gh.getFile(treePath(id));
      const latest = await store.getTree(id);
      if (f) {
        latest.doc = merge(latest.doc, parse(f.bytes));
        latest.remoteSha = f.sha;
      } else {
        latest.remoteSha = undefined;
      }
      latest.version++;
      await store.putTree(latest);
      emit('changed', id);
    }
  }
  throw new Error('Could not save after several tries');
}

// ---------- shared settings (the usual look) ----------
// settings.json holds things that should be the same on every device.

const SETTINGS = 'settings.json';
const SETTINGS_SHA = 'ftc.settings.sha';

async function pullSettings() {
  const sha = remote.get(SETTINGS);
  if (!sha || sha === localStorage.getItem(SETTINGS_SHA)) return;
  const data = JSON.parse(new TextDecoder().decode(await gh.getBlob(sha)));
  localStorage.setItem(SETTINGS_SHA, sha);
  const look = data.look;
  if (look && (look.updatedAt || 0) > theme.usualLookTime()) {
    theme.storeSyncedLook(look);
    emit('settings');
  }
}

async function pushSettings() {
  if (!theme.usualLookDirty()) return;
  for (let attempt = 0; attempt < 3; attempt++) {
    const look = theme.usualLook();
    try {
      const sha = await gh.putFile(SETTINGS, encodeText(JSON.stringify({ look }, null, 1)),
        remote.get(SETTINGS), 'Update usual look');
      remote.set(SETTINGS, sha);
      localStorage.setItem(SETTINGS_SHA, sha);
      if (theme.usualLookTime() === look.updatedAt) theme.markUsualLookSent();
      return;
    } catch (e) {
      if (![409, 422, 404].includes(e.status)) throw e;
      // Changed on another device meanwhile: newest edit wins.
      const f = await gh.getFile(SETTINGS);
      if (f) remote.set(SETTINGS, f.sha); else remote.delete(SETTINGS);
      localStorage.removeItem(SETTINGS_SHA);
      if (f) {
        const theirs = JSON.parse(new TextDecoder().decode(f.bytes)).look;
        if (theirs && (theirs.updatedAt || 0) > look.updatedAt) {
          theme.storeSyncedLook(theirs);
          localStorage.setItem(SETTINGS_SHA, f.sha);
          emit('settings');
          return;
        }
      }
    }
  }
}

let settingsTimer = null;
export function scheduleSettings() {
  clearTimeout(settingsTimer);
  if (!gh || !navigator.onLine) return;
  settingsTimer = setTimeout(() => serial(async () => {
    try { await pushSettings(); } catch (e) { setStatus(e.status === 0 ? 'offline' : 'error', friendly(e)); }
  }), 1500);
}

async function pullAll() {
  const files = await gh.listFiles();
  remote = new Map(files.map((f) => [f.path, f.sha]));
  await pullSettings();
  for (const [path, sha] of remote) {
    const m = path.match(/^trees\/([^/]+)\/tree\.json$/);
    if (!m) continue;
    const id = m[1];
    const rec = await store.getTree(id);
    if (rec && rec.remoteSha === sha) continue;
    const doc = parse(await gh.getBlob(sha));
    const latest = await store.getTree(id);
    if (!latest) {
      await store.putTree({ id, doc, remoteSha: sha, dirty: false, version: 0 });
    } else if (latest.dirty) {
      latest.doc = merge(latest.doc, doc);
      latest.remoteSha = sha;
      latest.version++;
      await store.putTree(latest);
    } else {
      latest.doc = doc;
      latest.remoteSha = sha;
      await store.putTree(latest);
    }
    emit('changed', id);
  }
}

// Pull everything from GitHub, then push anything changed here.
export function syncAll() {
  if (!gh) return Promise.resolve();
  if (!navigator.onLine) {
    setStatus('offline');
    return Promise.resolve();
  }
  return serial(async () => {
    setStatus('syncing');
    try {
      await pullAll();
      await pushSettings();
      for (const rec of await store.allTrees()) if (rec.dirty) await pushTree(rec.id);
      setStatus('idle');
    } catch (e) {
      setStatus(e.status === 0 ? 'offline' : 'error', friendly(e));
    }
  });
}

export function syncTree(id) {
  if (!gh) return Promise.resolve();
  if (!navigator.onLine) {
    setStatus('offline');
    return Promise.resolve();
  }
  return serial(async () => {
    setStatus('syncing');
    try {
      await pushTree(id);
      setStatus('idle');
    } catch (e) {
      setStatus(e.status === 0 ? 'offline' : 'error', friendly(e));
    }
  });
}

// Called after every local save; waits for a pause in editing.
export function schedule(id) {
  clearTimeout(timer);
  if (!navigator.onLine) {
    setStatus('offline');
    return;
  }
  setStatus('pending');
  timer = setTimeout(() => syncTree(id), 2500);
}

function friendly(e) {
  if (e.status === 401) return 'The GitHub key has stopped working (expired or removed). Reconnect in Settings.';
  if (e.status === 403) return 'GitHub refused: ' + e.message;
  if (e.status === 404) return 'The trees repository was not found. Check the key can access it.';
  return e.message || 'Something went wrong while syncing';
}

// Saves a tree locally and queues it for GitHub.
export async function saveLocal(doc) {
  const rec = (await store.getTree(doc.id)) || { id: doc.id, remoteSha: undefined, version: 0 };
  rec.doc = doc;
  rec.dirty = true;
  rec.version = (rec.version || 0) + 1;
  await store.putTree(rec);
  schedule(doc.id);
}
