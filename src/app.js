import { parseChart } from './core/parser.js';
import {
  newDoc, newMeasure, cloneDoc, normalizeDoc, docToModel, modelToDoc, measureTime,
} from './core/doc.js';
import {
  parseKey, transposeKey, keyAlternatives, keyToString, prettyAccidentals,
  parseChord, chordToString, diatonicChords, ALL_KEYS,
} from './core/music.js';
import { renderChart } from './render/chordChart.js';

const DOC_KEY = 'compose:doc:v1';
const VIEW_KEY = 'compose:view:v1';
const TIMES = ['2/4', '3/4', '4/4', '5/4', '6/8', '12/8'];

const SAMPLE = `title: 예시 곡
key: C
time: 4/4
tempo: 92

[Intro]
| C | G/B | Am7 | F . G . |

[Verse]
|: C | Em7 | Am | % |
| F | C/E | Dm7 . G7 . | C :|

[Chorus]
| F | G | Em7 | A7 |
| Dm7 | G7 | Csus4 . C . | % ||
`;

const $ = (id) => document.getElementById(id);

// ───────── 상태 ─────────
let doc;
const view = { semitones: 0, altSpelling: false, showOriginal: false };
let sel = null; // { s, m, beat }
let bassMode = false;
const undoStack = [];
const redoStack = [];

function loadState() {
  try {
    const d = localStorage.getItem(DOC_KEY);
    doc = d ? normalizeDoc(JSON.parse(d)) : modelToDoc(parseChart(SAMPLE));
    Object.assign(view, JSON.parse(localStorage.getItem(VIEW_KEY) || '{}'));
  } catch {
    doc = modelToDoc(parseChart(SAMPLE));
  }
}

let saveTimer;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(DOC_KEY, JSON.stringify(doc));
      localStorage.setItem(VIEW_KEY, JSON.stringify(view));
    } catch { /* 저장소 사용 불가 */ }
  }, 250);
}

/** 문서 변경은 모두 여기를 거친다 (실행 취소 기록) */
function edit(fn) {
  undoStack.push(JSON.stringify(doc));
  if (undoStack.length > 200) undoStack.shift();
  redoStack.length = 0;
  fn(doc);
  render();
}

function undo() {
  if (!undoStack.length) return;
  redoStack.push(JSON.stringify(doc));
  doc = JSON.parse(undoStack.pop());
  fixSelection();
  render();
}
function redo() {
  if (!redoStack.length) return;
  undoStack.push(JSON.stringify(doc));
  doc = JSON.parse(redoStack.pop());
  fixSelection();
  render();
}

function fixSelection() {
  if (!sel) return;
  const sec = doc.sections[sel.s];
  if (!sec) { sel = null; return; }
  if (sec.measures.length === 0) { sel = { s: sel.s, m: -1, beat: 0 }; return; }
  sel.m = Math.min(Math.max(sel.m, 0), sec.measures.length - 1);
  sel.beat = Math.min(sel.beat, beatsAt(sel.s, sel.m) - 1);
}

const editable = () => view.semitones === 0;
const curMeasure = () => (sel && sel.m >= 0 ? doc.sections[sel.s]?.measures[sel.m] : null);
const beatsAt = (s, m) => measureTime(doc, s, m).beats;
const currentKey = () => parseKey(doc.meta.key) || parseKey('C');

// ───────── 렌더 ─────────
const chartEl = $('chart');

function render() {
  const model = docToModel(doc);
  chartEl.innerHTML = renderChart(model, { ...view, selected: editable() ? sel : null });
  renderTransposeBar(model);
  renderSongInfo();
  renderPanel();
  $('lock-note').hidden = editable();
  $('btn-undo').disabled = undoStack.length === 0;
  $('btn-redo').disabled = redoStack.length === 0;
  document.title = `${doc.meta.title || '제목 없음'} — Compose`;
  persist();
}

function renderTransposeBar(model) {
  const s = view.semitones;
  $('tr-value').textContent = s > 0 ? `+${s}` : String(s);
  const alts = keyAlternatives(transposeKey(model.meta.key, s));
  const altBtn = $('tr-alt');
  altBtn.hidden = alts.length < 2 || s === 0;
  if (!altBtn.hidden) {
    const suffix = model.meta.key.minor ? 'm' : '';
    const other = view.altSpelling ? alts[0] : alts[1];
    altBtn.textContent = `${prettyAccidentals(other + suffix)}로 표기`;
  }
  $('show-orig').checked = view.showOriginal;
}

function renderSongInfo() {
  const m = doc.meta;
  const set = (id, v) => { if (document.activeElement !== $(id)) $(id).value = v; };
  set('f-title', m.title);
  set('f-artist', m.artist);
  set('f-key', m.key);
  set('f-time', `${m.time.beats}/${m.time.unit}`);
  set('f-tempo', m.tempo ?? '');
  $('song-summary').textContent = `곡 정보 · ${m.title || '제목 없음'} · ${prettyAccidentals(m.key)} · ${m.time.beats}/${m.time.unit}`;
}

function renderPanel() {
  const panel = $('panel');
  const show = Boolean(sel) && editable();
  panel.hidden = !show;
  document.body.classList.toggle('panel-open', show);
  if (!show) return;

  const sec = doc.sections[sel.s];
  const m = curMeasure();
  const model = docToModel(doc);
  const number = m ? model.sections[sel.s].rows.flat()[sel.m]?.number : null;
  const beats = m ? beatsAt(sel.s, sel.m) : 0;
  $('p-title').textContent = m ? `${sec.name || '구간'} · ${number}마디` : `${sec.name || '구간'} (비어 있음)`;

  // 박 버튼: 각 박에 걸린 코드 표시
  const beatsEl = $('p-beats');
  beatsEl.innerHTML = '';
  if (m) {
    const chords = m.simile ? [] : m.chords;
    for (let b = 0; b < beats; b++) {
      const c = chords.find((x) => x.beat === b);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'beat' + (b === sel.beat ? ' on' : '') + (c ? ' has' : '');
      btn.innerHTML = `<small>${b + 1}</small><span>${c ? prettyAccidentals(c.text) : (m.simile && b === 0 ? '%' : '·')}</span>`;
      btn.addEventListener('click', () => { sel.beat = b; renderPanel(); });
      beatsEl.append(btn);
    }
  }

  // 다이어토닉
  const dia = $('p-diatonic');
  dia.innerHTML = '';
  for (const d of diatonicChords(currentKey())) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dia';
    btn.innerHTML = `<small>${d.degree}</small>${prettyAccidentals(d.symbol)}`;
    btn.addEventListener('click', () => setChord(d.symbol));
    dia.append(btn);
  }

  // 도구 상태
  const pressed = (act, on) => {
    const b = document.querySelector(`#p-tools [data-act="${act}"]`);
    b.setAttribute('aria-pressed', String(Boolean(on)));
    b.disabled = !m && !act.startsWith('sec') && act !== 'add';
  };
  pressed('simile', m?.simile);
  pressed('break', m?.lineBreak);
  pressed('rstart', m?.repeatStart);
  pressed('rend', m?.repeatEnd);
  pressed('dbl', m?.doubleBar);
  pressed('add', false);
  pressed('dup', false);
  pressed('del', false);
  document.querySelector('#p-tools [data-act="rend"]').textContent = m?.repeatEnd ? `:| ×${m.repeatCount}` : ':| 끝';
  $('p-time').value = m?.time ? `${m.time.beats}/${m.time.unit}` : '';
  $('p-time').disabled = !m;
  $('p-bass').setAttribute('aria-pressed', String(bassMode));
}

// ───────── 코드 입력 ─────────
function chordAtBeat() {
  const m = curMeasure();
  return m && !m.simile ? m.chords.find((c) => c.beat === sel.beat) : null;
}

function setChord(text) {
  if (!curMeasure()) return toast('먼저 마디를 추가하세요');
  edit(() => {
    const m = curMeasure();
    if (m.simile) { m.simile = false; m.chords = []; }
    const c = m.chords.find((x) => x.beat === sel.beat);
    if (c) c.text = text; else m.chords.push({ beat: sel.beat, text });
    m.chords.sort((a, b) => a.beat - b.beat);
  });
}

function modifyChord(fn) {
  const c = chordAtBeat();
  if (!c) return toast('이 박에 코드가 없어요. 먼저 근음을 고르세요');
  const parsed = parseChord(c.text);
  if (!parsed || parsed.nc) return toast('이 코드는 수정할 수 없어요');
  fn(parsed);
  setChord(chordToString(parsed));
}

function pressRoot(letter) {
  if (bassMode) {
    bassMode = false;
    modifyChord((p) => { p.bass = { letter, acc: 0 }; });
    renderPanel();
    return;
  }
  setChord(letter);
}

function pressAcc(sym) {
  const acc = sym === '#' ? 1 : -1;
  modifyChord((p) => {
    const target = p.bass && lastTouchedBass ? p.bass : p.root;
    target.acc = target.acc === acc ? 0 : acc;
  });
}
let lastTouchedBass = false;

function pressQuality(q) {
  modifyChord((p) => { p.quality = q; });
}

function clearBeat() {
  const m = curMeasure();
  if (!m) return;
  if (m.simile) return edit(() => { curMeasure().simile = false; });
  if (!chordAtBeat()) return;
  edit(() => {
    const mm = curMeasure();
    mm.chords = mm.chords.filter((c) => c.beat !== sel.beat);
  });
}

// ───────── 마디·구간 도구 ─────────
function act(name) {
  const sec = doc.sections[sel.s];
  switch (name) {
    case 'add':
      edit(() => { sec.measures.splice(sel.m + 1, 0, newMeasure()); });
      select(sel.s, sel.m + 1);
      break;
    case 'dup':
      edit(() => { sec.measures.splice(sel.m + 1, 0, JSON.parse(JSON.stringify(curMeasure()))); });
      select(sel.s, sel.m + 1);
      break;
    case 'del':
      edit(() => { sec.measures.splice(sel.m, 1); });
      fixSelection();
      render();
      break;
    case 'simile':
      edit(() => { const m = curMeasure(); m.simile = !m.simile; if (m.simile) m.chords = []; });
      break;
    case 'break':
      edit(() => { const m = curMeasure(); m.lineBreak = !m.lineBreak; });
      break;
    case 'rstart':
      edit(() => { const m = curMeasure(); m.repeatStart = !m.repeatStart; });
      break;
    case 'rend':
      edit(() => {
        const m = curMeasure();
        if (!m.repeatEnd) { m.repeatEnd = true; m.repeatCount = 2; }
        else if (m.repeatCount < 4) m.repeatCount += 1;
        else { m.repeatEnd = false; m.repeatCount = 2; }
      });
      break;
    case 'dbl':
      edit(() => { const m = curMeasure(); m.doubleBar = !m.doubleBar; });
      break;
    case 'sec-add': {
      const name = window.prompt('새 구간 이름', suggestSectionName());
      if (name === null) return;
      edit(() => {
        doc.sections.splice(sel.s + 1, 0, { name: name.trim(), measures: [newMeasure(), newMeasure(), newMeasure(), newMeasure()] });
      });
      select(sel.s + 1, 0);
      break;
    }
    case 'sec-rename': {
      const name = window.prompt('구간 이름', sec.name);
      if (name === null) return;
      edit(() => { sec.name = name.trim(); });
      break;
    }
    case 'sec-del':
      if (doc.sections.length === 1) return toast('마지막 구간은 지울 수 없어요');
      if (sec.measures.length && !window.confirm(`"${sec.name || '구간'}"과 마디 ${sec.measures.length}개를 지울까요?`)) return;
      edit(() => { doc.sections.splice(sel.s, 1); });
      sel = { s: Math.max(0, sel.s - 1), m: 0, beat: 0 };
      fixSelection();
      render();
      break;
    default:
  }
}

function suggestSectionName() {
  const names = doc.sections.map((s) => s.name);
  for (const n of ['Verse', 'Pre-Chorus', 'Chorus', 'Bridge', 'Outro']) if (!names.includes(n)) return n;
  return 'Verse 2';
}

function select(s, m, beat = 0) {
  sel = { s, m, beat };
  bassMode = false;
  render();
  // 선택한 마디가 패널에 가리지 않게
  requestAnimationFrame(() => {
    chartEl.querySelector('.m.sel')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
}

function moveSelection(delta) {
  if (!sel) return select(0, 0);
  const flat = [];
  doc.sections.forEach((sec, s) => sec.measures.forEach((_, m) => flat.push([s, m])));
  const i = flat.findIndex(([s, m]) => s === sel.s && m === sel.m);
  const next = flat[Math.min(Math.max(i + delta, 0), flat.length - 1)];
  if (next) select(next[0], next[1]);
}

// ───────── 알림 ─────────
let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 1800);
}

// ───────── 이벤트 ─────────
chartEl.addEventListener('click', (e) => {
  const mEl = e.target.closest('.m[data-s]');
  if (mEl) {
    if (!editable()) return toast('조옮김 보기 중에는 편집할 수 없어요');
    return select(Number(mEl.dataset.s), Number(mEl.dataset.m));
  }
  const secEl = e.target.closest('.sec[data-sec]');
  if (secEl && editable()) {
    const s = Number(secEl.dataset.sec);
    if (doc.sections[s].measures.length === 0) select(s, -1);
  }
});

$('p-close').addEventListener('click', () => { sel = null; render(); });
$('p-clear').addEventListener('click', clearBeat);
$('p-roots').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.root) { lastTouchedBass = bassMode; pressRoot(b.dataset.root); }
  else if (b.dataset.acc) pressAcc(b.dataset.acc);
  else if (b.id === 'p-bass') {
    if (!chordAtBeat()) return toast('먼저 코드를 입력하세요');
    bassMode = !bassMode;
    renderPanel();
  }
});
$('p-qualities').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-q]');
  if (b) pressQuality(b.dataset.q);
});
$('p-tools').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-act]');
  if (!b || !sel) return;
  if (sel.m < 0 && b.dataset.act === 'add') {
    edit(() => { doc.sections[sel.s].measures.push(newMeasure()); });
    return select(sel.s, 0);
  }
  act(b.dataset.act);
});
$('p-time').addEventListener('change', (e) => {
  const v = e.target.value;
  edit(() => {
    const m = curMeasure();
    m.time = v ? { beats: Number(v.split('/')[0]), unit: Number(v.split('/')[1]) } : null;
  });
  fixSelection();
  render();
});

// 곡 정보
function fillSelect(el, items, labelFn = (x) => x) {
  el.innerHTML = items.map((v) => `<option value="${v}">${labelFn(v)}</option>`).join('');
}
fillSelect($('f-key'), ALL_KEYS, (k) => prettyAccidentals(k));
fillSelect($('f-time'), TIMES);
fillSelect($('p-time'), ['', ...TIMES], (t) => t || '이어서');

$('f-title').addEventListener('change', (e) => edit(() => { doc.meta.title = e.target.value.trim(); }));
$('f-artist').addEventListener('change', (e) => edit(() => { doc.meta.artist = e.target.value.trim(); }));
$('f-key').addEventListener('change', (e) => edit(() => { doc.meta.key = e.target.value; }));
$('f-time').addEventListener('change', (e) => {
  const [beats, unit] = e.target.value.split('/').map(Number);
  edit(() => { doc.meta.time = { beats, unit }; });
  fixSelection();
  render();
});
$('f-tempo').addEventListener('change', (e) => {
  const n = Number(e.target.value);
  edit(() => { doc.meta.tempo = n > 0 ? n : null; });
});

// 조옮김
function setTranspose(n) {
  view.semitones = ((n + 17) % 12 + 12) % 12 - 5; // -5..+6
  view.altSpelling = false;
  render();
}
$('tr-up').addEventListener('click', () => setTranspose(view.semitones + 1));
$('tr-down').addEventListener('click', () => setTranspose(view.semitones - 1));
$('tr-reset').addEventListener('click', () => setTranspose(0));
$('tr-alt').addEventListener('click', () => { view.altSpelling = !view.altSpelling; render(); });
$('show-orig').addEventListener('change', (e) => { view.showOriginal = e.target.checked; render(); });

// 파일
$('btn-undo').addEventListener('click', undo);
$('btn-redo').addEventListener('click', redo);
$('btn-print').addEventListener('click', () => window.print());

$('btn-new').addEventListener('click', () => {
  if (!window.confirm('새 악보를 만들까요? 지금 악보는 "내보내기"로 저장해 두지 않으면 사라집니다. (실행 취소로 되돌릴 수는 있어요)')) return;
  edit(() => { doc = newDoc(); });
  view.semitones = 0;
  select(0, 0);
  $('songinfo').open = true;
});

$('btn-export').addEventListener('click', () => {
  const name = (doc.meta.title || 'chart').replace(/[\\/:*?"<>|]/g, '_');
  download(`${name}.json`, JSON.stringify(doc, null, 2), 'application/json');
});

function download(filename, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const dlg = $('import-dlg');
$('btn-import').addEventListener('click', () => {
  $('import-err').hidden = true;
  dlg.showModal();
});

function replaceDoc(next) {
  edit(() => { doc = next; });
  view.semitones = 0;
  sel = null;
  render();
  dlg.close();
  toast('가져왔어요. 실행 취소로 되돌릴 수 있습니다');
}

function showImportError(msg) {
  $('import-err').textContent = msg;
  $('import-err').hidden = false;
}

function importText(text) {
  const model = parseChart(text);
  if (model.errors.length) {
    return showImportError(model.errors.slice(0, 5).map((e) => `${e.line}행: ${e.message}`).join('\n'));
  }
  if (!model.sections.length) return showImportError('마디가 없습니다');
  replaceDoc(modelToDoc(model));
}

$('import-go').addEventListener('click', () => importText($('import-text').value));
$('import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const text = await file.text();
  if (file.name.endsWith('.json') || text.trim().startsWith('{')) {
    try { replaceDoc(normalizeDoc(JSON.parse(text))); } catch (err) { showImportError(err.message); }
  } else {
    $('import-text').value = text;
    importText(text);
  }
});

// 키보드 (데스크톱)
document.addEventListener('keydown', (e) => {
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || dlg.open) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); return e.shiftKey ? redo() : undo(); }
  if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); return redo(); }
  if (mod || e.altKey || !editable()) return;

  if (e.key === 'ArrowRight') { e.preventDefault(); return moveSelection(1); }
  if (e.key === 'ArrowLeft') { e.preventDefault(); return moveSelection(-1); }
  if (!sel) return;
  if (e.key === 'Escape') { sel = null; return render(); }
  if (e.key === ' ' || e.key === 'Tab') {
    e.preventDefault();
    const beats = curMeasure() ? beatsAt(sel.s, sel.m) : 1;
    if (sel.beat + 1 < beats) { sel.beat += 1; return renderPanel(); }
    return moveSelection(1);
  }
  if (/^[a-gA-G]$/.test(e.key)) { lastTouchedBass = bassMode; return pressRoot(e.key.toUpperCase()); }
  if (e.key === '#') return pressAcc('#');
  if (e.key === '-') return pressAcc('b');
  if (e.key === 'm') return pressQuality('m');
  if (e.key === '7') return modifyChord((p) => { p.quality += '7'; });
  if (e.key === '/') { if (chordAtBeat()) { bassMode = true; renderPanel(); } return; }
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); return clearBeat(); }
  if (e.key === 'Enter') { e.preventDefault(); return act('add'); }
});

// 시작
loadState();
render();
window.__compose = { get doc() { return doc; }, keyToString, cloneDoc };
