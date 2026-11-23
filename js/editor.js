// Side panels for editing a character, the tree's settings and reading progress.

import * as M from './model.js';
import * as store from './store.js';
import { initials } from './render.js';
import * as theme from './theme.js';
import { cropPhoto } from './cropper.js';
import { openFeedback } from './feedback.js';
import { $, h, icon, openSheet, closeSheet, modal, confirmBox, askText, toast, pickFile, resizeImage } from './ui.js';

const opts = (pairs, cur) => pairs.map(([v, l]) => h('option', { value: v, selected: v === cur }, l));

function face(app, id, cls = 'mini-face') {
  const p = app.doc.people[id];
  const el = h('span', { class: cls }, p && !p.photo ? initials(p.name) : '');
  if (p && p.photo) store.imageUrl(p.photo, app.doc.id).then((u) => { if (u) el.style.backgroundImage = `url("${u}")`; });
  return el;
}

const who = (app, id, small) =>
  h('button', { class: 'rel-who', type: 'button', onclick: () => app.select(id, { open: true, center: true }) },
    M.personName(app.doc, id), small ? h('small', {}, small) : null);

// Text input bound to a field with live saving.
function field(label, value, onInput, attrs = {}) {
  const inp = h(attrs.multiline ? 'textarea' : 'input', { value: value || '', placeholder: attrs.placeholder || '', class: attrs.class, rows: attrs.rows, oninput: (e) => onInput(e.target.value) });
  if (attrs.multiline) inp.value = value || '';
  return label ? h('label', {}, label, inp) : inp;
}

function revealPicker(app, entity, onChange) {
  const books = app.doc.meta.books;
  if (!books.length) return null;
  const r = entity.reveal || {};
  const bookSel = h('select', {
    onchange: (e) => onChange(e.target.value ? { book: e.target.value, chapter: r.chapter || '' } : null),
  }, h('option', { value: '' }, 'Not set'), opts(books.map((b) => [b.id, b.title || 'Untitled book']), r.book));
  const ch = h('input', {
    type: 'number', inputmode: 'numeric', min: 0, placeholder: 'Chapter', value: r.chapter || '',
    oninput: (e) => { if (bookSel.value) onChange({ book: bookSel.value, chapter: e.target.value }); },
    style: { maxWidth: '110px' },
  });
  return h('label', {}, 'First appears in', h('div', { class: 'event-row' }, bookSel, ch));
}

// ---------------- choosing a person ----------------

// Ask for a new or existing character. Resolves to a person id, or null.
export async function choosePerson(app, { title, exclude = [] }) {
  const people = M.live(app.doc.people).filter((p) => !exclude.includes(p.id)).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const nameInp = h('input', { placeholder: 'Name of new character', autocomplete: 'off' });
  let chosen = null;
  const list = h('div', { class: 'picker-list' });
  const filter = h('input', { type: 'search', placeholder: 'Search existing characters', autocomplete: 'off' });
  const dlg = $('modal');
  const fill = () => {
    const q = filter.value.trim().toLowerCase();
    list.replaceChildren(...people.filter((p) => !q || (p.name || '').toLowerCase().includes(q) || (p.aka || '').toLowerCase().includes(q)).slice(0, 60)
      .map((p) => h('button', { type: 'button', onclick: () => { chosen = p.id; dlg.close('pick'); } }, face(app, p.id), p.name || 'Unnamed')));
  };
  filter.addEventListener('input', fill);
  fill();
  const body = h('div', { class: 'sec' },
    h('label', {}, 'New character', nameInp),
    people.length ? h('div', { class: 'sec' }, h('h3', {}, 'Or someone already in the tree'), filter, list) : null);
  const r = await modal({ title, body, buttons: [{ label: 'Cancel', value: '' }, { label: 'Add new', value: 'new', primary: true }] });
  if (!r) return null;
  if (r.button === 'pick') return chosen;
  const name = nameInp.value.trim();
  return M.addPerson(app.doc, { name: name || 'New character' }).id;
}

async function chooseOne(title, text, choices) {
  const dlg = $('modal');
  let pick = null;
  const body = h('div', { class: 'choice-list' }, choices.map(([v, l]) =>
    h('button', { class: 'btn', type: 'button', onclick: () => { pick = v; dlg.close('pick'); } }, l)));
  const r = await modal({ title, text, body, buttons: [{ label: 'Cancel', value: '' }] });
  return r ? pick : undefined;
}

// ---------------- adding ----------------

export async function addPersonFlow(app) {
  const sel = app.selected && app.doc.people[app.selected] && !app.doc.people[app.selected].deleted ? app.selected : null;
  if (sel) {
    const nm = M.personName(app.doc, sel);
    const c = await chooseOne('Add a character', null, [
      ['child', `Child of ${nm}`], ['partner', `Partner of ${nm}`], ['parent', `Parents of ${nm}`],
      ['sibling', `Brother or sister of ${nm}`], ['none', 'Someone not connected yet'],
    ]);
    if (c === undefined) return;
    if (c !== 'none') return addRelative(app, sel, c);
  }
  const p = M.addPerson(app.doc, { name: '' });
  app.commit();
  app.select(p.id, { open: true, center: true });
  setTimeout(() => document.querySelector('.name-input')?.focus(), 80);
}

// Add one or both parents in a single step. Each name can be a new character or
// someone already in the tree (suggested as she types).
export async function addParentsFlow(app, childId) {
  const doc = app.doc;
  const nm = M.personName(doc, childId);
  const people = M.live(doc.people).filter((p) => p.id !== childId && p.name);
  const byName = (name) => {
    const n = name.trim().toLowerCase();
    return n ? people.find((p) => p.name.trim().toLowerCase() === n) : null;
  };
  // A parent already there on their own: just add the other one.
  const single = M.parentUnionsOf(doc, childId).find((u) => u.partners.length === 1);
  const listId = 'peopleNames';
  const list = h('datalist', { id: listId }, people.map((p) => h('option', { value: p.name })));
  const slot = (label, placeholder) => {
    const hint = h('span', { class: 'hint' });
    const input = h('input', { list: listId, placeholder, autocomplete: 'off', oninput: () => {
      const v = input.value.trim();
      hint.textContent = !v ? '' : byName(v) ? '✓ Already in the tree: will be linked' : '+ New character';
    } });
    return { input, el: h('label', {}, label, input, hint) };
  };
  const a = single ? null : slot('Parent', 'Name, e.g. Molly Weasley');
  const b = slot(single ? `Other parent (with ${M.personName(doc, single.partners[0])})` : 'Other parent (optional)', 'Name');
  const type = h('select', {}, opts(M.UNION_TYPES, 'married'));
  const status = h('select', {}, opts(M.UNION_STATUS, 'together'));
  const kind = h('select', {}, opts(M.CHILD_KINDS.map(([v, l]) => [v, l === 'Birth' ? 'Birth child' : `${l} child`]), 'birth'));
  const body = h('div', { class: 'sec' }, list, a && a.el, b.el,
    h('div', { class: 'row2' }, h('label', {}, 'The parents are', type), h('label', {}, 'Status', status)),
    h('label', {}, `${nm} is their`, kind));
  setTimeout(() => (a || b).input.focus(), 60);
  const r = await modal({ title: `Parents of ${nm}`, body, buttons: [{ label: 'Cancel', value: '' }, { label: 'Add', value: 'ok', primary: true }] });
  if (!r) return;

  const resolve = (name) => {
    name = name.trim();
    if (!name) return null;
    const found = byName(name);
    return found ? found.id : M.addPerson(doc, { name }).id;
  };
  const pA = single ? single.partners[0] : resolve(a.input.value);
  const pB = resolve(b.input.value);
  if (!pA && !pB) return;
  if (pA && pB && pA === pB) return toast('The two parents need to be different characters');
  let u;
  if (single && pB) {
    u = M.linkParent(doc, childId, pB);
  } else if (pA && pB) {
    u = M.addChildToCouple(doc, pA, pB, childId, kind.value);
  } else {
    u = M.linkChild(doc, pA || pB, childId, null, kind.value);
  }
  if (u) {
    const patch = { status: status.value };
    if (u.partners.length === 2) patch.type = type.value;
    M.updateUnion(doc, u.id, patch);
    M.setChildKind(doc, u.id, childId, kind.value);
  }
  app.commit();
  toast(pA && pB ? 'Parents added' : 'Parent added');
  if (app.refreshSheet) app.refreshSheet();
}

async function addRelative(app, id, kind) {
  const doc = app.doc;
  const nm = M.personName(doc, id);
  if (kind === 'parent') return addParentsFlow(app, id);
  let other = null;
  if (kind === 'child') {
    const partners = M.unionsOf(doc, id).filter((u) => u.partners.length === 2).map((u) => u.partners.find((x) => x !== id));
    if (partners.length) {
      other = await chooseOne('Who is the other parent?', null, [
        ...partners.map((pid) => [pid, M.personName(doc, pid)]),
        ['', 'Someone else or unknown'],
      ]);
      if (other === undefined) return;
    }
  }
  const titles = { child: `Add a child of ${nm}`, partner: `Add a partner for ${nm}`, parent: `Add a parent of ${nm}`, sibling: `Add a brother or sister of ${nm}`, link: `Connect ${nm} to…` };
  const exclude = [id];
  const newId = await choosePerson(app, { title: titles[kind], exclude });
  if (!newId) return;
  if (kind === 'child') M.linkChild(doc, id, newId, other || null);
  if (kind === 'partner') M.linkPartners(doc, id, newId);
  if (kind === 'parent') M.linkParent(doc, id, newId);
  if (kind === 'sibling') M.linkSibling(doc, id, newId);
  if (kind === 'link') {
    const label = await askText('What is the connection?', 'Label', '', 'Add', 'e.g. rival, best friend, mentor');
    if (label === null) return;
    M.addLink(doc, id, newId, label);
  }
  app.commit();
  toast(`Added ${M.personName(doc, newId)}`);
  if (app.refreshSheet) app.refreshSheet();
}

// ---------------- person panel ----------------

export function openPerson(app, id) {
  const build = () => {
    const doc = app.doc;
    const p = doc.people[id];
    if (!p || p.deleted) { closeSheet(); return; }
    const save = (patch) => { M.updatePerson(doc, id, patch); app.commit(); };

    // Photo + name
    const photoBtn = h('button', { class: 'photo', type: 'button', 'aria-label': 'Photo' }, p.photo ? '' : initials(p.name), h('span', { class: 'cam' }, icon('camera')));
    if (p.photo) store.imageUrl(p.photo, doc.id).then((u) => { if (u) photoBtn.style.backgroundImage = `url("${u}")`; });
    photoBtn.addEventListener('click', async () => {
      let choice = 'change';
      if (p.photo) {
        choice = await chooseOne('Photo', null, [['adjust', 'Move or zoom the picture'], ['change', 'Choose a different picture'], ['remove', 'Remove picture']]);
        if (!choice) return;
        if (choice === 'remove') { save({ photo: null, photoSrc: null, photoCrop: null }); return build(); }
      }
      try {
        let srcId, srcBlob, crop = null;
        if (choice === 'adjust') {
          // Re-crop from the full original picture (older photos only have the cropped one).
          srcId = p.photoSrc || p.photo;
          await store.imageUrl(srcId, doc.id);
          const rec = await store.getImage(srcId);
          if (!rec) return toast("Couldn't load the picture. Are you online?");
          srcBlob = rec.blob;
          crop = p.photoSrc ? p.photoCrop : null;
        } else {
          const file = await pickFile();
          if (!file) return;
          srcBlob = await resizeImage(file, 1600);
          srcId = null;
        }
        const res = await cropPhoto(srcBlob, crop);
        if (!res) return;
        if (!srcId) {
          srcId = M.uid();
          await store.putImage({ id: srcId, treeId: doc.id, blob: srcBlob, uploaded: false });
        }
        const imgId = M.uid();
        await store.putImage({ id: imgId, treeId: doc.id, blob: res.blob, uploaded: false });
        save({ photo: imgId, photoSrc: srcId, photoCrop: res.crop });
        build();
      } catch (e) {
        toast(e.message || "Couldn't use that picture");
      }
    });
    const nameInp = field(null, p.name, (v) => { save({ name: v }); $('sheetTitle').textContent = v || 'Unnamed'; }, { class: 'name-input', placeholder: 'Name' });
    const akaInp = field(null, p.aka, (v) => save({ aka: v }), { placeholder: 'Also known as / title' });

    const kids = [];
    kids.push(h('div', { class: 'photo-row' }, photoBtn, h('div', { class: 'fields' }, nameInp, akaInp)));

    // Gender
    const genderBox = h('div', { class: 'sec' });
    const drawGender = () => {
      const g = p.gender || 'unknown';
      genderBox.replaceChildren(
        h('h3', {}, 'Gender'),
        h('div', { class: 'seg', role: 'group', 'aria-label': 'Gender' }, M.GENDERS.map(([v, l]) =>
          h('button', { type: 'button', 'aria-pressed': String(g === v), onclick: () => {
            save({ gender: v });
            drawGender();
            if (v === 'other') genderBox.querySelector('input')?.focus();
          } }, l))),
        g === 'other' ? field(null, p.genderCustom, (v) => save({ genderCustom: v }), { placeholder: 'Describe it, e.g. non-binary, shapeshifter' }) : null);
    };
    drawGender();
    kids.push(genderBox);
    kids.push(h('div', { class: 'row2' },
      field('Born', p.born, (v) => save({ born: v }), { placeholder: 'e.g. 1832' }),
      field('Died', p.died, (v) => save({ died: v }), { placeholder: 'e.g. Third Age 3019' })));

    // Other dates
    const events = h('div', { class: 'sec' });
    const drawEvents = () => {
      events.replaceChildren(...(p.events || []).map((ev, i) => h('div', { class: 'event-row' },
        h('input', { value: ev.label, placeholder: 'What happened', oninput: (e) => { p.events[i].label = e.target.value; save({ events: p.events }); } }),
        h('input', { value: ev.date, placeholder: 'When', oninput: (e) => { p.events[i].date = e.target.value; save({ events: p.events }); } }),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Remove date', onclick: () => { p.events.splice(i, 1); save({ events: p.events }); drawEvents(); } }, icon('trash')))),
      h('button', { class: 'btn small', type: 'button', onclick: () => { p.events = [...(p.events || []), { label: '', date: '' }]; save({ events: p.events }); drawEvents(); events.querySelector('.event-row:last-of-type input')?.focus(); } }, '+ Add a date'));
    };
    drawEvents();
    kids.push(h('div', { class: 'sec' }, h('h3', {}, 'Other dates'), events));

    // Groups
    const groups = M.live(doc.groups);
    const chips = h('div', { class: 'chips' },
      groups.map((g) => h('button', {
        class: 'chip', type: 'button', style: { '--c': g.colour }, 'aria-pressed': String((p.groups || []).includes(g.id)),
        onclick: (e) => {
          const on = !(p.groups || []).includes(g.id);
          save({ groups: on ? [...(p.groups || []), g.id] : p.groups.filter((x) => x !== g.id) });
          e.currentTarget.setAttribute('aria-pressed', String(on));
        },
      }, g.name)),
      h('button', { class: 'chip add', type: 'button', onclick: async () => {
        const name = await askText('New group', 'Name', '', 'Add', 'e.g. House Stark, Gryffindor');
        if (!name) return;
        const g = M.addGroup(doc, name);
        save({ groups: [...(p.groups || []), g.id] });
        build();
      } }, '+ New group'));
    kids.push(h('div', { class: 'sec' }, h('h3', {}, 'Groups'), chips));

    // Notes
    kids.push(h('div', { class: 'sec' }, h('h3', {}, 'Notes'), field(null, p.notes, (v) => save({ notes: v }), { multiline: true, rows: 5, placeholder: 'Anything to remember about this character' })));

    // Spoilers
    const rv = revealPicker(app, p, (reveal) => save({ reveal }));
    kids.push(h('div', { class: 'sec' }, h('h3', {}, 'Spoilers'),
      rv || h('p', { class: 'hint' }, 'Add the books in ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); openTreeSettings(app); } }, 'tree settings'), " to hide characters you haven't reached yet.")));

    // Relationships
    kids.push(relationships(app, id, build));

    kids.push(h('div', { class: 'sec' }, h('h3', {}, 'Move'),
      h('button', { class: 'btn', type: 'button', onclick: () => {
        const ids = [...M.branchOf(doc, id)].filter((x) => app.lay.pos[x]);
        closeSheet(true);
        app.selectMany(ids);
        toast(ids.length > 1 ? `${ids.length} characters selected. Drag any of them to move the branch.` : 'Selected. Drag to move.', 4000);
      } }, `Select ${p.name || 'them'} and their descendants`),
      h('p', { class: 'hint' }, 'Picks them, their partners and everyone descended from them, so you can drag the whole branch somewhere else.')));

    kids.push(h('div', { class: 'sec danger-zone' },
      h('button', { class: 'btn danger', type: 'button', onclick: async () => {
        if (!(await confirmBox(`Delete ${p.name || 'this character'}?`, 'They will be removed from the tree along with their family links.', 'Delete', true))) return;
        M.deletePerson(doc, id);
        app.selected = null;
        closeSheet();
        app.commit();
      } }, icon('trash'), 'Delete character')));

    openSheet(p.name || 'Unnamed', kids, {
      onClose: () => { app.refreshSheet = null; if (app.selected === id) { app.selected = null; app.render(); } },
    });
    app.refreshSheet = () => {
      if (document.activeElement && $('sheetBody').contains(document.activeElement) && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
      const top = $('sheetBody').scrollTop;
      build();
      $('sheetBody').scrollTop = top;
    };
  };
  build();
}

function relationships(app, id, rebuild) {
  const doc = app.doc;
  const box = h('div', { class: 'sec' });
  const changed = () => { app.commit(); rebuild(); };

  // Parents
  const parentUs = M.parentUnionsOf(doc, id);
  box.append(h('h3', {}, 'Parents'));
  if (!parentUs.length) box.append(h('p', { class: 'hint' }, 'No parents added.'));
  for (const u of parentUs) {
    const me = u.children.find((c) => c.id === id);
    const names = u.partners.length ? u.partners.map((pid) => who(app, pid)) : [h('span', { class: 'rel-who' }, 'Unknown parents', h('small', {}, 'brothers and sisters grouped together'))];
    box.append(h('div', { class: 'rel' },
      h('div', { class: 'rel-head' }, ...u.partners.map((pid) => face(app, pid)), h('div', { style: { flex: 1, minWidth: 0 } }, names)),
      h('div', { class: 'rel-opts' },
        h('select', { 'aria-label': 'Kind of child', onchange: (e) => { M.setChildKind(doc, u.id, id, e.target.value); app.commit(); } }, opts(M.CHILD_KINDS.map(([v, l]) => [v, `${l} child`]), me.kind)),
        u.partners.length < 2 ? h('button', { class: 'btn small', type: 'button', onclick: async () => {
          const pid = await choosePerson(app, { title: 'Add another parent', exclude: [id, ...u.partners] });
          if (!pid) return;
          if (u.partners.length === 0) { u.partners.push(pid); M.updateUnion(doc, u.id, { partners: u.partners }); }
          else M.updateUnion(doc, u.id, { partners: [...u.partners, pid], type: u.type === 'unknown' ? 'married' : u.type });
          changed();
        } }, '+ Parent') : null,
        h('button', { class: 'btn small danger', type: 'button', onclick: () => { M.removeFromUnion(doc, u.id, id); changed(); } }, 'Unlink'))));
  }

  // Siblings (worked out from parents)
  const sibs = new Map();
  for (const u of parentUs) for (const c of u.children) if (c.id !== id) sibs.set(c.id, 'full');
  for (const u of parentUs) for (const par of u.partners) for (const u2 of M.unionsOf(doc, par)) {
    if (u2.id === u.id) continue;
    for (const c of u2.children) if (c.id !== id && !sibs.has(c.id)) sibs.set(c.id, 'half');
  }
  if (sibs.size) {
    box.append(h('h3', {}, 'Brothers & sisters'), h('div', { class: 'chips' },
      [...sibs].map(([sid, k]) => h('button', { class: 'chip', type: 'button', onclick: () => app.select(sid, { open: true, center: true }) }, M.personName(doc, sid) + (k === 'half' ? ' (half)' : '')))));
  }

  // Partners
  const partnerUs = M.unionsOf(doc, id).filter((u) => u.partners.length === 2);
  box.append(h('h3', {}, 'Partners'));
  if (!partnerUs.length) box.append(h('p', { class: 'hint' }, 'No partners added.'));
  for (const u of partnerUs) {
    const other = u.partners.find((x) => x !== id);
    const upd = (patch) => { M.updateUnion(doc, u.id, patch); app.commit(); };
    box.append(h('div', { class: 'rel' },
      h('div', { class: 'rel-head' }, face(app, other), who(app, other, u.children.length ? `${u.children.length} child${u.children.length > 1 ? 'ren' : ''} together` : null)),
      h('div', { class: 'rel-opts' },
        h('select', { 'aria-label': 'Relationship', onchange: (e) => upd({ type: e.target.value }) }, opts(M.UNION_TYPES, u.type)),
        h('select', { 'aria-label': 'Status', onchange: (e) => upd({ status: e.target.value }) }, opts(M.UNION_STATUS, u.status))),
      h('div', { class: 'rel-opts' },
        h('input', { placeholder: 'From (date)', value: u.start || '', oninput: (e) => upd({ start: e.target.value }) }),
        h('input', { placeholder: 'To (date)', value: u.end || '', oninput: (e) => upd({ end: e.target.value }) }),
        h('button', { class: 'btn small danger', type: 'button', onclick: async () => {
          if (!(await confirmBox('Remove this partnership?', u.children.length ? `Their children will stay with ${M.personName(doc, id)}.` : null, 'Remove', true))) return;
          M.removeFromUnion(doc, u.id, other);
          changed();
        } }, 'Unlink'))));
  }

  // Children
  const childUs = M.unionsOf(doc, id).filter((u) => u.children.length);
  box.append(h('h3', {}, 'Children'));
  if (!childUs.length) box.append(h('p', { class: 'hint' }, 'No children added.'));
  for (const u of childUs) {
    const other = u.partners.find((x) => x !== id);
    u.children.forEach((c, i) => {
      box.append(h('div', { class: 'rel' },
        h('div', { class: 'rel-head' }, face(app, c.id), who(app, c.id, other ? `with ${M.personName(doc, other)}` : null),
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Move earlier', disabled: i === 0, onclick: () => { M.moveChild(doc, u.id, c.id, -1); changed(); } }, icon('up')),
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Move later', disabled: i === u.children.length - 1, onclick: () => { M.moveChild(doc, u.id, c.id, 1); changed(); } }, icon('down'))),
        h('div', { class: 'rel-opts' },
          h('select', { 'aria-label': 'Kind of child', onchange: (e) => { M.setChildKind(doc, u.id, c.id, e.target.value); app.commit(); } }, opts(M.CHILD_KINDS.map(([v, l]) => [v, `${l} child`]), c.kind)),
          h('button', { class: 'btn small danger', type: 'button', onclick: () => { M.removeFromUnion(doc, u.id, c.id); changed(); } }, 'Unlink'))));
    });
  }

  // Other connections
  const links = M.linksOf(doc, id);
  box.append(h('h3', {}, 'Other connections'));
  if (!links.length) box.append(h('p', { class: 'hint' }, 'Friends, rivals, mentors… anything that isn\'t family.'));
  for (const l of links) {
    const other = l.a === id ? l.b : l.a;
    box.append(h('div', { class: 'rel' },
      h('div', { class: 'rel-head' }, face(app, other), who(app, other)),
      h('div', { class: 'rel-opts' },
        h('input', { value: l.label, placeholder: 'e.g. rival', oninput: (e) => { M.updateLink(doc, l.id, { label: e.target.value }); app.commit(); } }),
        h('input', { type: 'color', value: l.colour, 'aria-label': 'Line colour', oninput: (e) => { M.updateLink(doc, l.id, { colour: e.target.value }); app.commit(); }, style: { flex: '0 0 44px' } }),
        h('button', { class: 'btn small danger', type: 'button', onclick: () => { M.deleteLink(doc, l.id); changed(); } }, 'Remove'))));
  }

  box.append(h('h3', {}, 'Add'), h('div', { class: 'add-rel' },
    h('button', { class: 'btn', type: 'button', onclick: () => addRelative(app, id, 'parent') }, '+ Parents'),
    h('button', { class: 'btn', type: 'button', onclick: () => addRelative(app, id, 'partner') }, '+ Partner'),
    h('button', { class: 'btn', type: 'button', onclick: () => addRelative(app, id, 'child') }, '+ Child'),
    h('button', { class: 'btn', type: 'button', onclick: () => addRelative(app, id, 'sibling') }, '+ Brother / sister'),
    h('button', { class: 'btn', type: 'button', style: { gridColumn: '1 / -1' }, onclick: () => addRelative(app, id, 'link') }, '+ Other connection (friend, rival…)')));
  return box;
}

// ---------------- tree settings ----------------

export function openTreeSettings(app) {
  const build = () => {
    const doc = app.doc;
    const m = doc.meta;
    const setM = (patch, redraw) => { M.setMeta(doc, patch); app.commit(); if (redraw) build(); };
    const kids = [];

    kids.push(h('div', { class: 'sec' },
      field('Name', m.name, (v) => { setM({ name: v }); }),
      field('Author', m.author, (v) => setM({ author: v }))));

    // Books
    const books = h('div', { class: 'sec' });
    m.books.forEach((b, i) => books.append(h('div', { class: 'book-row' },
      h('input', { value: b.title, placeholder: `Book ${i + 1}`, oninput: (e) => { m.books[i].title = e.target.value; setM({ books: m.books }); } }),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Move up', disabled: i === 0, onclick: () => { [m.books[i - 1], m.books[i]] = [m.books[i], m.books[i - 1]]; setM({ books: m.books }, true); } }, icon('up')),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Remove book', onclick: () => { m.books.splice(i, 1); setM({ books: m.books }, true); } }, icon('trash')))));
    books.append(h('button', { class: 'btn small', type: 'button', onclick: () => { m.books.push({ id: M.uid(), title: '' }); setM({ books: m.books }, true); $('sheetBody').querySelectorAll('.book-row input')[m.books.length - 1]?.focus(); } }, '+ Add a book'));
    kids.push(h('div', { class: 'sec' }, h('h3', {}, 'Books in order'), h('p', { class: 'hint' }, 'List the books so you can mark where each character first appears, and hide spoilers.'), books));

    if (m.books.length) kids.push(progressSection(app, build));

    // Groups
    const gbox = h('div', { class: 'sec' });
    for (const g of M.live(doc.groups)) {
      gbox.append(h('div', { class: 'sec rel' },
        h('div', { class: 'group-row' },
          h('input', { type: 'text', value: g.name, oninput: (e) => { M.updateGroup(doc, g.id, { name: e.target.value }); app.commit(); } }),
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Delete group', onclick: async () => {
            if (!(await confirmBox(`Delete the group "${g.name}"?`, 'Characters stay in the tree; they just leave this group.', 'Delete', true))) return;
            M.deleteGroup(doc, g.id); app.commit(); build();
          } }, icon('trash'))),
        h('div', { class: 'swatches' }, M.GROUP_COLOURS.map((c) => h('button', {
          class: 'swatch', type: 'button', style: { background: c }, 'aria-label': c, 'aria-pressed': String(c === g.colour),
          onclick: () => { M.updateGroup(doc, g.id, { colour: c }); app.commit(); build(); },
        })))));
    }
    gbox.append(h('button', { class: 'btn small', type: 'button', onclick: async () => {
      const name = await askText('New group', 'Name', '', 'Add', 'e.g. House Stark, Gryffindor');
      if (!name) return;
      M.addGroup(doc, name); app.commit(); build();
    } }, '+ Add a group'));
    kids.push(h('div', { class: 'sec' }, h('h3', {}, 'Groups & colours'), h('p', { class: 'hint' }, 'Houses, families, clans or teams. Characters show the colour of their group.'), gbox));

    // Look (colours and background) for this tree
    const own = !!m.theme;
    const look = h('div', { class: 'sec' },
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Look of this tree' },
        h('button', { type: 'button', 'aria-pressed': String(!own), onclick: () => { if (own) { setM({ theme: null }); app.applyTreeLook(); app.render(); build(); } } }, 'My usual look'),
        h('button', { type: 'button', 'aria-pressed': String(own), onclick: () => { if (!own) { setM({ theme: theme.usualLook() }); app.applyTreeLook(); app.render(); build(); } } }, 'Its own look')),
      own
        ? theme.lookEditor(m.theme, (l) => { setM({ theme: l }); app.applyTreeLook(); app.render(); })
        : h('p', { class: 'hint' }, 'Choose "Its own look" to give this tree its own colours and background, e.g. to match the book cover.'));
    kids.push(h('div', { class: 'sec' }, h('h3', {}, 'Colours & background'), look));

    kids.push(h('div', { class: 'sec' }, h('h3', {}, 'What the lines mean'), legend()));

    kids.push(h('div', { class: 'sec' }, h('h3', {}, 'Layout'),
      h('label', { class: 'toggle-row' }, 'Snap characters to the grid',
        h('input', { type: 'checkbox', checked: m.snap !== false, onchange: (e) => { setM({ snap: e.target.checked }); } })),
      h('p', { class: 'hint' }, 'Drag characters to move them. Tidy up puts everyone back in their automatic place.'),
      h('button', { class: 'btn', type: 'button', onclick: () => { M.clearPositions(doc); app.commit(); app.vp.fit(app.lay.bounds); toast('Tidied up'); } }, 'Tidy up layout')));

    kids.push(h('div', { class: 'sec' }, h('h3', {}, 'Ideas & problems'),
      h('button', { class: 'btn', type: 'button', onclick: () => openFeedback(app) }, '💡 Suggest an improvement')));

    kids.push(h('div', { class: 'sec danger-zone' },
      h('button', { class: 'btn danger', type: 'button', onclick: async () => {
        if (!(await confirmBox(`Delete "${m.name}"?`, 'It moves to "Recently deleted" on the trees page, where you can restore it.', 'Delete', true))) return;
        M.setMeta(doc, { deleted: true });
        closeSheet(true);
        app.commit();
        history.back();
      } }, icon('trash'), 'Delete this tree')));

    openSheet('Tree settings', kids, { onClose: () => { app.refreshSheet = null; } });
    app.refreshSheet = () => {
      if (document.activeElement && $('sheetBody').contains(document.activeElement)) return;
      build();
    };
  };
  build();
}

function progressSection(app, rebuild) {
  const doc = app.doc;
  const m = doc.meta;
  const prog = m.progress || {};
  const set = (patch) => { M.setMeta(doc, patch); app.commit(); };
  const toggle = h('input', { type: 'checkbox', checked: !!m.spoilers, onchange: (e) => {
    set({ spoilers: e.target.checked, progress: m.progress || (m.books[0] ? { book: m.books[0].id, chapter: '' } : null) });
    rebuild && rebuild();
  } });
  const bookSel = h('select', { onchange: (e) => set({ progress: { book: e.target.value, chapter: '' } }) },
    opts(m.books.map((b, i) => [b.id, b.title || `Book ${i + 1}`]), prog.book));
  const ch = h('input', { type: 'number', inputmode: 'numeric', min: 0, placeholder: 'Chapter (all)', value: prog.chapter || '',
    oninput: (e) => set({ progress: { book: bookSel.value, chapter: e.target.value } }), style: { maxWidth: '140px' } });
  return h('div', { class: 'sec' }, h('h3', {}, 'Spoiler protection'),
    h('label', { class: 'toggle-row' }, "Hide characters I haven't reached yet", toggle),
    m.spoilers ? h('label', {}, "I've read up to", h('div', { class: 'event-row' }, bookSel, ch)) : null,
    m.spoilers ? h('p', { class: 'hint' }, 'Characters, partners and connections marked as appearing later are hidden. Leave the chapter empty if you finished the book.') : null);
}

export function openProgress(app) {
  const build = () => openSheet('Reading progress', [progressSection(app, build)], { short: true });
  build();
}

function legend() {
  const row = (svg, text) => h('div', { class: 'event-row' }, h('span', { html: `<svg width="70" height="20" viewBox="0 0 70 20" style="color:var(--line)">${svg}</svg>` }), h('span', { class: 'hint' }, text));
  const ln = (dash, y = 10, w = 2) => `<line x1="2" y1="${y}" x2="68" y2="${y}" stroke="currentColor" stroke-width="${w}" ${dash ? `stroke-dasharray="${dash}"` : ''}/>`;
  return h('div', { class: 'sec' },
    row(ln('', 7) + ln('', 13), 'Married'),
    row(ln(''), 'Partners'),
    row(ln('8 6'), 'Engaged'),
    row(ln('') + '<line x1="30" y1="2" x2="38" y2="18" stroke="currentColor" stroke-width="2"/><line x1="36" y1="2" x2="44" y2="18" stroke="currentColor" stroke-width="2"/>', 'Divorced'),
    row(ln('1 6', 10, 2.5), 'Affair'),
    row(ln('7 5'), 'Adopted child'),
    row(ln('2 5'), 'Step-child'),
    row(ln('10 4 2 4'), 'Foster child'),
    row('<path d="M2,14 Q35,0 68,14" stroke="#9a4a8f" stroke-width="2.5" fill="none" stroke-dasharray="6 5"/>', 'Other connection (friend, rival…)'));
}
