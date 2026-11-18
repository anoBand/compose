// Google ID 토큰 검증과 세션 쿠키 (외부 의존성 없음)
import crypto from 'node:crypto';

export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
const CLOCK_SKEW_S = 60;

const b64urlJson = (part) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

/**
 * Google 공개키(JWKS) 캐시. 응답의 max-age 동안 쓰고, 모르는 kid가 오면(키 교체) 다시 받는다.
 * 모르는 kid로 계속 요청해도 1분에 한 번만 다시 받는다.
 */
export function createKeyStore(url = GOOGLE_JWKS_URL, fetchImpl = fetch) {
  let keys = new Map();
  let expires = 0;
  let lastFetch = 0;
  let inflight = null;

  async function refresh() {
    lastFetch = Date.now();
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`JWKS 응답 ${res.status}`);
    const body = await res.json();
    const next = new Map();
    for (const jwk of body.keys || []) {
      if (jwk.kty === 'RSA' && jwk.kid) next.set(jwk.kid, crypto.createPublicKey({ key: jwk, format: 'jwk' }));
    }
    const maxAge = /max-age=(\d+)/.exec(res.headers.get('cache-control') || '');
    keys = next;
    expires = Date.now() + (maxAge ? Number(maxAge[1]) * 1000 : 3600_000);
  }

  return async function getKey(kid) {
    const stale = Date.now() >= expires;
    const unknown = !keys.has(kid) && Date.now() - lastFetch > 60_000;
    if (stale || unknown) {
      inflight ??= refresh().finally(() => { inflight = null; });
      await inflight;
    }
    return keys.get(kid) || null;
  };
}

export class AuthError extends Error {}

/** Google ID 토큰(JWT, RS256)을 검증하고 사용자 정보를 돌려준다. 실패하면 AuthError */
export async function verifyGoogleIdToken(token, { clientId, getKey, now = Date.now() }) {
  if (typeof token !== 'string') throw new AuthError('토큰이 없습니다');
  const parts = token.split('.');
  if (parts.length !== 3) throw new AuthError('토큰 형식이 아닙니다');
  let header;
  let payload;
  try {
    header = b64urlJson(parts[0]);
    payload = b64urlJson(parts[1]);
  } catch {
    throw new AuthError('토큰을 읽을 수 없습니다');
  }
  if (header.alg !== 'RS256' || !header.kid) throw new AuthError('지원하지 않는 서명 방식');
  const key = await getKey(header.kid);
  if (!key) throw new AuthError('알 수 없는 서명 키');
  const ok = crypto.verify(
    'RSA-SHA256',
    Buffer.from(`${parts[0]}.${parts[1]}`),
    key,
    Buffer.from(parts[2], 'base64url'),
  );
  if (!ok) throw new AuthError('서명이 맞지 않습니다');

  const nowS = Math.floor(now / 1000);
  if (!GOOGLE_ISSUERS.has(payload.iss)) throw new AuthError('발급자가 Google이 아닙니다');
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!clientId || !aud.includes(clientId)) throw new AuthError('이 앱용 토큰이 아닙니다');
  if (typeof payload.exp !== 'number' || payload.exp + CLOCK_SKEW_S < nowS) throw new AuthError('토큰이 만료되었습니다');
  if (typeof payload.iat === 'number' && payload.iat - CLOCK_SKEW_S > nowS) throw new AuthError('토큰 발급 시각이 이상합니다');
  if (payload.email_verified !== true && payload.email_verified !== 'true') throw new AuthError('이메일이 확인되지 않은 계정입니다');
  if (typeof payload.sub !== 'string' || !payload.sub) throw new AuthError('사용자 ID가 없습니다');

  return {
    sub: payload.sub,
    email: String(payload.email || '').toLowerCase(),
    name: String(payload.name || payload.email || ''),
    picture: typeof payload.picture === 'string' ? payload.picture : '',
  };
}

// ───────── 세션 쿠키: base64url(JSON).HMAC ─────────
const hmac = (data, secret) => crypto.createHmac('sha256', secret).update(data).digest('base64url');

export function signSession(data, secret) {
  const body = Buffer.from(JSON.stringify(data)).toString('base64url');
  return `${body}.${hmac(body, secret)}`;
}

export function verifySession(value, secret, now = Date.now()) {
  if (typeof value !== 'string') return null;
  const dot = value.lastIndexOf('.');
  if (dot < 1) return null;
  const body = value.slice(0, dot);
  const sig = Buffer.from(value.slice(dot + 1));
  const expected = Buffer.from(hmac(body, secret));
  if (sig.length !== expected.length || !crypto.timingSafeEqual(sig, expected)) return null;
  try {
    const data = b64urlJson(body);
    if (typeof data.exp !== 'number' || data.exp * 1000 < now) return null;
    return data;
  } catch {
    return null;
  }
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
