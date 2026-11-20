// 악보 저장소: DATA_DIR/users/<sub>/charts/<id>.json (사용자별 폴더, 악보 1개 = 파일 1개)
// 지운 악보는 charts/.trash/ 로 옮긴다 (서버에서 되살릴 수 있게).
// 휴지통은 악보 수 제한에 들어가지 않으므로, 지울 때마다 오래된 것(trashDays)과 넘친 것(trashMax)을 정리한다
// ("만들기 → 지우기" 반복으로 디스크를 채우지 못하게).
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const SUB_RE = /^[A-Za-z0-9_-]{1,128}$/;
const ID_RE = /^[a-f0-9]{24}$/;
export const DEFAULT_MAX_CHARTS = 200;
export const DEFAULT_TRASH_MAX = 50;
export const DEFAULT_TRASH_DAYS = 30;
const TRASH_RE = /^([a-f0-9]{24})\.(\d+)\.json$/;

export const isChartId = (id) => typeof id === 'string' && ID_RE.test(id);

async function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fs.writeFile(tmp, data, { mode: 0o600 });
  await fs.rename(tmp, file);
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

/** 목록에 보일 요약 */
export function summarize(rec) {
  const m = rec.doc?.meta || {};
  const measures = (rec.doc?.sections || []).reduce((n, s) => n + (s.measures?.length || 0), 0);
  return {
    id: rec.id,
    title: m.title || '',
    artist: m.artist || '',
    key: m.key || 'C',
    time: m.time ? `${m.time.beats}/${m.time.unit}` : '4/4',
    measures,
    rev: rec.rev,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
  };
}

export function createStore(dataDir, {
  maxCharts = DEFAULT_MAX_CHARTS, trashMax = DEFAULT_TRASH_MAX, trashDays = DEFAULT_TRASH_DAYS,
} = {}) {
  // 같은 파일에 대한 쓰기를 순서대로 처리 (프로세스 하나 기준)
  const locks = new Map();
  async function withLock(key, fn) {
    const prev = locks.get(key) || Promise.resolve();
    let release;
    const next = new Promise((r) => { release = r; });
    const chained = prev.then(() => next);
    locks.set(key, chained);
    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (locks.get(key) === chained) locks.delete(key);
    }
  }

  function userDir(sub) {
    if (!SUB_RE.test(sub)) throw new Error('잘못된 사용자 ID');
    return path.join(dataDir, 'users', sub);
  }
  const chartsDir = (sub) => path.join(userDir(sub), 'charts');
  function chartFile(sub, id) {
    if (!isChartId(id)) return null;
    return path.join(chartsDir(sub), `${id}.json`);
  }

  async function ensureDirs(sub) {
    await fs.mkdir(path.join(chartsDir(sub), '.trash'), { recursive: true, mode: 0o700 });
  }

  const profileFile = (sub) => path.join(userDir(sub), 'profile.json');

  /** 휴지통: 최근 trashMax개만, trashDays일 넘은 것은 지운다 (파일 이름의 지운 시각 기준) */
  async function pruneTrash(sub) {
    const dir = path.join(chartsDir(sub), '.trash');
    const cutoff = Date.now() - trashDays * 86400_000;
    const items = (await fs.readdir(dir))
      .map((n) => ({ n, t: Number(TRASH_RE.exec(n)?.[2]) }))
      .filter((x) => x.t > 0)
      .sort((a, b) => b.t - a.t);
    const drop = items.filter((x, i) => i >= trashMax || x.t < cutoff);
    await Promise.all(drop.map((x) => fs.unlink(path.join(dir, x.n)).catch((e) => {
      if (e.code !== 'ENOENT') throw e;
    })));
  }

  return {
    async getProfile(sub) {
      return readJson(profileFile(sub));
    },

    /** 튜토리얼을 끝냈거나 건너뛴 시각 (계정 단위, 처음 한 번만 자동으로 보여 주려고) */
    async setTutorialDone(sub) {
      await ensureDirs(sub);
      const file = profileFile(sub);
      return withLock(file, async () => {
        const prev = (await readJson(file)) || { sub, createdAt: new Date().toISOString() };
        if (prev.tutorialDoneAt) return;
        await writeAtomic(file, JSON.stringify({ ...prev, tutorialDoneAt: new Date().toISOString() }, null, 2));
      });
    },

    async saveProfile(user) {
      await ensureDirs(user.sub);
      const file = profileFile(user.sub);
      return withLock(file, async () => {
        const prev = (await readJson(file)) || { createdAt: new Date().toISOString() };
        const next = { ...prev, sub: user.sub, email: user.email, name: user.name, lastLoginAt: new Date().toISOString() };
        await writeAtomic(file, JSON.stringify(next, null, 2));
        return next;
      });
    },

    async list(sub) {
      let names;
      try {
        names = await fs.readdir(chartsDir(sub));
      } catch (e) {
        if (e.code === 'ENOENT') return [];
        throw e;
      }
      const recs = await Promise.all(names
        .filter((n) => n.endsWith('.json') && isChartId(n.slice(0, -5)))
        .map((n) => readJson(path.join(chartsDir(sub), n)).catch(() => null)));
      return recs.filter(Boolean).map(summarize).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },

    async get(sub, id) {
      const file = chartFile(sub, id);
      return file ? readJson(file) : null;
    },

    async create(sub, doc) {
      await ensureDirs(sub);
      const count = (await fs.readdir(chartsDir(sub))).filter((n) => n.endsWith('.json')).length;
      if (count >= maxCharts) {
        throw Object.assign(new Error(`악보는 한 사람당 ${maxCharts}개까지 저장할 수 있어요. 안 쓰는 악보를 지워 주세요`), { status: 409 });
      }
      const now = new Date().toISOString();
      const rec = { id: crypto.randomBytes(12).toString('hex'), rev: 1, createdAt: now, updatedAt: now, doc };
      await writeAtomic(chartFile(sub, rec.id), JSON.stringify(rec));
      return rec;
    },

    /** baseRev가 서버의 rev와 다르면 { conflict: 서버 기록 } (다른 기기에서 먼저 저장함) */
    async update(sub, id, doc, baseRev) {
      const file = chartFile(sub, id);
      if (!file) return null;
      return withLock(file, async () => {
        const cur = await readJson(file);
        if (!cur) return null;
        if (baseRev != null && baseRev !== cur.rev) return { conflict: cur };
        const rec = { ...cur, rev: cur.rev + 1, updatedAt: new Date().toISOString(), doc };
        await writeAtomic(file, JSON.stringify(rec));
        return { rec };
      });
    },

    async remove(sub, id) {
      const file = chartFile(sub, id);
      if (!file) return false;
      return withLock(file, async () => {
        await ensureDirs(sub);
        try {
          await fs.rename(file, path.join(chartsDir(sub), '.trash', `${id}.${Date.now()}.json`));
        } catch (e) {
          if (e.code === 'ENOENT') return false;
          throw e;
        }
        await pruneTrash(sub);
        return true;
      });
    },
  };
}
