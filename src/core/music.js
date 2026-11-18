// 음이름, 키, 코드 심볼 처리 — 렌더링과 무관한 순수 로직

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const NATURAL_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

const mod = (n, m) => ((n % m) + m) % m;

/** "Db" → { letter:'D', acc:-1 } */
export function parseNote(str) {
  const m = /^([A-G])(##|bb|#|b)?$/.exec(str);
  if (!m) return null;
  const acc = { '#': 1, '##': 2, b: -1, bb: -2 }[m[2]] ?? 0;
  return { letter: m[1], acc };
}

export function noteToString({ letter, acc }) {
  const accStr = { 1: '#', 2: '##', [-1]: 'b', [-2]: 'bb' }[acc] ?? '';
  return letter + accStr;
}

export const pitchClass = (n) => mod(NATURAL_PC[n.letter] + n.acc, 12);

// 이명동음 후보가 있는 키는 대체 이름을 함께 둔다. 첫 번째가 기본(플랫 우선).
const MAJOR_NAMES = [
  ['C'], ['Db', 'C#'], ['D'], ['Eb'], ['E'], ['F'],
  ['Gb', 'F#'], ['G'], ['Ab'], ['A'], ['Bb'], ['B'],
];
const MINOR_NAMES = [
  ['C'], ['C#', 'Db'], ['D'], ['Eb', 'D#'], ['E'], ['F'],
  ['F#', 'Gb'], ['G'], ['G#', 'Ab'], ['A'], ['Bb', 'A#'], ['B'],
];

/** "Am" / "F#m" / "Bb" → { tonic, minor } */
export function parseKey(str) {
  const m = /^([A-G](?:#|b)?)(m|min|minor)?$/.exec(String(str).trim());
  if (!m) return null;
  return { tonic: parseNote(m[1]), minor: Boolean(m[2]) };
}

export const keyToString = (k) => noteToString(k.tonic) + (k.minor ? 'm' : '');

/** 해당 키의 이명동음 대체 이름이 있는지 */
export function keyAlternatives(key) {
  const table = key.minor ? MINOR_NAMES : MAJOR_NAMES;
  return table[pitchClass(key.tonic)];
}

/**
 * 키를 semitones만큼 옮긴다.
 * altSpelling=true 이면 이명동음 대체 이름(예: Gb → F#)을 쓴다.
 */
export function transposeKey(key, semitones, altSpelling = false) {
  const pc = mod(pitchClass(key.tonic) + semitones, 12);
  const names = (key.minor ? MINOR_NAMES : MAJOR_NAMES)[pc];
  const name = altSpelling && names[1] ? names[1] : names[0];
  return { tonic: parseNote(name), minor: key.minor };
}

/**
 * 음 하나를 조옮김한다. 원래 키에서의 도수(글자 간격)를 새 키에서도 유지해
 * 철자를 정한다. 예) C키의 Bb → D키에서는 C (A#이 아님)
 */
export function transposeNote(note, fromKey, toKey) {
  const steps = mod(LETTERS.indexOf(note.letter) - LETTERS.indexOf(fromKey.tonic.letter), 7);
  const interval = mod(pitchClass(note) - pitchClass(fromKey.tonic), 12);
  const letter = LETTERS[mod(LETTERS.indexOf(toKey.tonic.letter) + steps, 7)];
  const targetPc = mod(pitchClass(toKey.tonic) + interval, 12);
  let acc = mod(targetPc - NATURAL_PC[letter] + 6, 12) - 6; // -6..5
  // 차트 가독성: E#, B#, Cb, Fb 는 F, C, B, E 로 쓴다.
  const awkward = ['E#', 'B#', 'Cb', 'Fb'].includes(noteToString({ letter, acc }));
  if (Math.abs(acc) <= 1 && !awkward) return { letter, acc };
  // 겹올림/겹내림은 단순한 이명동음으로 바꾼다.
  return simplestSpelling(targetPc, acc > 0);
}

function simplestSpelling(pc, preferSharp) {
  const natural = LETTERS.find((l) => NATURAL_PC[l] === pc);
  if (natural) return { letter: natural, acc: 0 };
  if (preferSharp) {
    const l = LETTERS.find((x) => mod(NATURAL_PC[x] + 1, 12) === pc);
    return { letter: l, acc: 1 };
  }
  const l = LETTERS.find((x) => mod(NATURAL_PC[x] - 1, 12) === pc);
  return { letter: l, acc: -1 };
}

// 코드 심볼: 근음 + 종류(자유 문자열) + 선택적 베이스
const CHORD_RE = /^([A-G](?:#|b)?)([^/]*)(?:\/([A-G](?:#|b)?))?$/;
const QUALITY_RE = /^(?:m|min|maj|M|dim|aug|sus|add|alt|ø|o|\+|-|\d|b|#|\(|\)|,|\^|Δ)*$/;

/** "C#m7b5/G#" → { root, quality:'m7b5', bass } / "N.C." → { nc:true } */
export function parseChord(str) {
  if (/^(N\.?C\.?)$/i.test(str)) return { nc: true };
  const m = CHORD_RE.exec(str);
  if (!m || !QUALITY_RE.test(m[2])) return null;
  return {
    root: parseNote(m[1]),
    quality: m[2],
    bass: m[3] ? parseNote(m[3]) : null,
  };
}

export function chordToString(c) {
  if (c.nc) return 'N.C.';
  return noteToString(c.root) + c.quality + (c.bass ? '/' + noteToString(c.bass) : '');
}

export function transposeChord(chord, fromKey, toKey) {
  if (chord.nc) return chord;
  return {
    root: transposeNote(chord.root, fromKey, toKey),
    quality: chord.quality,
    bass: chord.bass ? transposeNote(chord.bass, fromKey, toKey) : null,
  };
}

/** 표시용: b → ♭, # → ♯ (코드 심볼에서 소문자 b는 항상 임시표) */
export const prettyAccidentals = (s) => s.replace(/b/g, '♭').replace(/#/g, '♯');
