import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/index.js';
import { verifyGoogleIdToken, signSession, verifySession, createKeyStore } from '../server/auth.js';
import { newDoc } from '../src/core/doc.js';

const CLIENT_ID = 'test-client.apps.googleusercontent.com';
const SECRET = 'x'.repeat(40);
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const getKey = async (kid) => (kid === 'k1' ? publicKey : null);

function makeToken(claims = {}, { key = privateKey, kid = 'k1', alg = 'RS256' } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = enc({ alg, kid, typ: 'JWT' });
  const body = enc({
    iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: '1234567890',
    email: 'Me@Example.com', email_verified: true, name: '테스트', picture: 'https://example.com/p.png',
    iat: now, exp: now + 3600, ...claims,
  });
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), key).toString('base64url');
  return `${head}.${body}.${sig}`;
}

test('Google ID 토큰 검증', async () => {
  const opts = { clientId: CLIENT_ID, getKey };
  const u = await verifyGoogleIdToken(makeToken(), opts);
  assert.equal(u.sub, '1234567890');
  assert.equal(u.email, 'me@example.com');

  const bad = async (token, msg) => assert.rejects(verifyGoogleIdToken(token, opts), msg);
  await bad(makeToken({}, { key: other.privateKey }), /서명/);
  await bad(makeToken({ aud: 'someone-else' }), /이 앱용/);
  await bad(makeToken({ iss: 'https://evil.example' }), /발급자/);
  await bad(makeToken({ exp: Math.floor(Date.now() / 1000) - 3600 }), /만료/);
  await bad(makeToken({ email_verified: false }), /이메일/);
  await bad(makeToken({}, { kid: 'nope' }), /서명 키/);
  await bad(makeToken({}, { alg: 'HS256' }), /서명 방식/);
  await bad('abc', /형식/);
  // 서명 뒤에 payload만 바꿔치기
  const [h, , s] = makeToken().split('.');
  const forged = Buffer.from(JSON.stringify({ iss: 'accounts.google.com', aud: CLIENT_ID, sub: 'x', email_verified: true, exp: 9e9 })).toString('base64url');
  await bad(`${h}.${forged}.${s}`, /서명/);
});

test('JWKS 캐시: 모르는 kid면 다시 받되 1분에 한 번만', async () => {
  let calls = 0;
  const jwk = publicKey.export({ format: 'jwk' });
  const fakeFetch = async () => {
    calls++;
    return { ok: true, headers: new Headers({ 'cache-control': 'public, max-age=20000' }), json: async () => ({ keys: [{ ...jwk, kid: 'k1' }] }) };
  };
  const gk = createKeyStore('http://x', fakeFetch);
  assert.ok(await gk('k1'));
  assert.ok(await gk('k1'));
  assert.equal(await gk('unknown'), null);
  assert.equal(calls, 1);
});

test('세션 쿠키 서명', () => {
  const exp = Math.floor(Date.now() / 1000) + 60;
  const v = signSession({ sub: 'a', exp }, SECRET);
  assert.equal(verifySession(v, SECRET).sub, 'a');
  assert.equal(verifySession(v, 'y'.repeat(40)), null);
  assert.equal(verifySession(v.replace(/^./, 'A'), SECRET), null);
  assert.equal(verifySession(signSession({ sub: 'a', exp: 1 }, SECRET), SECRET), null);
});

async function startServer(t, extra = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'compose-test-'));
  const app = createApp({ clientId: CLIENT_ID, secret: SECRET, dataDir, secureCookie: false, getKey, ...extra });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(async () => {
    server.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const req = async (method, p, body, headers = {}) => {
    const res = await fetch(base + p, {
      method,
      headers: {
        ...(method !== 'GET' ? { 'X-Requested-With': 'compose' } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json(), setCookie: set };
  };
  return { req, dataDir, setCookie: (c) => { cookie = c; } };
}

test('API: 로그인 → 악보 만들기·목록·저장·충돌·삭제', async (t) => {
  const { req, dataDir } = await startServer(t);

  assert.equal((await req('GET', '/api/charts')).status, 401);
  assert.deepEqual((await req('GET', '/api/me')).body, { user: null });
  const cfg = (await req('GET', '/api/config')).body;
  assert.equal(cfg.googleClientId, CLIENT_ID);

  // 쓰기 요청에 사용자 지정 헤더가 없으면 거부
  assert.equal((await req('POST', '/api/login', { credential: makeToken() }, { 'X-Requested-With': '' })).status, 403);
  assert.equal((await req('POST', '/api/login', { credential: makeToken({ aud: 'x' }) })).status, 401);

  const login = await req('POST', '/api/login', { credential: makeToken() });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.email, 'me@example.com');
  assert.match(login.setCookie, /HttpOnly/);
  assert.match(login.setCookie, /SameSite=Lax/);
  assert.equal((await req('GET', '/api/me')).body.user.name, '테스트');

  const doc = newDoc();
  doc.meta.title = '첫 곡';
  const created = await req('POST', '/api/charts', { doc });
  assert.equal(created.status, 201);
  const { id } = created.body.chart;
  assert.match(id, /^[a-f0-9]{24}$/);

  const list = (await req('GET', '/api/charts')).body.charts;
  assert.equal(list.length, 1);
  assert.equal(list[0].title, '첫 곡');
  assert.equal(list[0].measures, 4);

  const got = (await req('GET', `/api/charts/${id}`)).body;
  assert.equal(got.rev, 1);
  got.doc.meta.title = '고친 곡';
  const saved = await req('PUT', `/api/charts/${id}`, { doc: got.doc, rev: 1 });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.rev, 2);

  // 예전 rev로 저장하면 충돌, 서버 내용을 돌려준다
  const conflict = await req('PUT', `/api/charts/${id}`, { doc: got.doc, rev: 1 });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.current.rev, 2);
  assert.equal(conflict.body.current.doc.meta.title, '고친 곡');

  // 잘못된 문서
  assert.equal((await req('PUT', `/api/charts/${id}`, { doc: { nope: 1 }, rev: 2 })).status, 400);
  // 경로 조작 시도
  assert.equal((await req('GET', '/api/charts/..%2F..%2Fprofile')).status, 404);

  assert.equal((await req('DELETE', `/api/charts/${id}`)).status, 200);
  assert.equal((await req('GET', `/api/charts/${id}`)).status, 404);
  assert.equal((await req('GET', '/api/charts')).body.charts.length, 0);
  // 지운 악보는 휴지통에 남는다
  const trash = await fs.readdir(path.join(dataDir, 'users', '1234567890', 'charts', '.trash'));
  assert.equal(trash.length, 1);

  await req('POST', '/api/logout');
  assert.equal((await req('GET', '/api/charts')).status, 401);
});

test('API: 다른 사용자의 악보는 안 보인다', async (t) => {
  const { req, setCookie } = await startServer(t);
  await req('POST', '/api/login', { credential: makeToken() });
  const { id } = (await req('POST', '/api/charts', { doc: newDoc() })).body.chart;
  setCookie('');
  await req('POST', '/api/login', { credential: makeToken({ sub: '999', email: 'b@example.com' }) });
  assert.equal((await req('GET', `/api/charts/${id}`)).status, 404);
  assert.equal((await req('PUT', `/api/charts/${id}`, { doc: newDoc() })).status, 404);
  assert.equal((await req('DELETE', `/api/charts/${id}`)).status, 404);
  assert.equal((await req('GET', '/api/charts')).body.charts.length, 0);
});

test('API: 허용 목록', async (t) => {
  const { req } = await startServer(t, { allowedEmails: ['me@example.com'] });
  const denied = await req('POST', '/api/login', { credential: makeToken({ sub: '2', email: 'stranger@example.com' }) });
  assert.equal(denied.status, 403);
  assert.equal((await req('POST', '/api/login', { credential: makeToken() })).status, 200);
});

test('API: 위조한 세션 쿠키는 무시', async (t) => {
  const { req, setCookie } = await startServer(t);
  const fake = signSession({ sub: '1', email: 'a@b.c', exp: 9e9 }, 'z'.repeat(40));
  setCookie(`compose_session=${fake}`);
  assert.equal((await req('GET', '/api/charts')).status, 401);
});

test('API: 사용자당 악보 수 제한', async (t) => {
  const { req } = await startServer(t, { maxCharts: 2 });
  await req('POST', '/api/login', { credential: makeToken() });
  assert.equal((await req('POST', '/api/charts', { doc: newDoc() })).status, 201);
  const { id } = (await req('POST', '/api/charts', { doc: newDoc() })).body.chart;
  const over = await req('POST', '/api/charts', { doc: newDoc() });
  assert.equal(over.status, 409);
  assert.match(over.body.error, /2개까지/);
  // 지우면 다시 만들 수 있다 (휴지통은 세지 않음)
  await req('DELETE', `/api/charts/${id}`);
  assert.equal((await req('POST', '/api/charts', { doc: newDoc() })).status, 201);
});
