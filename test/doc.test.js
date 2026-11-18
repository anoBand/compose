import test from 'node:test';
import assert from 'node:assert/strict';
import { parseChart } from '../src/core/parser.js';
import { docToModel, modelToDoc, newDoc, normalizeDoc, measureTime } from '../src/core/doc.js';
import { diatonicChords, parseKey } from '../src/core/music.js';

test('텍스트 → 문서 → 렌더 모델 왕복', () => {
  const parsed = parseChart(`key: G
time: 3/4
[A]
|: G | D/F# | Em . D :|x3
| {4/4} C | % ||`);
  const doc = modelToDoc(parsed);
  assert.equal(doc.meta.key, 'G');
  const ms = doc.sections[0].measures;
  assert.equal(ms.length, 5);
  assert.ok(ms[2].lineBreak, '3마디 줄은 줄바꿈');
  assert.deepEqual(ms[3].time, { beats: 4, unit: 4 });
  assert.ok(ms[4].simile);

  const model = docToModel(doc);
  const rows = model.sections[0].rows;
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0][2].chords.map((c) => [c.text, c.beat, c.duration]), [['Em', 0, 2], ['D', 2, 1]]);
  assert.equal(rows[0][2].repeatCount, 3);
  assert.deepEqual(rows[1][1].chords.map((c) => c.text), ['C'], '% 는 앞 마디 코드를 이어받음');
  assert.deepEqual(rows[1][0].ref, { s: 0, m: 3 });
});

test('4마디마다 자동 줄바꿈, 빈 마디와 늦게 시작하는 코드', () => {
  const doc = newDoc();
  doc.sections[0].measures.push(...newDoc().sections[0].measures);
  doc.sections[0].measures[1].chords = [{ beat: 2, text: 'G' }];
  const rows = docToModel(doc).sections[0].rows;
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0][1].chords.map((c) => [c.beat, c.duration]), [[2, 2]]);
  assert.equal(rows[0][0].chords.length, 0);
});

test('박자 변경 위치 계산', () => {
  const doc = newDoc();
  doc.sections[0].measures[2].time = { beats: 3, unit: 4 };
  assert.equal(measureTime(doc, 0, 1).beats, 4);
  assert.equal(measureTime(doc, 0, 3).beats, 3);
});

test('잘못된 JSON 정리', () => {
  assert.throws(() => normalizeDoc({ foo: 1 }));
  const d = normalizeDoc({ meta: { key: 'Z' }, sections: [{ name: 'A', measures: [{ chords: [{ beat: 'x', text: 'C' }, { beat: 1, text: 'G' }] }] }] });
  assert.equal(d.meta.key, 'C');
  assert.deepEqual(d.sections[0].measures[0].chords, [{ beat: 1, text: 'G' }]);
  assert.equal(d.sections[0].measures[0].repeatCount, 2);
});

test('다이어토닉 코드', () => {
  assert.deepEqual(diatonicChords(parseKey('C')).map((d) => d.symbol), ['C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bdim']);
  assert.deepEqual(diatonicChords(parseKey('Eb')).map((d) => d.symbol), ['Eb', 'Fm', 'Gm', 'Ab', 'Bb', 'Cm', 'Ddim']);
  assert.deepEqual(diatonicChords(parseKey('F#m')).map((d) => d.symbol), ['F#m', 'G#dim', 'A', 'Bm', 'C#m', 'D', 'E', 'C#7']);
});
