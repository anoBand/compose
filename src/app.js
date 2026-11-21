import { parseChart } from './core/parser.js';
import {
  newDoc, newMeasure, cloneDoc, normalizeDoc, docToModel, modelToDoc, measureTime,
} from './core/doc.js';
import {
  parseKey, transposeKey, keyAlternatives, keyToString, prettyAccidentals,
  parseChord, chordToString, diatonicChords, ALL_KEYS,
} from './core/music.js';
import { renderChart } from './render/chordChart.js';
import * as api from './api.js';
import { exportPdf, exportJpg } from './export.js';
import { createTutorial } from './tutorial.js';

const DOC_KEY = 'compose:doc:v1';
const VIEW_KEY = 'compose:view:v1';
const LOCAL_HANDLED_KEY = 'compose:local-handled:v1';
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
const sampleDoc = () => modelToDoc(parseChart(SAMPLE));

const $ = (id) => document.getElementById(id);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* 저장소 사용 불가 */ } },
};

// ───────── 상태 ─────────
let doc = newDoc();
const view = { semitones: 0, altSpelling: false, showOriginal: false };
let sel = null; // { s, m, beat }
let bassMode = false;
const undoStack = [];
const redoStack = [];

/** 지금 편집 중인 악보가 어디 저장되는지: 브라우저(local) 또는 서버(cloud) */
let source = null; // { kind: 'local' } | { kind: 'cloud', id, rev } | { kind: 'tutorial' }
const auth = { enabled: false, clientId: null, user: null };

const viewKey = () => {
  if (source?.kind === 'tutorial') return null; // 연습 악보는 저장하지 않는다
  return source?.kind === 'cloud' ? `compose:view:${source.id}` : VIEW_KEY;
};
const defaultView = () => ({ semitones: 0, altSpelling: false, showOriginal: false });

function resetEditorState(nextDoc) {
  doc = nextDoc;
  undoStack.length = 0;
  redoStack.length = 0;
  sel = null;
  bassMode = false;
  Object.assign(view, defaultView());
  if (viewKey()) {
    try { Object.assign(view, JSON.parse(store.get(viewKey()) || '{}')); } catch { /* 무시 */ }
  }
}

function readLocalDoc() {
  try {
    const d = store.get(DOC_KEY);
    return d ? normalizeDoc(JSON.parse(d)) : null;
  } catch {
    return null;
  }
}

let saveTimer;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (viewKey()) store.set(viewKey(), JSON.stringify(view));
    if (source?.kind === 'local') store.set(DOC_KEY, JSON.stringify(doc));
  }, 250);
  if (source?.kind === 'cloud') cloud.schedule();
}

// ───────── 서버 저장 (자동, 0.8초 모아서) ─────────
const cloud = {
  lastSaved: '',
  timer: null,
  chain: Promise.resolve(),
  failed: false,

  dirty() { return source?.kind === 'cloud' && JSON.stringify(doc) !== this.lastSaved; },

  schedule() {
    clearTimeout(this.timer);
    if (!this.dirty()) { if (!this.failed) setSaveState('saved'); return; }
    setSaveState('pending');
    this.timer = setTimeout(() => this.save(), 800);
  },

  /** 저장 요청은 한 번에 하나씩 순서대로 (rev가 꼬이지 않게) */
  save() {
    clearTimeout(this.timer);
    this.chain = this.chain.then(() => this.saveOnce()).catch(() => {});
    return this.chain;
  },

  async saveOnce() {
    const src = source;
    if (src?.kind !== 'cloud') return;
    const json = JSON.stringify(doc);
    if (json === this.lastSaved) { setSaveState('saved'); return; }
    setSaveState('saving');
    try {
      const r = await api.saveChart(src.id, JSON.parse(json), src.rev);
      src.rev = r.rev;
      if (source === src) this.lastSaved = json;
      this.failed = false;
    } catch (e) {
      if (e.status === 409 && e.data?.current) return resolveConflict(src, e.data.current);
      this.failed = true;
      if (e.status === 401) {
        setSaveState('error', '로그인이 만료되어 저장하지 못했어요');
        toast('로그인이 만료됐어요. 다른 탭에서 다시 로그인한 뒤 "저장 안 됨"을 누르세요');
      } else {
        setSaveState('error', e.message);
        this.timer = setTimeout(() => this.save(), 8000);
      }
      return;
    }
    if (source === src) this.schedule();
  },

  async flush() {
    if (this.dirty()) await this.save();
    await this.chain;
  },
};

async function resolveConflict(src, current) {
  if (source !== src) return;
  const overwrite = window.confirm('다른 기기나 탭에서 이 악보가 먼저 바뀌었어요.\n\n'
    + '확인: 지금 화면의 내용으로 덮어쓰기\n취소: 다른 곳에서 저장한 내용 불러오기');
  src.rev = current.rev;
  if (overwrite) {
    cloud.failed = false;
    cloud.timer = setTimeout(() => cloud.save(), 0);
  } else {
    doc = normalizeDoc(current.doc);
    cloud.lastSaved = JSON.stringify(doc);
    undoStack.length = 0;
    redoStack.length = 0;
    fixSelection();
    render();
    toast('다른 곳에서 저장한 내용을 불러왔어요');
  }
}

function setSaveState(state, detail = '') {
  const el = $('save-state');
  el.hidden = source?.kind !== 'cloud';
  el.dataset.state = state;
  el.textContent = { pending: '저장 대기', saving: '저장 중…', saved: '저장됨', error: '저장 안 됨 ↻' }[state] || '';
  el.title = state === 'error' ? `${detail} (누르면 다시 시도)` : '서버에 자동 저장됩니다';
  el.disabled = state !== 'error';
}
$('save-state').addEventListener('click', () => { cloud.failed = false; cloud.save(); });

window.addEventListener('beforeunload', (e) => {
  if (cloud.dirty()) { e.preventDefault(); e.returnValue = ''; }
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && cloud.dirty()) cloud.save();
});

/** 문서 변경은 모두 여기를 거친다 (실행 취소 기록) */
function edit(fn) {
  pushUndo();
  fn(doc);
  render();
}
function pushUndo() {
  undoStack.push(JSON.stringify(doc));
  if (undoStack.length > 200) undoStack.shift();
  redoStack.length = 0;
}

function undo() {
  if (!undoStack.length) return;
  tutEvents.undo += 1;
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
const DIA7_KEY = 'compose:diatonic-7th'; // 다이어토닉 줄 3화음/7화음 (이 브라우저 설정)
const dia7 = () => store.get(DIA7_KEY) === '1';
const curMeasure = () => (sel && sel.m >= 0 ? doc.sections[sel.s]?.measures[sel.m] : null);
const beatsAt = (s, m) => measureTime(doc, s, m).beats;
const currentKey = () => parseKey(doc.meta.key) || parseKey('C');

// ───────── 렌더 ─────────
const chartEl = $('chart');

function render() {
  const model = docToModel(doc);
  chartEl.innerHTML = renderChart(model, { ...view, selected: editable() ? sel : null, hideHead: editable(), editNotes: editable(), noteSec });
  chartEl.querySelectorAll('.sec-note-input').forEach(autosize);
  markBeat();
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
  set('f-key', m.key);
  set('f-time', `${m.time.beats}/${m.time.unit}`);
  set('f-tempo', m.tempo ?? '');
  set('f-note', m.note || '');
  $('f-note').classList.toggle('blank', !m.note);
  autosize($('f-note'));
  $('head-edit').hidden = !editable(); // 조옮김 보기 중에는 renderChart가 그린 머리말(원래 키 › 새 키)
  $('f-title').classList.toggle('blank', !m.title);
  $('f-tempo').closest('.tempo').classList.toggle('blank', !m.tempo);
  for (const id of ['f-key', 'f-time', 'f-tempo']) fitWidth($(id));
}

/** 머리말의 키·박자·템포 칸을 글자 길이에 맞춘다 (select는 가장 긴 항목 폭이 기본이라 틈이 생김) */
const measureCtx = document.createElement('canvas').getContext('2d');
function fitWidth(el) {
  const text = el.tagName === 'SELECT' ? el.selectedOptions[0]?.text || '' : el.value || el.placeholder;
  const cs = getComputedStyle(el);
  measureCtx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const w = Math.ceil(measureCtx.measureText(text).width);
  el.style.width = `calc(${w}px + ${cs.paddingLeft} + ${cs.paddingRight} + 4px)`;
}

/** 메모 칸 높이를 내용에 맞춘다 */
function autosize(el) {
  el.style.height = 'auto';
  if (el.scrollHeight) el.style.height = `${el.scrollHeight + 2}px`;
}

/** 새 악보면 제목 칸으로 (키보드가 튀어나오지 않게 마우스 기기만) */
function focusTitle() {
  if (window.matchMedia('(pointer: fine)').matches) $('f-title').focus();
}

function renderPanel() {
  queueMicrotask(() => tut.poke()); // 따라 하기: 화면이 다 바뀐 뒤 단계 조건 확인
  const panel = $('panel');
  const show = Boolean(sel) && editable();
  panel.hidden = !show;
  $('p-tools').hidden = !show; // 마디·구간 도구(보기 줄)도 마디를 골랐을 때만
  document.body.classList.toggle('panel-open', show);
  if (!show) return;

  const m = curMeasure();
  const model = docToModel(doc);
  const number = m ? model.sections[sel.s].rows.flat()[sel.m]?.number : null;
  const beats = m ? beatsAt(sel.s, sel.m) : 0;
  const titleEl = $('p-title');
  // 구간 이름은 악보에서 보이므로 마디·박만
  titleEl.innerHTML = m
    ? `<span class="nb">${number}마디</span> <span class="nb">${sel.beat + 1}박</span>`
    : `<span class="nb">빈 구간</span>`;

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
      btn.addEventListener('click', () => { sel.beat = b; render(); });
      beatsEl.append(btn);
    }
  }

  // 다이어토닉
  const dia = $('p-diatonic');
  dia.innerHTML = '';
  const tutorial = source?.kind === 'tutorial'; // 따라 하기는 3화음 기준으로 안내
  const sevenths = !tutorial && dia7();
  if (!tutorial) {
    const tg = document.createElement('button');
    tg.type = 'button';
    tg.className = 'dia-toggle';
    tg.title = sevenths ? '지금 7화음 (누르면 3화음)' : '지금 3화음 (누르면 7화음)';
    tg.setAttribute('aria-label', tg.title);
    tg.innerHTML = `<span${sevenths ? '' : ' class="on"'}>3</span><i>/</i><span${sevenths ? ' class="on"' : ''}>7</span>`;
    tg.addEventListener('click', () => { store.set(DIA7_KEY, sevenths ? '0' : '1'); renderPanel(); });
    dia.append(tg);
  }
  diatonicChords(currentKey(), sevenths).forEach((d, step) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dia';
    btn.dataset.step = String(step);
    btn.innerHTML = `<small>${d.degree}</small>${prettyAccidentals(d.symbol)}`;
    btn.addEventListener('click', () => setChord(d.symbol));
    dia.append(btn);
  });

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
        doc.sections.splice(sel.s + 1, 0, { name: name.trim(), note: '', measures: [newMeasure(), newMeasure(), newMeasure(), newMeasure()] });
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
    case 'sec-note':
      openSectionNote(sel.s);
      chartEl.querySelector(`.sec-note-input[data-note-sec="${sel.s}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      break;
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

// 보기 줄(조옮김·마디 도구)을 상단바 바로 아래에 붙여 두기 위한 높이
const syncTopbarHeight = () => document.documentElement.style.setProperty(
  '--topbar-h', `${document.querySelector('.topbar').offsetHeight}px`,
);
window.addEventListener('resize', syncTopbarHeight);
syncTopbarHeight();

// ───────── 악보에서 박 바로 고르기 ─────────
// 마디 안의 코드 칸(data-b 시작 박, data-d 길이)은 길이만큼 폭을 차지하므로, 누른 x 위치로 박을 계산한다
const measureEl = (s, m) => chartEl.querySelector(`.m[data-s="${s}"][data-m="${m}"]`);
const beatSpans = (mEl) => [...mEl.querySelectorAll('.beats > [data-b]')].map((el) => ({
  b: Number(el.dataset.b), d: Math.max(1, Number(el.dataset.d) || 1), r: el.getBoundingClientRect(),
}));

function beatAtPoint(mEl, x, beats) {
  const spans = beatSpans(mEl);
  if (!spans.length) return 0;
  let best = spans[0];
  let dist = Infinity;
  for (const sp of spans) {
    const dx = x < sp.r.left ? sp.r.left - x : x > sp.r.right ? x - sp.r.right : 0;
    if (dx < dist) { dist = dx; best = sp; }
  }
  const frac = Math.min(Math.max((x - best.r.left) / (best.r.width || 1), 0), 0.999);
  return Math.min(best.b + Math.floor(frac * best.d), beats - 1);
}

/** 화면에서 (구간, 마디, 박)이 차지하는 사각형 (선택 표시·튜토리얼 강조용) */
function beatRect(s, m, beat) {
  const mEl = measureEl(s, m);
  if (!mEl) return null;
  const mr = mEl.getBoundingClientRect();
  const sp = beatSpans(mEl).find((x) => beat >= x.b && beat < x.b + x.d);
  if (!sp) return null;
  const w = sp.r.width / sp.d;
  return { left: sp.r.left + (beat - sp.b) * w, top: mr.top, width: w, height: mr.height, bottom: mr.bottom };
}

/** 선택한 박을 악보에 표시 */
function markBeat() {
  if (!sel || sel.m < 0 || !editable()) return;
  const mEl = measureEl(sel.s, sel.m);
  const r = beatRect(sel.s, sel.m, sel.beat);
  if (!mEl || !r) return;
  const mr = mEl.getBoundingClientRect();
  const mark = document.createElement('span');
  mark.className = 'beat-mark';
  mark.style.left = `${r.left - mr.left}px`;
  mark.style.width = `${r.width}px`;
  mEl.append(mark);
}
window.addEventListener('resize', () => { chartEl.querySelector('.beat-mark')?.remove(); markBeat(); });

/** 마우스를 올린 박 표시 (마우스가 있는 기기만) */
let hoverEl = null;
function clearHover() { hoverEl?.remove(); hoverEl = null; }
chartEl.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse') return;
  const mEl = e.target.closest('.m[data-s]');
  if (!mEl || !editable()) return clearHover();
  const s = Number(mEl.dataset.s);
  const m = Number(mEl.dataset.m);
  const r = beatRect(s, m, beatAtPoint(mEl, e.clientX, beatsAt(s, m)));
  if (!r) return clearHover();
  if (!hoverEl || hoverEl.parentElement !== mEl) {
    clearHover();
    hoverEl = document.createElement('span');
    hoverEl.className = 'beat-hover';
    mEl.prepend(hoverEl); // 선택 표시(.beat-mark)보다 아래에
  }
  const mr = mEl.getBoundingClientRect();
  hoverEl.style.left = `${r.left - mr.left}px`;
  hoverEl.style.width = `${r.width}px`;
});
chartEl.addEventListener('pointerleave', clearHover);

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
  if (e.target.closest('.sec-note-input')) return; // 메모 칸을 누를 때 다시 그리면 포커스를 잃음
  const headEl = e.target.closest('.sec-head[data-head-sec]');
  if (headEl) {
    if (!editable()) return toast('조옮김 보기 중에는 편집할 수 없어요');
    return openSectionNote(Number(headEl.dataset.headSec));
  }
  const mEl = e.target.closest('.m[data-s]');
  if (mEl) {
    if (!editable()) return toast('조옮김 보기 중에는 편집할 수 없어요');
    const s = Number(mEl.dataset.s);
    const m = Number(mEl.dataset.m);
    return select(s, m, beatAtPoint(mEl, e.clientX, beatsAt(s, m)));
  }
  const secEl = e.target.closest('.sec[data-sec]');
  if (secEl && editable()) {
    const s = Number(secEl.dataset.sec);
    if (doc.sections[s].measures.length === 0) select(s, -1);
  }
});

$('p-close').addEventListener('click', () => { sel = null; render(); });
$('p-roots').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.id === 'p-hold') clearBeat();
  else if (b.dataset.root) { lastTouchedBass = bassMode; pressRoot(b.dataset.root); }
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
$('f-key').addEventListener('change', (e) => edit(() => { doc.meta.key = e.target.value; }));
$('f-time').addEventListener('change', (e) => {
  const [beats, unit] = e.target.value.split('/').map(Number);
  edit(() => { doc.meta.time = { beats, unit }; });
  fixSelection();
  render();
});
$('f-tempo').addEventListener('change', (e) => {
  const n = Math.round(Number(e.target.value));
  edit(() => { doc.meta.tempo = n > 0 ? Math.min(Math.max(n, 20), 400) : null; });
  e.target.value = doc.meta.tempo ?? '';
  fitWidth(e.target);
});
$('f-tempo').addEventListener('input', (e) => fitWidth(e.target));
// 메모(곡·구간): 입력할 때마다 저장하고 악보는 다시 그리지 않는다 (포커스 유지).
// 실행 취소 기록은 칸에 들어가서 처음 고칠 때 한 번만 남긴다.
let noteUndoPushed = false;
let noteSec = null; // 구간 머리를 눌러 메모 칸을 연 구간 (칸에서 나오면 해제)
function openSectionNote(s) {
  let el = chartEl.querySelector(`.sec-note-input[data-note-sec="${s}"]`);
  if (!el) {
    noteSec = s;
    render();
    el = chartEl.querySelector(`.sec-note-input[data-note-sec="${s}"]`);
  }
  if (!el) return;
  el.focus();
  el.setSelectionRange(el.value.length, el.value.length);
}
chartEl.addEventListener('focusout', (e) => {
  if (e.target.matches('.sec-note-input')) noteSec = null; // 다음에 다시 그릴 때 빈 칸은 사라짐
});
function noteInput(el, apply) {
  if (!noteUndoPushed) { pushUndo(); noteUndoPushed = true; $('btn-undo').disabled = false; $('btn-redo').disabled = true; }
  apply(el.value.replace(/\s+$/, ''));
  el.classList.toggle('blank', !el.value.trim());
  autosize(el);
  persist();
}
document.addEventListener('focusin', (e) => {
  if (e.target.matches('#f-note, .sec-note-input')) noteUndoPushed = false;
});
$('f-note').addEventListener('input', (e) => noteInput(e.target, (v) => { doc.meta.note = v; }));
chartEl.addEventListener('input', (e) => {
  const el = e.target.closest('.sec-note-input');
  if (el) noteInput(el, (v) => { doc.sections[Number(el.dataset.noteSec)].note = v; });
});
// 메모 칸에서 Esc 또는 Ctrl+Enter로 빠져나옴 (Enter는 줄바꿈)
document.addEventListener('keydown', (e) => {
  if (!e.target.matches?.('#f-note, .sec-note-input')) return;
  if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); e.target.blur(); }
});

// 머리말 입력 칸: Enter로 확정하고 빠져나옴
for (const id of ['f-title', 'f-tempo']) {
  $(id).addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); e.target.blur(); }
  });
}

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

$('btn-new').addEventListener('click', async () => {
  if (source?.kind === 'cloud') {
    await createAndOpen(newDoc());
    return;
  }
  if (!window.confirm('새 악보를 만들까요? 지금 악보는 "내보내기"로 저장해 두지 않으면 사라집니다. (실행 취소로 되돌릴 수는 있어요)')) return;
  edit(() => { doc = newDoc(); });
  view.semitones = 0;
  select(0, 0);
  focusTitle();
});

/** 파일 이름: 제목 (+ 조옮김한 키) */
function fileBase() {
  let name = (doc.meta.title || 'chart').replace(/[\\/:*?"<>|]/g, '_').trim() || 'chart';
  if (view.semitones !== 0) name += ` (${keyToString(transposeKey(currentKey(), view.semitones, view.altSpelling))})`;
  return name;
}

function download(filename, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// 내보내기
const exportDlg = $('export-dlg');
$('btn-export').addEventListener('click', () => {
  const k = prettyAccidentals(keyToString(transposeKey(currentKey(), view.semitones, view.altSpelling)));
  $('export-note').textContent = view.semitones
    ? `PDF·JPG는 지금 보이는 ${k} 키로 만듭니다. JSON은 원래 키(${prettyAccidentals(doc.meta.key)})로 저장됩니다.`
    : `PDF·JPG·인쇄는 지금 보이는 악보 그대로 만듭니다.`;
  exportDlg.showModal();
});
exportDlg.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-fmt]');
  if (b) doExport(b.dataset.fmt);
});

function busy(text) {
  $('busy').hidden = !text;
  $('busy-text').textContent = text || '';
}

async function doExport(fmt) {
  exportDlg.close();
  if (fmt === 'json') {
    const name = (doc.meta.title || 'chart').replace(/[\\/:*?"<>|]/g, '_');
    download(`${name}.json`, JSON.stringify(doc, null, 2), 'application/json');
    return;
  }
  if (fmt === 'print') { window.print(); return; }
  const model = docToModel(doc);
  busy(fmt === 'pdf' ? 'PDF 만드는 중…' : 'JPG 만드는 중…');
  try {
    await new Promise((r) => setTimeout(r, 30)); // 오버레이가 먼저 보이게
    if (fmt === 'pdf') await exportPdf(model, view, fileBase());
    else await exportJpg(model, view, fileBase());
  } catch (err) {
    console.error(err);
    toast(err.message || '내보내지 못했어요');
  } finally {
    busy('');
  }
}

// 가져오기 (편집기: 지금 악보 바꾸기 / 홈: 새 악보로 만들기)
const dlg = $('import-dlg');
let importMode = 'replace';
function openImport(mode) {
  importMode = mode;
  $('import-title').textContent = mode === 'new' ? '가져와서 새 악보 만들기' : '가져오기 (지금 악보를 바꿉니다)';
  $('import-err').hidden = true;
  dlg.showModal();
}
$('btn-import').addEventListener('click', () => openImport('replace'));
$('home-import').addEventListener('click', () => openImport('new'));

async function replaceDoc(next) {
  if (importMode === 'new') {
    dlg.close();
    await createAndOpen(next);
    return;
  }
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
  return replaceDoc(modelToDoc(model));
}

$('import-go').addEventListener('click', () => importText($('import-text').value));
$('import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const text = await file.text();
  if (file.name.endsWith('.json') || text.trim().startsWith('{')) {
    try { await replaceDoc(normalizeDoc(JSON.parse(text))); } catch (err) { showImportError(err.message); }
  } else {
    $('import-text').value = text;
    importText(text);
  }
});

// 키보드 (데스크톱)
document.addEventListener('keydown', (e) => {
  if ($('editor').hidden) return;
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || dlg.open || exportDlg.open) return;
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
    if (sel.beat + 1 < beats) { sel.beat += 1; return render(); }
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

// ───────── 화면 전환 ─────────
//   #/          홈 (로그인 전: 소개·로그인, 로그인 후: 악보 목록)
//   #/c/<id>    서버에 저장된 악보 편집
//   #/local     로그인 없이 이 브라우저에만 저장
let routeSeq = 0;

function showView(name) {
  const inEditor = name === 'editor';
  $('home').hidden = inEditor;
  $('editor').hidden = !inEditor;
  $('editor-actions').hidden = !inEditor;
  $('btn-home').hidden = !inEditor || !auth.enabled;
  $('account').hidden = inEditor || !auth.user;
  // 테마 버튼은 홈에서만. 서버 없는 모드는 홈이 없어서 편집기에 둔다
  $('tb-right').hidden = inEditor && auth.enabled;
  document.body.classList.toggle('in-editor', inEditor);
  if (!inEditor) {
    $('save-state').hidden = true;
    document.body.classList.remove('panel-open');
    document.title = auth.user ? '내 악보 — Compose' : 'Compose — 코드 악보';
  }
}

function go(hash) {
  if (location.hash === hash || (hash === '#/' && !location.hash)) route();
  else location.hash = hash;
}

async function route() {
  const seq = ++routeSeq;
  try { await cloud.flush(); } catch { /* 저장 실패는 표시에 남아 있음 */ }
  if (seq !== routeSeq) return;
  const h = location.hash;
  if (h === '#/tutorial') return openTutorial();
  if (tut.active) { tut.stop(false); markTutorialDone(); } // 뒤로 가기 등으로 나가도 본 것으로
  const m = /^#\/c\/([a-f0-9]{24})$/.exec(h);
  if (m) {
    if (!auth.user) return go('#/');
    return openCloud(m[1], seq);
  }
  if (h === '#/local' || !auth.enabled) return openLocal();
  return showHome(seq);
}
let prevHash = '#/';
window.addEventListener('hashchange', (e) => {
  prevHash = new URL(e.oldURL).hash || '#/';
  route();
});
$('btn-home').addEventListener('click', () => go('#/'));

function openLocal() {
  // 게스트가 처음 편집기에 들어오면 튜토리얼부터 (건너뛸 수 있음)
  if (!auth.user && !tutorialSeenHere()) return startTutorial('#/local', { replace: true });
  source = { kind: 'local' };
  resetEditorState(readLocalDoc() || sampleDoc());
  showView('editor');
  render();
}

// ───────── 테마 (라이트/다크) ─────────
// 고르기 전에는 기기 설정을 따른다. 고르면 이 브라우저에 기록 (src/theme-init.js가 첫 화면 전에 적용)
const THEME_KEY = 'compose:theme';
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
const isDark = () => (document.documentElement.dataset.theme || (darkQuery.matches ? 'dark' : 'light')) === 'dark';
const SVG = (body) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICON_SUN = SVG('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>');
const ICON_MOON = SVG('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>');
function updateThemeButton() {
  const label = isDark() ? '라이트 모드로' : '다크 모드로';
  $('btn-theme').innerHTML = isDark() ? ICON_SUN : ICON_MOON;
  $('btn-theme').title = label;
  $('btn-theme').setAttribute('aria-label', label);
}
$('btn-theme').addEventListener('click', () => {
  const next = isDark() ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  store.set(THEME_KEY, next);
  updateThemeButton();
  if (!$('home-guest').hidden && !$('home').hidden) renderGuest(); // Google 버튼 색도 맞춘다
});
darkQuery.addEventListener('change', updateThemeButton);
updateThemeButton();

// ───────── 따라 하기 ─────────
// 게스트: 이 브라우저에서 처음 편집기를 열 때, 로그인 사용자: 계정으로 처음 로그인했을 때 자동으로 시작.
// 끝내거나 건너뛰면(✕, 나중에 하기, 뒤로 가기) 본 것으로 기록: 브라우저(localStorage) + 로그인했으면 서버(계정)
const TUT_KEY = 'compose:tutorial-done:v1';
const tutorialSeenHere = () => store.get(TUT_KEY) === '1';
let tutReturn = null;

function markTutorialDone() {
  store.set(TUT_KEY, '1');
  if (auth.user && !auth.user.tutorialDone) {
    auth.user.tutorialDone = true;
    api.markTutorialDone().catch(() => { /* 다음 로그인 때 이 브라우저 기록으로 다시 맞춘다 */ });
  }
}

/** 튜토리얼을 열고, 끝나면 returnHash로 돌아간다. replace: 자동 시작이라 방문 기록을 남기지 않음 */
function startTutorial(returnHash, { replace = false } = {}) {
  tutReturn = returnHash;
  if (replace) {
    history.replaceState(null, '', '#/tutorial');
    return openTutorial();
  }
  return go('#/tutorial');
}

const tutEvents = { undo: 0 };
const tut = createTutorial({
  getCtx: () => ({
    doc, sel, view, events: tutEvents, beatRect,
    panelOpen: !$('panel').hidden && !$('editor').hidden,
  }),
  onExit: () => {
    markTutorialDone();
    let back = tutReturn || (prevHash && prevHash !== '#/tutorial' ? prevHash : '#/');
    if (!auth.enabled && back === '#/') back = '#/local';
    tutReturn = null;
    go(back);
  },
});

function openTutorial() {
  source = { kind: 'tutorial' };
  resetEditorState(sampleDoc()); // 예시 곡 (저장하지 않음)
  showView('editor');
  $('btn-home').hidden = true;
  render();
  tut.begin();
  window.scrollTo(0, 0);
}
$('btn-help').addEventListener('click', () => startTutorial(location.hash || '#/'));
$('home-help').addEventListener('click', () => startTutorial('#/'));

async function openCloud(id, seq) {
  source = null;
  showView('editor');
  chartEl.innerHTML = '<p class="empty">불러오는 중…</p>';
  $('panel').hidden = true;
  let rec;
  try {
    rec = await api.getChart(id);
  } catch (e) {
    if (seq !== routeSeq) return;
    if (e.status === 401) { auth.user = null; toast('다시 로그인하세요'); }
    else toast(e.status === 404 ? '악보를 찾을 수 없어요' : e.message);
    return go('#/');
  }
  if (seq !== routeSeq) return;
  source = { kind: 'cloud', id, rev: rec.rev };
  resetEditorState(normalizeDoc(rec.doc));
  cloud.lastSaved = JSON.stringify(doc);
  cloud.failed = false;
  render();
  if (!doc.meta.title && doc.sections.every((s) => s.measures.every((mm) => !mm.chords.length))) focusTitle();
}

async function createAndOpen(nextDoc) {
  try {
    busy('새 악보 만드는 중…');
    await cloud.flush();
    const chart = await api.createChart(nextDoc);
    go(`#/c/${chart.id}`);
  } catch (e) {
    toast(e.message);
  } finally {
    busy('');
  }
}

// ───────── 홈 ─────────
let charts = [];

async function showHome(seq) {
  source = null;
  showView('home');
  $('home-guest').hidden = Boolean(auth.user);
  $('home-user').hidden = !auth.user;
  if (!auth.user) return renderGuest();
  // 계정으로 처음 로그인: 이 브라우저에서 이미 봤으면 계정에만 기록, 아니면 튜토리얼부터
  if (!auth.user.tutorialDone) {
    if (tutorialSeenHere()) markTutorialDone();
    else return startTutorial('#/', { replace: true });
  }

  $('acct-name').textContent = auth.user.name || auth.user.email;
  $('acct-name').title = auth.user.email;
  $('acct-pic').hidden = !auth.user.picture;
  if (auth.user.picture) $('acct-pic').src = auth.user.picture;
  renderLocalBanner();

  $('list-state').textContent = '불러오는 중…';
  try {
    const list = await api.listCharts();
    if (seq !== routeSeq) return;
    charts = list;
    renderList();
  } catch (e) {
    if (seq !== routeSeq) return;
    if (e.status === 401) { auth.user = null; return showHome(seq); }
    $('list-state').textContent = e.message;
  }
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

function ago(iso) {
  const t = new Date(iso);
  const diff = (Date.now() - t) / 1000;
  if (diff < 60) return '방금';
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}일 전`;
  return t.toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' });
}

function renderList() {
  const q = $('chart-search').value.trim().toLowerCase();
  const shown = q ? charts.filter((c) => `${c.title} ${c.artist}`.toLowerCase().includes(q)) : charts;
  $('list-state').textContent = charts.length === 0
    ? '아직 악보가 없어요. "＋ 새 악보"로 시작하거나 JSON·텍스트 악보를 가져오세요.'
    : q ? `${shown.length}개 찾음` : `${charts.length}개`;
  $('chart-list').innerHTML = shown.map((c) => `
    <li class="ci">
      <a class="ci-open" href="#/c/${c.id}">
        <strong class="ci-title">${esc(c.title || '제목 없음')}</strong>
        <span class="ci-sub">${[c.artist && esc(c.artist), esc(prettyAccidentals(c.key)), esc(c.time), `${c.measures}마디`].filter(Boolean).join(' · ')}</span>
        <span class="ci-date" title="${esc(new Date(c.updatedAt).toLocaleString('ko-KR'))}">${ago(c.updatedAt)}</span>
      </a>
      <span class="ci-tools">
        <button type="button" data-dup="${c.id}">복제</button>
        <button type="button" data-del="${c.id}" class="danger">삭제</button>
      </span>
    </li>`).join('');
}
$('chart-search').addEventListener('input', renderList);
$('home-new').addEventListener('click', () => createAndOpen(newDoc()));

$('chart-list').addEventListener('click', async (e) => {
  const dup = e.target.closest('[data-dup]')?.dataset.dup;
  const del = e.target.closest('[data-del]')?.dataset.del;
  try {
    if (dup) {
      const rec = await api.getChart(dup);
      const copy = normalizeDoc(rec.doc);
      copy.meta.title = `${copy.meta.title || '제목 없음'} (사본)`;
      await api.createChart(copy);
      toast('복제했어요');
      showHome(routeSeq);
    } else if (del) {
      const c = charts.find((x) => x.id === del);
      if (!window.confirm(`"${c?.title || '제목 없음'}" 악보를 지울까요?`)) return;
      await api.deleteChart(del);
      toast('지웠어요');
      showHome(routeSeq);
    }
  } catch (err) {
    toast(err.message);
  }
});

// 로그인 전에 이 브라우저에 만들어 둔 악보를 계정으로 옮기기
const localSig = (d) => JSON.stringify(d);
function pendingLocalDoc() {
  const d = readLocalDoc();
  if (!d) return null;
  const sig = localSig(d);
  if (sig === localSig(sampleDoc()) || sig === store.get(LOCAL_HANDLED_KEY)) return null;
  return d;
}
function renderLocalBanner() {
  const d = pendingLocalDoc();
  $('local-banner').hidden = !d;
  if (d) $('local-banner-text').textContent = `이 브라우저에만 저장된 악보 "${d.meta.title || '제목 없음'}"이 있어요.`;
}
$('local-move').addEventListener('click', async () => {
  const d = pendingLocalDoc();
  if (!d) return;
  try {
    const chart = await api.createChart(d);
    store.set(LOCAL_HANDLED_KEY, localSig(d));
    go(`#/c/${chart.id}`);
  } catch (e) {
    toast(e.message);
  }
});
$('local-dismiss').addEventListener('click', () => {
  const d = readLocalDoc();
  if (d) store.set(LOCAL_HANDLED_KEY, localSig(d));
  $('local-banner').hidden = true;
});

// ───────── Google 로그인 ─────────
let gsiPromise = null;
function loadGsi() {
  gsiPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = resolve;
    s.onerror = () => { gsiPromise = null; reject(new Error('Google 로그인 버튼을 불러오지 못했어요')); };
    document.head.append(s);
  }).then(() => {
    window.google.accounts.id.initialize({
      client_id: auth.clientId,
      callback: onCredential,
      auto_select: false,
      cancel_on_tap_outside: true,
      context: 'signin',
      ux_mode: 'popup',
    });
  });
  return gsiPromise;
}

function loginMessage(msg) {
  $('login-msg').textContent = msg || '';
  $('login-msg').hidden = !msg;
}

async function renderGuest() {
  loginMessage('');
  $('gsi-btn').hidden = !auth.enabled;
  if (!auth.enabled) return;
  try {
    await loadGsi();
    $('gsi-btn').innerHTML = '';
    window.google.accounts.id.renderButton($('gsi-btn'), {
      theme: isDark() ? 'filled_black' : 'outline', size: 'large', shape: 'pill', text: 'signin_with', locale: 'ko', width: 280,
    });
  } catch (e) {
    loginMessage(e.message);
  }
}

async function onCredential(resp) {
  loginMessage('');
  try {
    auth.user = await api.login(resp.credential);
    go('#/');
  } catch (e) {
    loginMessage(e.message);
  }
}

$('btn-logout').addEventListener('click', async () => {
  try { await api.logout(); } catch { /* 쿠키만 지우면 됨 */ }
  try { window.google?.accounts.id.disableAutoSelect(); } catch { /* 무시 */ }
  auth.user = null;
  charts = [];
  go('#/');
});

// 시작
(async () => {
  const cfg = await api.config();
  auth.enabled = Boolean(cfg?.loginEnabled);
  auth.clientId = cfg?.googleClientId || null;
  if (auth.enabled) {
    try { auth.user = await api.me(); } catch { auth.user = null; }
  }
  await route();
})();
window.__compose = {
  get doc() { return doc; }, get source() { return source; }, get sel() { return sel; }, keyToString, cloneDoc, beatRect,
};
