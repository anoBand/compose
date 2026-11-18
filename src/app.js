import { parseChart } from './core/parser.js';
import { renderChart } from './render/chordChart.js';
import { transposeKey, keyAlternatives, keyToString, prettyAccidentals } from './core/music.js';

const STORE_KEY = 'sheet-editor:v1';

const SAMPLE = `title: 예시 곡
artist:
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
const source = $('source');
const chart = $('chart');
const errorsEl = $('errors');
const layout = document.querySelector('.layout');

const state = {
  text: SAMPLE,
  semitones: 0,
  altSpelling: false,
  showOriginal: false,
  tab: 'edit',
};

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (saved && typeof saved.text === 'string') Object.assign(state, saved);
  } catch { /* 저장소를 쓸 수 없는 환경 */ }
}

let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* 무시 */ }
  }, 300);
}

let model;
function update() {
  model = parseChart(state.text);
  chart.innerHTML = renderChart(model, state);

  // 조옮김 표시
  const s = state.semitones;
  $('tr-value').textContent = s > 0 ? `+${s}` : String(s);
  const target = transposeKey(model.meta.key, s);
  const alts = keyAlternatives(target);
  const altBtn = $('tr-alt');
  altBtn.hidden = alts.length < 2 || s === 0;
  if (alts.length >= 2) {
    const suffix = model.meta.key.minor ? 'm' : '';
    const other = state.altSpelling ? alts[0] : alts[1];
    altBtn.textContent = `${prettyAccidentals(other + suffix)}로 표기`;
    altBtn.setAttribute('aria-pressed', String(state.altSpelling));
  }
  document.title = `${model.meta.title || '제목 없음'} — 코드 악보`;

  // 오류 목록
  errorsEl.innerHTML = '';
  for (const e of model.errors) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = `${e.line}행: ${e.message}`;
    btn.addEventListener('click', () => jumpToLine(e.line));
    li.append(btn);
    errorsEl.append(li);
  }
  save();
}

function jumpToLine(line) {
  setTab('edit');
  const lines = state.text.split('\n');
  const start = lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0);
  source.focus();
  source.setSelectionRange(start, start + (lines[line - 1]?.length ?? 0));
  const lh = parseFloat(getComputedStyle(source).lineHeight) || 20;
  source.scrollTop = Math.max(0, (line - 3) * lh);
}

function setTab(tab) {
  state.tab = tab;
  layout.dataset.active = tab;
  document.querySelectorAll('.tabs [data-tab]').forEach((b) => {
    b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  });
  save();
}

function setTranspose(n) {
  state.semitones = ((n + 17) % 12 + 12) % 12 - 5; // -5..+6 범위로 정규화
  state.altSpelling = false;
  update();
}

// 편집기
source.addEventListener('input', () => { state.text = source.value; update(); });

document.querySelector('.quickbar').addEventListener('pointerdown', (e) => {
  // 버튼을 눌러도 textarea 포커스(모바일 키보드)가 유지되게
  if (e.target.closest('button')) e.preventDefault();
});
document.querySelector('.quickbar').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-ins]');
  if (!btn) return;
  const ins = btn.dataset.ins;
  const { selectionStart: a, selectionEnd: b, value } = source;
  source.value = value.slice(0, a) + ins + value.slice(b);
  const sel = btn.dataset.select;
  if (sel) {
    const at = a + ins.indexOf(sel);
    source.setSelectionRange(at, at + sel.length);
  } else {
    source.setSelectionRange(a + ins.length, a + ins.length);
  }
  source.focus();
  state.text = source.value;
  update();
});

// 보기 → 마디를 누르면 해당 줄로 이동
chart.addEventListener('dblclick', (e) => {
  const m = e.target.closest('.m');
  if (m) jumpToLine(Number(m.dataset.line));
});

// 조옮김
$('tr-up').addEventListener('click', () => setTranspose(state.semitones + 1));
$('tr-down').addEventListener('click', () => setTranspose(state.semitones - 1));
$('tr-reset').addEventListener('click', () => setTranspose(0));
$('tr-alt').addEventListener('click', () => { state.altSpelling = !state.altSpelling; update(); });
$('show-orig').addEventListener('change', (e) => { state.showOriginal = e.target.checked; update(); });

// 탭
document.querySelectorAll('.tabs [data-tab]').forEach((b) => {
  b.addEventListener('click', () => setTab(b.dataset.tab));
});

// 파일
$('btn-new').addEventListener('click', () => {
  if (!confirmDiscard()) return;
  state.text = 'title: \nkey: C\ntime: 4/4\n\n[Verse]\n| C | | | |\n';
  state.semitones = 0;
  source.value = state.text;
  update();
  setTab('edit');
});

function confirmDiscard() {
  return window.confirm('지금 악보를 지우고 새로 시작할까요? (먼저 저장하려면 취소)');
}

$('btn-save').addEventListener('click', () => {
  const name = (model.meta.title || 'chart').replace(/[\\/:*?"<>|]/g, '_');
  const blob = new Blob([state.text], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$('file-open').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  state.text = await file.text();
  state.semitones = 0;
  source.value = state.text;
  e.target.value = '';
  update();
});

$('btn-print').addEventListener('click', () => window.print());

// 시작
load();
source.value = state.text;
$('show-orig').checked = state.showOriginal;
setTab(state.tab);
update();

// 콘솔 디버그용
window.__sheet = { get model() { return model; }, keyToString };
