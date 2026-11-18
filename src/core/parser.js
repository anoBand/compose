// 코드 악보 텍스트 문법 → 악보 모델
//
//   title: 제목          메타데이터 (title, artist, key, time, tempo)
//   [Verse]             구간 시작
//   | C | G/B | Am F |  마디 줄 (한 줄 = 화면의 한 행)
//   |: C . Am . :|x2    반복 / 각 토큰 1박, "." = 앞 코드 유지
//   | % |               앞 마디 반복
//   | {3/4} C |         이 마디부터 박자 변경
//   # 주석

import { parseChord, parseKey } from './music.js';

const META_KEYS = new Set(['title', 'artist', 'key', 'time', 'tempo']);
const BAR_RE = /\|:|:\|(?:x(\d+))?|\|\||\||\{\d+\/\d+\}|[^\s|{]+/g;

function parseTime(str) {
  const m = /^(\d+)\/(\d+)$/.exec(String(str).trim());
  if (!m) return null;
  const beats = Number(m[1]);
  const unit = Number(m[2]);
  if (beats < 1 || beats > 16 || ![2, 4, 8, 16].includes(unit)) return null;
  return { beats, unit };
}

export function parseChart(text) {
  const errors = [];
  const meta = { title: '', artist: '', key: parseKey('C'), keyText: 'C', time: { beats: 4, unit: 4 }, tempo: null };
  const sections = [];
  let current = null;
  let time = meta.time;
  let prevMeasure = null;
  let measureNo = 0;
  let seenMeasure = false;

  const ensureSection = () => {
    if (!current) {
      current = { name: '', rows: [] };
      sections.push(current);
    }
    return current;
  };

  text.split(/\r?\n/).forEach((raw, idx) => {
    const lineNo = idx + 1;
    const line = raw.replace(/\s+#.*$|^#.*$/, '').trim();
    if (!line) return;

    // 메타데이터
    const metaMatch = /^([a-zA-Z]+)\s*:\s*(.*)$/.exec(line);
    if (metaMatch && META_KEYS.has(metaMatch[1].toLowerCase()) && !line.includes('|')) {
      const k = metaMatch[1].toLowerCase();
      const v = metaMatch[2].trim();
      if (k === 'key') {
        const key = parseKey(v);
        if (!key) errors.push({ line: lineNo, message: `알 수 없는 키: "${v}" (예: C, Bb, F#m)` });
        else { meta.key = key; meta.keyText = v; }
      } else if (k === 'time') {
        const t = parseTime(v);
        if (!t) errors.push({ line: lineNo, message: `박자 형식 오류: "${v}" (예: 4/4, 6/8)` });
        else if (seenMeasure) errors.push({ line: lineNo, message: '곡 중간 박자 변경은 마디 안에 {3/4}처럼 쓰세요' });
        else { meta.time = t; time = t; }
      } else if (k === 'tempo') {
        const n = Number(v);
        if (!Number.isFinite(n) || n <= 0) errors.push({ line: lineNo, message: `템포 형식 오류: "${v}"` });
        else meta.tempo = n;
      } else {
        meta[k] = v;
      }
      return;
    }

    // 구간
    const sec = /^\[(.+)\]$/.exec(line);
    if (sec) {
      current = { name: sec[1].trim(), rows: [] };
      sections.push(current);
      return;
    }

    // 마디 줄
    const row = [];
    let tokens = [];
    let pendingStart = false;
    let pendingTime = null;

    const closeMeasure = () => {
      if (tokens.length === 0 && !pendingTime) return null;
      if (pendingTime) time = pendingTime;
      const m = buildMeasure(tokens, time, prevMeasure, lineNo, errors);
      m.repeatStart = pendingStart;
      m.timeChange = pendingTime;
      m.number = ++measureNo;
      row.push(m);
      prevMeasure = m;
      tokens = [];
      pendingStart = false;
      pendingTime = null;
      return m;
    };

    // ":|:" ":||:" "||:" 같은 붙여 쓴 세로줄을 분리
    const barLine = line.replace(/:\|\|?:/g, ' :| |: ').replace(/\|\|:/g, ' || |: ');
    for (const match of barLine.matchAll(BAR_RE)) {
      const tok = match[0];
      if (tok === '|' || tok === '||' || tok.startsWith(':|') || tok === '|:') {
        const closed = closeMeasure();
        const target = closed ?? row[row.length - 1];
        if (tok === '||' && target) target.doubleBar = true;
        if (tok.startsWith(':|')) {
          if (target) {
            target.repeatEnd = true;
            target.repeatCount = match[1] ? Number(match[1]) : 2;
          } else errors.push({ line: lineNo, message: '반복 끝(:|) 앞에 마디가 없습니다' });
        }
        if (tok === '|:') pendingStart = true;
      } else if (tok.startsWith('{')) {
        const t = parseTime(tok.slice(1, -1));
        if (!t) errors.push({ line: lineNo, message: `박자 형식 오류: ${tok}` });
        else pendingTime = t;
      } else {
        tokens.push(tok);
      }
    }
    closeMeasure();

    if (row.length) {
      seenMeasure = true;
      ensureSection().rows.push(row);
    }
  });

  return { meta, sections, errors };
}

function buildMeasure(tokens, time, prev, lineNo, errors) {
  const beats = time.beats;
  const measure = { time, chords: [], simile: false, line: lineNo, error: null, raw: tokens.join(' ') };
  const fail = (msg) => {
    measure.error = msg;
    errors.push({ line: lineNo, message: msg });
    return measure;
  };

  if (tokens.length === 1 && tokens[0] === '%') {
    if (!prev) return fail('반복할 앞 마디가 없습니다 (%)');
    measure.simile = true;
    measure.chords = prev.chords.map((c) => ({ ...c }));
    return measure;
  }
  if (tokens.includes('%')) return fail('%는 마디에 혼자 써야 합니다');
  if (tokens.length === 0) return fail('빈 마디입니다');

  const usesBeats = tokens.includes('.') || tokens.length === beats;
  if (tokens[0] === '.') return fail('마디가 "."로 시작할 수 없습니다');

  if (usesBeats) {
    if (tokens.length !== beats) {
      return fail(`${beats}박 마디인데 ${tokens.length}박이 있습니다: | ${tokens.join(' ')} |`);
    }
    tokens.forEach((tok, beat) => {
      if (tok === '.') {
        measure.chords[measure.chords.length - 1].duration += 1;
        return;
      }
      measure.chords.push({ text: tok, beat, duration: 1 });
    });
  } else {
    if (tokens.length > beats) {
      return fail(`${beats}박 마디에 코드가 ${tokens.length}개입니다`);
    }
    if (beats % tokens.length !== 0) {
      return fail(`${beats}박을 코드 ${tokens.length}개로 나눌 수 없습니다. "."로 박을 지정하세요 (예: C . . G)`);
    }
    const each = beats / tokens.length;
    tokens.forEach((tok, i) => measure.chords.push({ text: tok, beat: i * each, duration: each }));
  }

  for (const c of measure.chords) {
    c.chord = parseChord(c.text);
    if (!c.chord) {
      measure.error = `알 수 없는 코드: "${c.text}"`;
      errors.push({ line: lineNo, message: measure.error });
    }
  }
  return measure;
}
