// E2E 하네스 (node test/e2e/run.mjs, playwright 필요): 정적 파일(운영 nginx와 같은 허용 규칙) + /api (실제 server/index.js, 테스트 서명 키)
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

import { fileURLToPath } from 'node:url';

const ROOT = process.env.APP_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { createApp } = await import(`${ROOT}/server/index.js`);
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
export const CLIENT_ID = 'e2e.apps.googleusercontent.com';
const dataDir = await fs.mkdtemp('/tmp/e2e-data-');

const api = createApp({
  clientId: CLIENT_ID, secret: 'x'.repeat(40), dataDir, secureCookie: false,
  getKey: async (kid) => (kid === 'k1' ? publicKey : null),
});

export function token(email = 'me@example.com', sub = '111', name = '테스터') {
  const now = Math.floor(Date.now() / 1000);
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const h = enc({ alg: 'RS256', kid: 'k1', typ: 'JWT' });
  const b = enc({ iss: 'https://accounts.google.com', aud: CLIENT_ID, sub, email, email_verified: true, name, iat: now, exp: now + 3600 });
  return `${h}.${b}.${crypto.sign('RSA-SHA256', Buffer.from(`${h}.${b}`), privateKey).toString('base64url')}`;
}

const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' };

async function serveStatic(req, res) {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = p === '/' ? '/index.html' : p;
  if (!(file === '/index.html' || file.startsWith('/src/')) || file.includes('..')) {
    res.writeHead(404); return res.end('404');
  }
  try {
    const data = await fs.readFile(path.join(ROOT, file));
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404); res.end('404');
  }
}

export function start(port, withApi = true) {
  const server = http.createServer((req, res) => {
    if (withApi && req.url.startsWith('/api/')) return api(req, res);
    if (req.url.startsWith('/__token')) {
      const q = new URL(req.url, 'http://x').searchParams;
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end(token(q.get('email') || undefined, q.get('sub') || undefined));
    }
    return serveStatic(req, res);
  });
  return new Promise((r) => server.listen(port, '127.0.0.1', () => r(server)));
}
export { dataDir };
