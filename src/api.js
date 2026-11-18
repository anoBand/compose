// 서버 API (/api). 서버가 없는 곳(GitHub Pages, 로컬 http.server)에서는 config()가 null을 돌려준다.

export class ApiError extends Error {
  constructor(status, message, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

async function call(method, path, body) {
  let res;
  try {
    res = await fetch(`api/${path}`, {
      method,
      credentials: 'same-origin',
      headers: {
        ...(method !== 'GET' ? { 'X-Requested-With': 'compose' } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, '서버에 연결할 수 없어요');
  }
  let data = null;
  try { data = await res.json(); } catch { /* 본문 없음 */ }
  if (!res.ok) throw new ApiError(res.status, data?.error || `요청 실패 (${res.status})`, data);
  return data;
}

export async function config() {
  try {
    const data = await call('GET', 'config');
    return data && typeof data === 'object' && 'loginEnabled' in data ? data : null;
  } catch {
    return null;
  }
}

export const me = () => call('GET', 'me').then((d) => d.user);
export const login = (credential) => call('POST', 'login', { credential }).then((d) => d.user);
export const logout = () => call('POST', 'logout');
export const listCharts = () => call('GET', 'charts').then((d) => d.charts);
export const createChart = (doc) => call('POST', 'charts', { doc }).then((d) => d.chart);
export const getChart = (id) => call('GET', `charts/${id}`);
export const saveChart = (id, doc, rev) => call('PUT', `charts/${id}`, { doc, rev });
export const deleteChart = (id) => call('DELETE', `charts/${id}`);
