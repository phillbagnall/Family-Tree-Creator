// "Suggest an improvement": ideas and problems are sent to whoever looks after the app.

import * as sync from './sync.js';
import * as M from './model.js';
import { h, openSheet, closeSheet, toast, timeAgo } from './ui.js';

export const APP_VERSION = 'v6'; // keep in step with VERSION in sw.js

const SENT = 'ftc.feedbackSent';
const KINDS = [
  ['idea', '💡 An idea'],
  ['problem', '🐞 Something isn\'t working'],
  ['other', '💬 Something else'],
];

function device() {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android'
    : /Windows/.test(ua) ? 'Windows PC' : /Macintosh/.test(ua) ? (navigator.maxTouchPoints > 1 ? 'iPad' : 'Mac') : 'Unknown device';
  const app = matchMedia('(display-mode: standalone)').matches || navigator.standalone ? 'installed app' : 'browser';
  return `${os}, ${app}, ${window.innerWidth}×${window.innerHeight}`;
}

const sentList = () => { try { return JSON.parse(localStorage.getItem(SENT)) || []; } catch { return []; } };

export function openFeedback(app) {
  let kind = 'idea';
  const kindRow = h('div', { class: 'choice-list' });
  const drawKinds = () => kindRow.replaceChildren(...KINDS.map(([v, l]) =>
    h('button', { type: 'button', class: `btn${v === kind ? ' primary' : ''}`, 'aria-pressed': String(v === kind), onclick: () => { kind = v; drawKinds(); } }, l)));
  drawKinds();
  const text = h('textarea', { rows: 6, placeholder: 'What would make the app better? If something went wrong, what were you doing?' });
  const send = h('button', { class: 'btn primary big', type: 'button', onclick: async () => {
    const t = text.value.trim();
    if (!t) { toast('Write something first'); text.focus(); return; }
    const now = new Date();
    const entry = {
      id: `${now.toISOString().slice(0, 19).replace(/[:T]/g, '-')}-${M.uid().slice(0, 4)}`,
      kind, text: t, sentAt: now.toISOString(), device: device(), version: APP_VERSION,
      tree: app.doc ? app.doc.meta.name : null,
    };
    send.disabled = true;
    const reached = await sync.sendFeedback(entry);
    localStorage.setItem(SENT, JSON.stringify([{ kind, text: t, at: Date.now() }, ...sentList()].slice(0, 20)));
    closeSheet();
    toast(reached ? 'Sent. Thank you!' : "Saved. It'll be sent when you're back online.", 3500);
  } }, 'Send');

  const past = sentList();
  openSheet('Suggest an improvement', [
    h('p', { class: 'hint' }, "Ideas, wishes or things that don't work: they go straight to the person who builds the app."),
    h('div', { class: 'sec' }, h('h3', {}, 'What is it?'), kindRow),
    h('div', { class: 'sec' }, h('h3', {}, 'Tell us about it'), text),
    send,
    past.length ? h('div', { class: 'sec' }, h('h3', {}, "What you've sent"),
      past.map((f) => h('div', { class: 'rel' },
        h('div', { class: 'hint' }, `${(KINDS.find((k) => k[0] === f.kind) || KINDS[2])[1]} · ${timeAgo(f.at)}`),
        h('div', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, f.text)))) : null,
  ]);
  setTimeout(() => text.focus(), 100);
}
