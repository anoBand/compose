// Compose API 서버: Google 로그인 + 사용자별 악보 저장 (Node 22+, 외부 의존성 없음)
//
// 환경 변수
//   GOOGLE_CLIENT_ID  Google OAuth 클라이언트 ID (없으면 로그인 꺼짐)
//   SESSION_SECRET    세션 쿠키 서명 키 (32자 이상 임의 문자열)
//   ALLOWED_EMAILS    로그인을 허용할 이메일, 쉼표로 구분 (비우면 모든 Google 계정)
//   DATA_DIR          저장 폴더 (기본 ./data)
//   PORT              기본 3000
//   COOKIE_SECURE     기본 1 (https 전용 쿠키). 로컬 http 개발 때만 0
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import {
  createKeyStore, verifyGoogleIdToken, signSession, verifySession, parseCookies, AuthError, GOOGLE_JWKS_URL,
} from './auth.js';
import { createStore, isChartId, summarize } from './store.js';
import { normalizeDoc } from '../src/core/doc.js';

const COOKIE = 'compose_session';
const SESSION_DAYS = 30;
const MAX_BODY = 1024 * 1024;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new HttpError(413, '악보가 너무 큽니다')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJsonBody(req) {
  const text = await readBody(req);
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new HttpError(400, 'JSON 형식이 아닙니다');
  }
}

function send(res, status, body, headers = {}) {
  const data = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(data);
}

function cleanDoc(raw) {
  try {
    return normalizeDoc(raw);
  } catch (e) {
    throw new HttpError(400, e.message);
  }
}

export function createApp(config) {
  const {
    clientId = '', secret, allowedEmails = [], dataDir = './data', secureCookie = true,
    getKey = createKeyStore(config.jwksUrl || GOOGLE_JWKS_URL), now = () => Date.now(),
  } = config;
  if (!secret || secret.length < 32) throw new Error('SESSION_SECRET은 32자 이상이어야 합니다');
  const allowed = new Set(allowedEmails.map((e) => e.trim().toLowerCase()).filter(Boolean));
  const isAllowed = (email) => allowed.size === 0 || allowed.has(email);
  const store = createStore(dataDir);

  const cookie = (value, maxAge) => [
    `${COOKIE}=${value}`, 'Path=/api', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`, secureCookie ? 'Secure' : '',
  ].filter(Boolean).join('; ');

  function issue(user) {
    const exp = Math.floor(now() / 1000) + SESSION_DAYS * 86400;
    const value = signSession({ sub: user.sub, email: user.email, name: user.name, picture: user.picture, exp }, secret);
    return cookie(value, SESSION_DAYS * 86400);
  }

  function currentUser(req) {
    const s = verifySession(parseCookies(req.headers.cookie)[COOKIE], secret, now());
    if (!s || !isAllowed(s.email)) return null;
    return s;
  }

  const publicUser = (u) => ({ email: u.email, name: u.name, picture: u.picture });

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname.replace(/\/+$/, '') || '/';
    const method = req.method;

    // 다른 사이트에서 보낸 쓰기 요청 차단: 사용자 지정 헤더는 다른 출처에서 사전 요청 없이 못 붙인다
    if (method !== 'GET' && method !== 'HEAD' && req.headers['x-requested-with'] !== 'compose') {
      throw new HttpError(403, '허용되지 않은 요청입니다');
    }

    if (p === '/api/health') return send(res, 200, { ok: true });
    if (p === '/api/config' && method === 'GET') {
      return send(res, 200, { googleClientId: clientId || null, loginEnabled: Boolean(clientId) });
    }

    if (p === '/api/login' && method === 'POST') {
      if (!clientId) throw new HttpError(503, '로그인이 설정되지 않았습니다');
      const { credential } = await readJsonBody(req);
      let user;
      try {
        user = await verifyGoogleIdToken(credential, { clientId, getKey, now: now() });
      } catch (e) {
        if (e instanceof AuthError) throw new HttpError(401, `로그인 실패: ${e.message}`);
        throw e;
      }
      if (!isAllowed(user.email)) {
        console.log(`login denied ${user.email}`);
        throw new HttpError(403, `${user.email} 계정은 허용되지 않았습니다`);
      }
      await store.saveProfile(user);
      console.log(`login ${user.email}`);
      return send(res, 200, { user: publicUser(user) }, { 'Set-Cookie': issue(user) });
    }

    if (p === '/api/logout' && method === 'POST') {
      return send(res, 200, { ok: true }, { 'Set-Cookie': cookie('', 0) });
    }

    const user = currentUser(req);

    if (p === '/api/me' && method === 'GET') {
      if (!user) return send(res, 200, { user: null });
      // 남은 기간이 절반 아래면 세션 연장
      const headers = user.exp * 1000 - now() < (SESSION_DAYS / 2) * 86400_000 ? { 'Set-Cookie': issue(user) } : {};
      return send(res, 200, { user: publicUser(user) }, headers);
    }

    if (!p.startsWith('/api/charts')) throw new HttpError(404, '없는 주소입니다');
    if (!user) throw new HttpError(401, '로그인이 필요합니다');

    if (p === '/api/charts') {
      if (method === 'GET') return send(res, 200, { charts: await store.list(user.sub) });
      if (method === 'POST') {
        const body = await readJsonBody(req);
        const rec = await store.create(user.sub, cleanDoc(body.doc));
        return send(res, 201, { chart: summarize(rec) });
      }
      throw new HttpError(405, '지원하지 않는 요청');
    }

    const id = p.slice('/api/charts/'.length);
    if (!isChartId(id)) throw new HttpError(404, '악보를 찾을 수 없습니다');

    if (method === 'GET') {
      const rec = await store.get(user.sub, id);
      if (!rec) throw new HttpError(404, '악보를 찾을 수 없습니다');
      return send(res, 200, { id: rec.id, rev: rec.rev, updatedAt: rec.updatedAt, doc: rec.doc });
    }
    if (method === 'PUT') {
      const body = await readJsonBody(req);
      const baseRev = Number.isInteger(body.rev) ? body.rev : null;
      const out = await store.update(user.sub, id, cleanDoc(body.doc), baseRev);
      if (!out) throw new HttpError(404, '악보를 찾을 수 없습니다');
      if (out.conflict) {
        const c = out.conflict;
        return send(res, 409, {
          error: '다른 곳에서 먼저 바뀐 악보입니다',
          current: { id: c.id, rev: c.rev, updatedAt: c.updatedAt, doc: c.doc },
        });
      }
      return send(res, 200, { rev: out.rec.rev, updatedAt: out.rec.updatedAt });
    }
    if (method === 'DELETE') {
      if (!(await store.remove(user.sub, id))) throw new HttpError(404, '악보를 찾을 수 없습니다');
      return send(res, 200, { ok: true });
    }
    throw new HttpError(405, '지원하지 않는 요청');
  }

  return async function app(req, res) {
    try {
      await handle(req, res);
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500) console.error(e);
      if (!res.headersSent) send(res, status, { error: status >= 500 ? '서버 오류가 났습니다' : e.message });
      else res.end();
    }
  };
}

// 직접 실행했을 때만 서버 시작 (테스트에서는 createApp만 씀)
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const env = process.env;
  const app = createApp({
    clientId: env.GOOGLE_CLIENT_ID || '',
    secret: env.SESSION_SECRET,
    allowedEmails: (env.ALLOWED_EMAILS || '').split(','),
    dataDir: env.DATA_DIR || './data',
    secureCookie: env.COOKIE_SECURE !== '0',
    jwksUrl: env.GOOGLE_JWKS_URL,
  });
  const port = Number(env.PORT || 3000);
  http.createServer(app).listen(port, () => {
    console.log(`compose api :${port} login=${env.GOOGLE_CLIENT_ID ? 'on' : 'off'} allowed=${env.ALLOWED_EMAILS || '(all)'}`);
  });
}
