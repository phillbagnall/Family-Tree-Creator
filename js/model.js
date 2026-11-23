// Tree document model, edit operations and sync merge.
//
// A tree is one JSON document. Every entity (person, union, link, group,
// position) carries its own `updatedAt`, and deletions are kept as tombstones
// ({deleted: true}), so two devices that edited the same tree offline can be
// merged entity-by-entity: the newest version of each entity wins.

export const SCHEMA = 1;
const COLLECTIONS = ['people', 'unions', 'links', 'groups', 'positions'];

export const UNION_TYPES = [
  ['married', 'Married'],
  ['partners', 'Partners'],
  ['engaged', 'Engaged'],
  ['affair', 'Affair'],
  ['unknown', 'Unknown'],
];
export const UNION_STATUS = [
  ['together', 'Together'],
  ['divorced', 'Divorced'],
  ['separated', 'Separated'],
  ['widowed', 'Widowed'],
];
export const CHILD_KINDS = [
  ['birth', 'Birth'],
  ['adopted', 'Adopted'],
  ['step', 'Step'],
  ['foster', 'Foster'],
];
export const GENDERS = [
  ['female', 'Female'],
  ['male', 'Male'],
  ['unknown', 'Unknown'],
  ['other', 'Other'],
];
export const GROUP_COLOURS = [
  '#b03a2e', '#c0702a', '#b8962e', '#5d8a3a', '#2e8a7a',
  '#2f6aa8', '#5b4fa8', '#9a4a8f', '#6b5844', '#55606b',
];

export function uid() {
  const a = new Uint8Array(8);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => (b % 36).toString(36)).join('');
}

const now = () => Date.now();

export function newTree(name) {
  const t = now();
  return {
    schema: SCHEMA,
    id: uid(),
    createdAt: t,
    meta: {
      name: name || 'Untitled tree',
      author: '',
      books: [],               // [{id, title}]
      progress: null,          // {book: bookId, chapter: number|null}
      spoilers: false,         // hide entries revealed after progress
      deleted: false,
      updatedAt: t,
    },
    people: {},
    unions: {},
    links: {},
    groups: {},
    positions: {},
  };
}

// Fill any fields an older/partial document is missing.
export function normalise(doc) {
  for (const c of COLLECTIONS) if (!doc[c] || typeof doc[c] !== 'object') doc[c] = {};
  doc.meta = Object.assign(
    { name: 'Untitled tree', author: '', books: [], progress: null, spoilers: false, deleted: false, updatedAt: 0 },
    doc.meta || {},
  );
  return doc;
}

// ---------- reading helpers (ignore tombstones) ----------

export const live = (coll) => Object.values(coll).filter((e) => !e.deleted);

export function personName(doc, id) {
  const p = doc.people[id];
  return p && !p.deleted ? p.name || 'Unnamed' : 'Unknown';
}

export function unionsOf(doc, personId) {
  return live(doc.unions).filter((u) => u.partners.includes(personId));
}

export function parentUnionsOf(doc, personId) {
  return live(doc.unions).filter((u) => u.children.some((c) => c.id === personId));
}

export function linksOf(doc, personId) {
  return live(doc.links).filter((l) => l.a === personId || l.b === personId);
}

// ---------- spoilers ----------

// Position of a "reveal" marker in reading order, comparable with progress.
function revealRank(doc, reveal) {
  if (!reveal || !reveal.book) return -1;
  const i = doc.meta.books.findIndex((b) => b.id === reveal.book);
  if (i < 0) return -1;
  return i * 100000 + (Number(reveal.chapter) || 0);
}

export function isRevealed(doc, entity) {
  const m = doc.meta;
  if (!m.spoilers || !m.progress || !m.progress.book) return true;
  const r = revealRank(doc, entity.reveal);
  if (r < 0) return true;
  const pi = m.books.findIndex((b) => b.id === m.progress.book);
  if (pi < 0) return true;
  const ch = m.progress.chapter == null || m.progress.chapter === '' ? 99999 : Number(m.progress.chapter);
  return r <= pi * 100000 + ch;
}

// The parts of the tree that should be drawn right now.
export function visibleView(doc) {
  const people = {};
  for (const p of live(doc.people)) if (isRevealed(doc, p)) people[p.id] = p;
  const unions = [];
  for (const u of live(doc.unions)) {
    if (!isRevealed(doc, u)) continue;
    const partners = u.partners.filter((id) => people[id]);
    const children = u.children.filter((c) => people[c.id]);
    if (partners.length + children.length < 2) continue;
    if (!partners.length && children.length < 2) continue;
    unions.push({ ...u, partners, children });
  }
  const links = live(doc.links).filter((l) => isRevealed(doc, l) && people[l.a] && people[l.b]);
  return { people, unions, links };
}

// ---------- edits ----------
// Every edit stamps updatedAt on what it touched.

function touch(e) {
  e.updatedAt = now();
  return e;
}

export function setMeta(doc, patch) {
  Object.assign(doc.meta, patch);
  touch(doc.meta);
}

export function addPerson(doc, data = {}) {
  const p = touch({
    id: uid(),
    name: '',
    aka: '',
    born: '',
    died: '',
    events: [],     // [{label, date}]
    notes: '',
    gender: 'unknown', // female | male | unknown | other (+ genderCustom)
    genderCustom: '',
    photo: null,    // image id
    groups: [],
    reveal: null,   // {book, chapter}
    ...data,
  });
  doc.people[p.id] = p;
  return p;
}

export function updatePerson(doc, id, patch) {
  Object.assign(doc.people[id], patch);
  touch(doc.people[id]);
}

function addUnion(doc, partners, children = [], data = {}) {
  const u = touch({
    id: uid(),
    partners,
    children,
    type: partners.length === 2 ? 'married' : 'unknown',
    status: 'together',
    start: '',
    end: '',
    reveal: null,
    ...data,
  });
  doc.unions[u.id] = u;
  return u;
}

export function updateUnion(doc, id, patch) {
  Object.assign(doc.unions[id], patch);
  touch(doc.unions[id]);
}

function deleteUnion(doc, id) {
  doc.unions[id] = { id, deleted: true, updatedAt: now() };
}

// Drop unions that no longer connect anything.
function tidyUnion(doc, u) {
  const people = u.partners.length + u.children.length;
  if (people < 2 || (u.partners.length === 0 && u.children.length < 2)) deleteUnion(doc, u.id);
}

export function deletePerson(doc, id) {
  for (const u of live(doc.unions)) {
    const inP = u.partners.includes(id);
    const inC = u.children.some((c) => c.id === id);
    if (!inP && !inC) continue;
    u.partners = u.partners.filter((x) => x !== id);
    u.children = u.children.filter((c) => c.id !== id);
    touch(u);
    tidyUnion(doc, u);
  }
  for (const l of linksOf(doc, id)) doc.links[l.id] = { id: l.id, deleted: true, updatedAt: now() };
  doc.people[id] = { id, deleted: true, updatedAt: now() };
  if (doc.positions[id]) doc.positions[id] = { deleted: true, updatedAt: now() };
}

// The union two people share, or a new one.
export function partnerUnion(doc, a, b) {
  return unionsOf(doc, a).find((u) => u.partners.length === 2 && u.partners.includes(b));
}

export function linkPartners(doc, a, b) {
  if (a === b) return null;
  let u = partnerUnion(doc, a, b);
  if (u) return u;
  // A single parent with children can gain a partner in place.
  u = unionsOf(doc, a).find((x) => x.partners.length === 1);
  if (u && !unionsOf(doc, b).length) {
    u.partners.push(b);
    if (u.type === 'unknown') u.type = 'married';
    touch(u);
    return u;
  }
  return addUnion(doc, [a, b]);
}

// Add a child to the couple a + b, without touching either parent's other families.
export function addChildToCouple(doc, a, b, childId, kind = 'birth') {
  const u = partnerUnion(doc, a, b) || addUnion(doc, [a, b]);
  if (!u.children.some((c) => c.id === childId)) {
    u.children.push({ id: childId, kind });
    touch(u);
  }
  return u;
}

// Add childId as a child of parentId (and optionally otherParentId).
export function linkChild(doc, parentId, childId, otherParentId = null, kind = 'birth') {
  if (parentId === childId || otherParentId === childId) return null;
  let u;
  if (otherParentId) u = linkPartners(doc, parentId, otherParentId);
  else u = unionsOf(doc, parentId).find((x) => x.partners.length === 1) || addUnion(doc, [parentId]);
  if (!u.children.some((c) => c.id === childId)) {
    u.children.push({ id: childId, kind });
    touch(u);
  }
  return u;
}

// Add parentId as a parent of childId, joining an existing single parent if there is one.
export function linkParent(doc, childId, parentId) {
  if (childId === parentId) return null;
  const existing = parentUnionsOf(doc, childId);
  const single = existing.find((u) => u.partners.length < 2 && !u.partners.includes(parentId));
  if (single) {
    single.partners.push(parentId);
    if (single.partners.length === 2 && single.type === 'unknown') single.type = 'married';
    touch(single);
    return single;
  }
  return linkChild(doc, parentId, childId);
}

// Make b a sibling of a (sharing a's parents, or a new "unknown parents" group).
export function linkSibling(doc, a, b) {
  let u = parentUnionsOf(doc, a)[0];
  if (!u) u = addUnion(doc, [], [{ id: a, kind: 'birth' }]);
  if (!u.children.some((c) => c.id === b)) {
    u.children.push({ id: b, kind: 'birth' });
    touch(u);
  }
  return u;
}

export function removeFromUnion(doc, unionId, personId) {
  const u = doc.unions[unionId];
  u.partners = u.partners.filter((x) => x !== personId);
  u.children = u.children.filter((c) => c.id !== personId);
  touch(u);
  tidyUnion(doc, u);
}

export function setChildKind(doc, unionId, childId, kind) {
  const u = doc.unions[unionId];
  const c = u.children.find((x) => x.id === childId);
  if (c) c.kind = kind;
  touch(u);
}

export function moveChild(doc, unionId, childId, dir) {
  const u = doc.unions[unionId];
  const i = u.children.findIndex((c) => c.id === childId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= u.children.length) return;
  [u.children[i], u.children[j]] = [u.children[j], u.children[i]];
  touch(u);
}

export function addLink(doc, a, b, label, colour) {
  const l = touch({ id: uid(), a, b, label: label || '', colour: colour || '#9a4a8f', reveal: null });
  doc.links[l.id] = l;
  return l;
}

export function updateLink(doc, id, patch) {
  Object.assign(doc.links[id], patch);
  touch(doc.links[id]);
}

export function deleteLink(doc, id) {
  doc.links[id] = { id, deleted: true, updatedAt: now() };
}

export function addGroup(doc, name, colour) {
  const used = new Set(live(doc.groups).map((g) => g.colour));
  const c = colour || GROUP_COLOURS.find((x) => !used.has(x)) || GROUP_COLOURS[0];
  const g = touch({ id: uid(), name: name || 'New group', colour: c });
  doc.groups[g.id] = g;
  return g;
}

export function updateGroup(doc, id, patch) {
  Object.assign(doc.groups[id], patch);
  touch(doc.groups[id]);
}

export function deleteGroup(doc, id) {
  doc.groups[id] = { id, deleted: true, updatedAt: now() };
  for (const p of live(doc.people)) {
    if (p.groups && p.groups.includes(id)) {
      p.groups = p.groups.filter((g) => g !== id);
      touch(p);
    }
  }
}

export function setPosition(doc, id, x, y) {
  doc.positions[id] = { x: Math.round(x), y: Math.round(y), updatedAt: now() };
}

export function clearPositions(doc) {
  const t = now();
  for (const id of Object.keys(doc.positions)) doc.positions[id] = { deleted: true, updatedAt: t };
}

export function imagesUsed(doc) {
  return new Set(live(doc.people).flatMap((p) => [p.photo, p.photoSrc]).filter(Boolean));
}

// ---------- merge ----------

// Combine two versions of the same tree. Newest entity wins.
export function merge(a, b) {
  a = normalise(a);
  b = normalise(b);
  const out = { schema: SCHEMA, id: a.id, createdAt: Math.min(a.createdAt || Infinity, b.createdAt || Infinity) };
  out.meta = (b.meta.updatedAt || 0) > (a.meta.updatedAt || 0) ? b.meta : a.meta;
  for (const c of COLLECTIONS) {
    out[c] = { ...a[c] };
    for (const [id, e] of Object.entries(b[c])) {
      const mine = out[c][id];
      if (!mine || (e.updatedAt || 0) > (mine.updatedAt || 0)) out[c][id] = e;
    }
  }
  return out;
}

export function summary(doc) {
  const people = live(doc.people);
  return {
    id: doc.id,
    name: doc.meta.name,
    author: doc.meta.author,
    count: people.length,
    photos: people.filter((p) => p.photo).slice(0, 4).map((p) => p.photo),
    deleted: !!doc.meta.deleted,
  };
}
