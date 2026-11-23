// Minimal GitHub REST client for reading and writing files in one repo.

export class GitHubError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(b64) {
  const s = atob(b64.replace(/\s/g, ''));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export const encodeText = (text) => toBase64(new TextEncoder().encode(text));
export const decodeText = (b64) => new TextDecoder().decode(fromBase64(b64));

// For local testing only: a fake GitHub server can be used on localhost.
function apiBase() {
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  return (local && localStorage.getItem('ftc.api')) || 'https://api.github.com';
}

export class GitHub {
  constructor({ owner, repo, token }) {
    this.api = apiBase();
    this.owner = owner;
    this.repo = repo;
    this.token = token;
    this.branch = null;
  }

  async req(path, { method = 'GET', body, accept } = {}) {
    let res;
    try {
      res = await fetch(`${this.api}${path}`, {
        method,
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: accept || 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new GitHubError(0, 'No connection to GitHub');
    }
    if (!res.ok) {
      let msg = res.statusText;
      try { msg = (await res.json()).message || msg; } catch { /* ignore */ }
      throw new GitHubError(res.status, msg);
    }
    if (res.status === 204) return null;
    return accept === 'raw' ? res : res.json();
  }

  get base() { return `/repos/${this.owner}/${this.repo}`; }

  // Confirms the key works and can write. Returns repo info.
  async checkRepo() {
    const r = await this.req(this.base);
    if (r.permissions && !r.permissions.push) throw new GitHubError(403, 'This key can read the repo but not save to it');
    this.branch = r.default_branch;
    return r;
  }

  // Every file path in the repo with its blob sha. Empty repo -> [].
  async listFiles() {
    try {
      const r = await this.req(`${this.base}/git/trees/HEAD?recursive=1`);
      return r.tree.filter((e) => e.type === 'blob').map((e) => ({ path: e.path, sha: e.sha }));
    } catch (e) {
      if (e.status === 409 || e.status === 404) return []; // empty repository
      throw e;
    }
  }

  async getBlob(sha) {
    const r = await this.req(`${this.base}/git/blobs/${sha}`);
    return fromBase64(r.content);
  }

  async getFile(path) {
    try {
      const r = await this.req(`${this.base}/contents/${encodeURI(path)}`);
      const bytes = r.content ? fromBase64(r.content) : await this.getBlob(r.sha);
      return { sha: r.sha, bytes };
    } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
  }

  // Create or update a file. Pass the current sha when updating.
  async putFile(path, base64, sha, message) {
    const r = await this.req(`${this.base}/contents/${encodeURI(path)}`, {
      method: 'PUT',
      body: { message: message || `Update ${path}`, content: base64, ...(sha ? { sha } : {}) },
    });
    return r.content.sha;
  }

  putBytes(path, bytes, sha, message) {
    return this.putFile(path, toBase64(bytes), sha, message);
  }
}
