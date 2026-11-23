// Keeps the GitHub key on the device, locked with the PIN.
// The key is encrypted with AES-GCM using a key derived from the PIN, so it
// can't be read from the device's storage without the PIN.

const STORE_KEY = 'ftc.auth';
const SESSION_KEY = 'ftc.session';
const ITERATIONS = 250000;

const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(pin, salt) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function read() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)); } catch { return null; }
}

export const isSetUp = () => !!read();
export const repoName = () => read()?.repo || '';

export async function save({ token, repo, pin }) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pin, salt);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(token));
  localStorage.setItem(STORE_KEY, JSON.stringify({ repo, salt: b64(salt), iv: b64(iv), ct: b64(ct), fails: 0 }));
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token, repo }));
}

// Seconds to wait before another PIN try is allowed (after repeated wrong PINs).
export function lockoutRemaining() {
  const a = read();
  if (!a || !a.lockUntil) return 0;
  return Math.max(0, Math.ceil((a.lockUntil - Date.now()) / 1000));
}

export async function unlock(pin) {
  const a = read();
  if (!a) throw new Error('Not set up');
  if (lockoutRemaining()) throw new Error('wait');
  try {
    const key = await deriveKey(pin, unb64(a.salt));
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(a.iv) }, key, unb64(a.ct));
    const token = dec.decode(pt);
    a.fails = 0;
    delete a.lockUntil;
    localStorage.setItem(STORE_KEY, JSON.stringify(a));
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token, repo: a.repo }));
    return { token, repo: a.repo };
  } catch {
    a.fails = (a.fails || 0) + 1;
    if (a.fails >= 5) a.lockUntil = Date.now() + 30000 * Math.min(10, a.fails - 4);
    localStorage.setItem(STORE_KEY, JSON.stringify(a));
    throw new Error('wrong');
  }
}

// Already unlocked in this browser session?
export function session() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch { return null; }
}

export function lock() {
  sessionStorage.removeItem(SESSION_KEY);
}

export async function changePin(newPin) {
  const s = session();
  if (!s) throw new Error('Locked');
  await save({ token: s.token, repo: s.repo, pin: newPin });
}

export function forget() {
  localStorage.removeItem(STORE_KEY);
  sessionStorage.removeItem(SESSION_KEY);
}
