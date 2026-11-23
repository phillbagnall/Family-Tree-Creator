// Local storage on the device (IndexedDB). Everything works from here first,
// so the app keeps working offline; sync.js copies changes to GitHub.
//
// trees:  {id, doc, remoteSha, dirty, version}
// images: {id, treeId, blob, uploaded}

const DB_NAME = 'family-tree-creator';
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('trees')) db.createObjectStore('trees', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('images')) db.createObjectStore('images', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then((r) => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const getTree = (id) => tx('trees', 'readonly', (s) => reqP(s.get(id)));
export const allTrees = () => tx('trees', 'readonly', (s) => reqP(s.getAll()));
export const putTree = (rec) => tx('trees', 'readwrite', (s) => { s.put(rec); });
export const removeTree = (id) => tx('trees', 'readwrite', (s) => { s.delete(id); });

export const getImage = (id) => tx('images', 'readonly', (s) => reqP(s.get(id)));
export const allImages = () => tx('images', 'readonly', (s) => reqP(s.getAll()));
export const putImage = (rec) => tx('images', 'readwrite', (s) => { s.put(rec); });

export async function clearAll() {
  await tx('trees', 'readwrite', (s) => { s.clear(); });
  await tx('images', 'readwrite', (s) => { s.clear(); });
}

// Object URLs for photos, cached per session.
const urlCache = new Map();
const waiting = new Map();
let fetcher = null; // set by sync.js: (id, treeId) => Promise<Blob|null>

export function setImageFetcher(fn) { fetcher = fn; }

export function cachedImageUrl(id) { return urlCache.get(id) || null; }

export async function imageUrl(id, treeId) {
  if (!id) return null;
  if (urlCache.has(id)) return urlCache.get(id);
  if (waiting.has(id)) return waiting.get(id);
  const p = (async () => {
    let rec = await getImage(id);
    if (!rec && fetcher) {
      const blob = await fetcher(id, treeId).catch(() => null);
      if (blob) {
        rec = { id, treeId, blob, uploaded: true };
        await putImage(rec);
      }
    }
    if (!rec) return null;
    const url = URL.createObjectURL(rec.blob);
    urlCache.set(id, url);
    return url;
  })();
  waiting.set(id, p);
  try { return await p; } finally { waiting.delete(id); }
}

export async function imageDataUrl(id, treeId) {
  await imageUrl(id, treeId);
  const rec = await getImage(id);
  if (!rec) return null;
  return new Promise((res) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => res(null);
    r.readAsDataURL(rec.blob);
  });
}
