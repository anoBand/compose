// 악보 문서(JSON, 저장/내보내기 형식) ↔ 렌더 모델
//
// doc = {
//   version: 1,
//   meta: { title, artist(화면에서 뺌, 예전 악보 호환용), key: 'C', time: { beats, unit }, tempo, note },   // note: 곡 메모 (여러 줄)
//   sections: [{ name, note, measures: [{                                   // note: 구간 메모
//     chords: [{ beat, text }],   // beat: 0부터, 다음 코드 전까지 유지
//     simile, repeatStart, repeatEnd, repeatCount, doubleBar,
//     time,                       // 이 마디부터 박자 변경 (없으면 null)
//     lineBreak,                  // 이 마디 뒤에서 줄 바꿈
//   }] }],
// }

import { parseChord, parseKey } from './music.js';

export const DOC_VERSION = 1;
export const MEASURES_PER_ROW = 4;

export function newMeasure(chords = []) {
  return {
    chords, simile: false, repeatStart: false, repeatEnd: false, repeatCount: 2,
    doubleBar: false, time: null, lineBreak: false,
  };
}

export function newDoc() {
  return {
    version: DOC_VERSION,
    meta: { title: '', artist: '', key: 'C', time: { beats: 4, unit: 4 }, tempo: null, note: '' },
    sections: [{ name: 'Verse', note: '', measures: [newMeasure(), newMeasure(), newMeasure(), newMeasure()] }],
  };
}

export const cloneDoc = (doc) => JSON.parse(JSON.stringify(doc));

/** 가져온 JSON을 검사하고 빠진 필드를 채운다. 잘못된 형식이면 예외 */
export function normalizeDoc(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.sections)) {
    throw new Error('악보 JSON 형식이 아닙니다');
  }
  const base = newDoc();
  const meta = { ...base.meta, ...(raw.meta || {}) };
  if (!parseKey(meta.key)) meta.key = 'C';
  if (!meta.time || !(meta.time.beats > 0)) meta.time = base.meta.time;
  meta.note = String(meta.note ?? '');
  return {
    version: DOC_VERSION,
    meta,
    sections: raw.sections.map((s) => ({
      name: String(s.name ?? ''),
      note: String(s.note ?? ''),
      measures: (s.measures || []).map((m) => ({
        ...newMeasure(),
        ...m,
        chords: (m.chords || [])
          .filter((c) => Number.isInteger(c.beat) && c.beat >= 0 && typeof c.text === 'string')
          .map((c) => ({ beat: c.beat, text: c.text })),
      })),
    })),
  };
}

/** 문서 → 렌더 모델 (parser.js 결과와 같은 모양 + 편집용 ref) */
export function docToModel(doc) {
  const key = parseKey(doc.meta.key) || parseKey('C');
  const meta = { ...doc.meta, key, keyText: doc.meta.key };
  let time = doc.meta.time;
  let number = 0;
  let prev = null;

  const sections = doc.sections.map((sec, si) => {
    const rows = [];
    let row = [];
    sec.measures.forEach((dm, mi) => {
      if (dm.time) time = dm.time;
      const beats = time.beats;
      const src = dm.simile && prev ? prev.chords.map((c) => ({ beat: c.beat, text: c.text })) : dm.chords;
      const sorted = src.filter((c) => c.beat < beats).sort((a, b) => a.beat - b.beat);
      const chords = sorted.map((c, i) => ({
        text: c.text,
        chord: parseChord(c.text),
        beat: c.beat,
        duration: (sorted[i + 1]?.beat ?? beats) - c.beat,
      }));
      const m = {
        time,
        chords,
        simile: Boolean(dm.simile && prev),
        repeatStart: dm.repeatStart,
        repeatEnd: dm.repeatEnd,
        repeatCount: dm.repeatCount ?? 2,
        doubleBar: dm.doubleBar,
        timeChange: dm.time || null,
        number: ++number,
        error: chords.some((c) => !c.chord) ? '알 수 없는 코드' : null,
        ref: { s: si, m: mi },
      };
      row.push(m);
      prev = m;
      if (dm.lineBreak || row.length === MEASURES_PER_ROW) {
        rows.push(row);
        row = [];
      }
    });
    if (row.length) rows.push(row);
    return { name: sec.name, note: sec.note || '', rows };
  });

  return { meta, sections, errors: [] };
}

/** parser.js 결과(텍스트 가져오기) → 문서 */
export function modelToDoc(model) {
  const doc = newDoc();
  doc.meta = {
    title: model.meta.title || '',
    artist: model.meta.artist || '',
    key: model.meta.keyText || 'C',
    time: { ...model.meta.time },
    tempo: model.meta.tempo ?? null,
    note: model.meta.note || '',
  };
  doc.sections = model.sections.map((s) => ({
    name: s.name,
    note: s.note || '',
    measures: s.rows.flatMap((row) => row.map((m, i) => ({
      ...newMeasure(m.simile ? [] : m.chords.map((c) => ({ beat: c.beat, text: c.text }))),
      simile: m.simile,
      repeatStart: Boolean(m.repeatStart),
      repeatEnd: Boolean(m.repeatEnd),
      repeatCount: m.repeatCount ?? 2,
      doubleBar: Boolean(m.doubleBar),
      time: m.timeChange ? { ...m.timeChange } : null,
      lineBreak: i === row.length - 1 && row.length < MEASURES_PER_ROW,
    }))),
  }));
  if (doc.sections.length === 0) doc.sections = newDoc().sections;
  return doc;
}

/** 마디의 박자 (앞쪽 박자 변경 반영) */
export function measureTime(doc, s, m) {
  let time = doc.meta.time;
  for (let si = 0; si <= s; si++) {
    const ms = doc.sections[si].measures;
    const end = si === s ? m : ms.length - 1;
    for (let mi = 0; mi <= end; mi++) if (ms[mi].time) time = ms[mi].time;
  }
  return time;
}
