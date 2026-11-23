// A tiny stand-in for the parts of the GitHub API the app uses, for local testing.
//   node dev/mock-github.mjs [port]
// Accepts the key "test-key". Then, in the app on localhost, run in the console:
//   localStorage.setItem('ftc.api', 'http://localhost:8788')
// and connect with repo "test/family-trees" and key "test-key".

import http from 'node:http';
import crypto from 'node:crypto';

const port = Number(process.argv[2] || 8788);
const files = new Map(); // path -> {sha, content(base64)}
const sha = (b64) => crypto.createHash('sha1').update(b64).digest('hex');

const send = (res, status, body) => {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-GitHub-Api-Version, Accept',
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  });
  res.end(body === undefined ? '' : JSON.stringify(body));
};

http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204);
  if (req.headers.authorization !== 'Bearer test-key') return send(res, 401, { message: 'Bad credentials' });
  const url = new URL(req.url, 'http://x');
  const m = url.pathname.match(/^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/);
  if (!m) return send(res, 404, { message: 'Not Found' });
  const rest = m[3] || '';
  let body = '';
  for await (const chunk of req) body += chunk;
  console.log(req.method, rest);

  if (!rest) return send(res, 200, { default_branch: 'main', permissions: { push: true } });
  if (rest === '/git/trees/HEAD') {
    if (!files.size) return send(res, 409, { message: 'Git Repository is empty.' });
    return send(res, 200, { tree: [...files].map(([path, f]) => ({ path, type: 'blob', sha: f.sha })) });
  }
  let b = rest.match(/^\/git\/blobs\/(\w+)$/);
  if (b) {
    const f = [...files.values()].find((x) => x.sha === b[1]);
    return f ? send(res, 200, { content: f.content, encoding: 'base64' }) : send(res, 404, { message: 'Not Found' });
  }
  b = rest.match(/^\/contents\/(.+)$/);
  if (b) {
    const path = decodeURI(b[1]);
    const f = files.get(path);
    if (req.method === 'GET') return f ? send(res, 200, { sha: f.sha, content: f.content }) : send(res, 404, { message: 'Not Found' });
    const { content, sha: given } = JSON.parse(body);
    if (f && !given) return send(res, 422, { message: '"sha" wasn\'t supplied.' });
    if (f && given !== f.sha) return send(res, 409, { message: 'does not match' });
    if (!f && given) return send(res, 404, { message: 'Not Found' });
    const n = { sha: sha(content), content };
    files.set(path, n);
    return send(res, f ? 200 : 201, { content: { sha: n.sha, path } });
  }
  send(res, 404, { message: 'Not Found' });
}).listen(port, () => console.log(`mock GitHub on http://localhost:${port}`));
