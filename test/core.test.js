import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseChord, chordToString, parseKey, keyToString, transposeKey, transposeChord,
} from '../src/core/music.js';
import { parseChart } from '../src/core/parser.js';

const tr = (chord, from, semis, alt = false) => {
  const fk = parseKey(from);
  const tk = transposeKey(fk, semis, alt);
  return chordToString(transposeChord(parseChord(chord), fk, tk));
};

test('코드 파싱', () => {
  assert.deepEqual(chordToString(parseChord('C#m7b5/G#')), 'C#m7b5/G#');
  assert.equal(parseChord('Bbmaj7').quality, 'maj7');
  assert.equal(parseChord('Hm'), null);
  assert.equal(parseChord('Cfoo'), null);
  assert.ok(parseChord('N.C.').nc);
  assert.ok(parseChord('G7(b9)'));
  assert.ok(parseChord('Csus4'));
  assert.ok(parseChord('Cadd9'));
});

test('키 조옮김 — 플랫 기본, 대체 이름', () => {
  assert.equal(keyToString(transposeKey(parseKey('C'), 1)), 'Db');
  assert.equal(keyToString(transposeKey(parseKey('C'), 6)), 'Gb');
  assert.equal(keyToString(transposeKey(parseKey('C'), 6, true)), 'F#');
  assert.equal(keyToString(transposeKey(parseKey('Am'), 4)), 'C#m');
  assert.equal(keyToString(transposeKey(parseKey('G'), -2)), 'F');
  assert.equal(keyToString(transposeKey(parseKey('E'), 12)), 'E');
});

test('코드 조옮김 — 도수 유지 철자', () => {
  assert.equal(tr('Bb', 'C', 2), 'C');        // bVII 유지
  assert.equal(tr('G/B', 'C', 2), 'A/C#');
  assert.equal(tr('F#dim', 'C', 1), 'Gdim');  // #IV in Db = G
  assert.equal(tr('Am7', 'C', 3), 'Cm7');     // Eb키
  assert.equal(tr('E7', 'C', 6), 'Bb7');      // Gb키 III7 = Bb7
  assert.equal(tr('E7', 'C', 6, true), 'A#7');// F#키 III7 = A#7
});

test('겹임시표는 단순화', () => {
  // C키 bII(Db) → Db키에서 Ebb → D
  assert.equal(tr('Db', 'C', 1), 'D');
  // C키 #IV(F#) → B키에서 E# → F
  assert.equal(tr('F#', 'C', 11), 'F');
});

test('악보 파서 — 기본', () => {
  const { meta, sections, errors } = parseChart(`title: 테스트
key: G
time: 3/4

[Intro]
| G | D/F# | Em . D |
[Verse]
|: C | % :|x3
| {4/4} Am D | G . . C ||`);
  assert.deepEqual(errors, []);
  assert.equal(meta.title, '테스트');
  assert.equal(keyToString(meta.key), 'G');
  assert.equal(sections.length, 2);
  const intro = sections[0].rows[0];
  assert.equal(intro.length, 3);
  assert.deepEqual(intro[2].chords.map((c) => [c.text, c.beat, c.duration]), [['Em', 0, 2], ['D', 2, 1]]);
  const [r1, r2] = sections[1].rows;
  assert.ok(r1[0].repeatStart);
  assert.ok(r1[1].simile && r1[1].repeatEnd);
  assert.equal(r1[1].repeatCount, 3);
  assert.equal(r2[0].time.beats, 4);
  assert.deepEqual(r2[0].chords.map((c) => c.duration), [2, 2]);
  assert.deepEqual(r2[1].chords.map((c) => c.duration), [3, 1]);
  assert.ok(r2[1].doubleBar);
  assert.equal(r2[1].number, 7);
});

test('악보 파서 — 오류 보고', () => {
  const { errors } = parseChart(`key: X
| C D E |
| C . . . . |
| Hm |
| % |`);
  assert.equal(errors[0].line, 1);
  assert.match(errors[1].message, /나눌 수 없습니다/);
  assert.match(errors[2].message, /5박/);
  assert.match(errors[3].message, /알 수 없는 코드/);
  assert.equal(errors.length, 4); // % 는 앞 마디(오류 마디라도) 복사
});

test('붙여 쓴 반복 세로줄', () => {
  const { errors, sections } = parseChart('|: C :|: G :|');
  assert.deepEqual(errors, []);
  const row = sections[0].rows[0];
  assert.ok(row[0].repeatStart && row[0].repeatEnd);
  assert.ok(row[1].repeatStart && row[1].repeatEnd);
});
