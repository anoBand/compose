// 따라 하기 튜토리얼 (#/tutorial)
// 예시 곡에서 실제 편집기를 그대로 쓰면서 한 단계씩 안내한다.
// 단계마다 done(ctx, start)가 참이 되면 다음 단계로 넘어간다. start는 그 단계를 시작할 때의 상태.
// 튜토리얼에서 고친 악보는 어디에도 저장하지 않는다.
//
// ctx = { doc, sel, view, panelOpen, songinfoOpen, events, beatRect }   (app.js가 만들어 준다)
//   events: 버튼처럼 상태로 알 수 없는 동작의 횟수 (예: undo)
//   beatRect(s, m, beat): 악보에서 그 박이 차지하는 사각형 (target이 함수면 이걸로 강조)
// target: CSS 선택자 또는 (ctx) => 사각형
// 예시 곡(app.js SAMPLE)의 첫 구간: | C | G/B | Am7 | F . G . |

const measureAt = (ctx, s, m) => ctx.doc.sections[s]?.measures[m];
const chordAt = (ctx, s, m, beat) => measureAt(ctx, s, m)?.chords.find((c) => c.beat === beat)?.text || '';
const chordsOf = (ctx, s, m) => JSON.stringify(measureAt(ctx, s, m)?.chords || []);
const totalMeasures = (ctx) => ctx.doc.sections.reduce((n, sec) => n + sec.measures.length, 0);

/** 패널이 필요한 단계에서 패널이 닫혀 있으면 1마디를 다시 누르게 한다 */
const beat = (s, m, b) => (c) => c.beatRect(s, m, b);
const NEED_PANEL = { target: beat(0, 0, 0), text: '입력 패널이 닫혔어요. <b>1마디</b>를 다시 눌러 주세요.' };

export const STEPS = [
  {
    title: '처음 오셨네요!',
    text: '예시 곡으로 코드 악보 만드는 법을 2분 동안 직접 해 봅니다. 여기서 고친 내용은 <b>저장되지 않으니</b> 마음껏 눌러 보세요.',
    next: '시작',
    skip: '나중에 하기',
  },
  {
    title: '박 고르기',
    text: '악보의 <b>첫 마디 1박</b>(C)을 누르세요. 누른 박이 표시되고 아래에 입력 패널이 열립니다.',
    target: beat(0, 0, 0),
    done: (c) => c.panelOpen && c.sel?.s === 0 && c.sel?.m === 0,
  },
  {
    title: '코드 바꾸기',
    text: '근음 줄에서 <b>D</b>를 누르세요. 선택한 박의 코드가 D로 바뀝니다.',
    target: '#p-roots [data-root="D"]',
    needPanel: true,
    done: (c, st) => chordsOf(c, 0, 0) !== chordsOf(st, 0, 0),
  },
  {
    title: '다른 박 고르기',
    text: '한 마디에 코드를 둘 넣어 봅시다. 악보에서 <b>1마디의 3번째 박</b> 자리를 바로 누르세요.',
    target: beat(0, 0, 2),
    needPanel: true,
    done: (c) => c.sel?.s === 0 && c.sel?.m === 0 && c.sel?.beat === 2,
  },
  {
    title: '키에 맞는 코드',
    text: '이 줄은 지금 키(C)에서 자주 쓰는 코드입니다. <b>V&nbsp;G</b>를 누르면 3박에 G가 들어가요.',
    target: '#p-diatonic .dia:nth-child(5)',
    needPanel: true,
    done: (c, st) => chordAt(c, 0, 0, 2) !== chordAt(st, 0, 0, 2),
  },
  {
    title: '코드 종류 바꾸기',
    text: '종류 줄에서 <b>7</b>을 누르면 방금 넣은 코드가 G7로 바뀝니다. m, maj7, sus4도 같은 방법이에요.',
    target: '#p-qualities [data-q="7"]',
    needPanel: true,
    done: (c) => /7/.test(chordAt(c, 0, 0, 2)),
  },
  {
    title: '다음 마디',
    text: '<b>2마디의 3번째 박</b>을 누르고 근음을 하나 눌러 코드를 넣어 보세요. (데스크톱은 → 키와 A~G 키로도 됩니다)',
    target: beat(0, 1, 2),
    targetWhen: (c) => !(c.sel?.s === 0 && c.sel?.m === 1),
    altTarget: '#p-roots',
    done: (c, st) => chordsOf(c, 0, 1) !== chordsOf(st, 0, 1),
  },
  {
    title: '박 비우기',
    text: '근음 줄 맨 앞의 <b>·</b> 버튼을 누르면 선택한 박의 코드가 지워지고 앞 코드가 이어집니다. 방금 넣은 코드를 지워 보세요. (Delete 키)',
    target: '#p-hold',
    needPanel: true,
    done: (c, st) => chordsOf(c, 0, 1) !== chordsOf(st, 0, 1) && !chordAt(c, 0, 1, c.sel?.beat ?? -1),
  },
  {
    title: '마디 반복 기호',
    text: '<b>3마디</b>(Am7)를 누르고 위쪽 도구 줄의 <b>% 반복</b>을 눌러 보세요. 앞 마디를 그대로 반복한다는 뜻입니다.',
    target: '.m[data-s="0"][data-m="2"]',
    targetWhen: (c) => !(c.sel?.s === 0 && c.sel?.m === 2),
    altTarget: '#p-tools [data-act="simile"]',
    done: (c) => Boolean(measureAt(c, 0, 2)?.simile),
  },
  {
    title: '실행 취소',
    text: '실수했다면 위의 <b>↶</b>(실행 취소)를 누르세요. 방금 넣은 % 반복이 사라집니다. (Ctrl+Z)',
    target: '#btn-undo',
    done: (c, st) => c.events.undo > st.events.undo,
  },
  {
    title: '마디 추가',
    text: '위쪽 도구 줄의 <b>＋ 마디</b>를 누르면 선택한 마디 뒤에 새 마디가 생깁니다. 복제·삭제·반복 기호도 이 줄에 있어요.',
    target: '#p-tools [data-act="add"]',
    needPanel: true,
    done: (c, st) => totalMeasures(c) > totalMeasures(st),
  },
  {
    title: '조옮김',
    text: '<b>＋</b>를 누르면 반음씩 키가 올라갑니다. 원본은 그대로이고 보기만 바뀌어요. 바뀐 코드는 파란색입니다.',
    target: '#tr-up',
    done: (c) => c.view.semitones !== 0,
  },
  {
    title: '원래 키로',
    text: '조옮김 보기 중에는 편집이 잠깁니다. <b>원래 키</b>를 눌러 돌아오세요.',
    target: '#tr-reset',
    done: (c) => c.view.semitones === 0,
  },
  {
    title: '곡 정보',
    text: '<b>곡 정보</b>를 열면 제목, 아티스트, 키, 박자, 템포를 정할 수 있어요. 키를 바꾸면 위의 키 코드 줄도 따라 바뀝니다.',
    target: '#songinfo > summary',
    done: (c) => c.songinfoOpen,
  },
  {
    title: '내보내기',
    text: '다 만든 악보는 <b>내보내기</b>로 PDF·JPG·JSON 파일을 만들거나 인쇄할 수 있어요. 지금 보이는 키 그대로 나갑니다.',
    target: '#btn-export',
    next: '다음',
  },
  {
    title: '끝!',
    text: '기본 사용법은 여기까지입니다. 이제 내 악보를 만들어 보세요. 사용법은 편집기 위의 <b>?</b> 버튼으로 언제든 다시 볼 수 있어요.',
    next: '마치기',
    last: true,
  },
];

/**
 * @param {{ getCtx: () => object, onExit: () => void }} opts
 */
export function createTutorial({ getCtx, onExit }) {
  let active = false;
  let i = 0;
  let start = null; // 단계 시작 때의 상태 (마디 수 등)
  let raf = 0;
  let scrolledFor = -1;

  const card = document.createElement('div');
  card.className = 'tut-card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-live', 'polite');
  card.hidden = true;
  card.innerHTML = `
    <div class="tut-top"><span class="tut-count"></span><strong class="tut-title"></strong>
      <button type="button" class="tut-x" aria-label="따라 하기 그만두기">✕</button></div>
    <p class="tut-text"></p>
    <div class="tut-actions">
      <button type="button" class="tut-prev">이전</button>
      <button type="button" class="tut-later">나중에 하기</button>
      <button type="button" class="tut-next primary"></button>
    </div>`;
  const ring = document.createElement('div');
  ring.className = 'tut-ring';
  ring.hidden = true;
  document.body.append(ring, card);

  const q = (sel) => card.querySelector(sel);
  q('.tut-x').addEventListener('click', () => stop(true));
  q('.tut-prev').addEventListener('click', () => go(i - 1));
  q('.tut-later').addEventListener('click', () => stop(true));
  q('.tut-next').addEventListener('click', () => (STEPS[i].last ? stop(true) : go(i + 1)));

  /** 단계 시작 때의 상태 (done에서 바뀌었는지 비교) */
  function snapshot() {
    const c = getCtx();
    return { doc: JSON.parse(JSON.stringify(c.doc)), events: { ...c.events } };
  }

  function go(n) {
    i = Math.min(Math.max(n, 0), STEPS.length - 1);
    start = snapshot();
    scrolledFor = -1;
    draw();
  }

  function begin() {
    active = true;
    document.body.classList.add('in-tutorial');
    card.hidden = false;
    go(0);
    loop();
  }

  function stop(exit) {
    if (!active) return;
    active = false;
    cancelAnimationFrame(raf);
    card.hidden = true;
    ring.hidden = true;
    document.body.classList.remove('in-tutorial');
    if (exit) onExit();
  }

  /** 앱 상태가 바뀔 때마다 불린다: 조건을 채웠으면 다음 단계로 */
  function poke() {
    if (!active) return;
    const step = STEPS[i];
    if (step.done && step.done(getCtx(), start)) {
      go(i + 1);
      return;
    }
    draw();
  }

  /** 지금 단계에서 가리킬 요소와 문구 */
  function resolve() {
    const step = STEPS[i];
    const c = getCtx();
    if (step.needPanel && !c.panelOpen) return { target: NEED_PANEL.target, text: NEED_PANEL.text };
    if (step.targetWhen && !step.targetWhen(c)) return { target: step.altTarget, text: step.text };
    return { target: step.target, text: step.text };
  }

  function draw() {
    if (!active) return;
    const step = STEPS[i];
    const { text } = resolve();
    q('.tut-count').textContent = `${i + 1}/${STEPS.length}`;
    q('.tut-title').textContent = step.title;
    q('.tut-text').innerHTML = text;
    q('.tut-prev').hidden = i === 0;
    q('.tut-later').hidden = !step.skip;
    q('.tut-later').textContent = step.skip || '';
    q('.tut-next').hidden = !step.next;
    q('.tut-next').textContent = step.next || '';
    place();
  }

  const visible = (el) => el && el.getClientRects().length > 0 && !el.closest('[hidden]');

  /** 강조 테두리와 안내 카드 위치 (매 프레임: 스크롤·패널 열림에 따라 움직이므로) */
  function place() {
    const { target } = resolve();
    let r = null;
    let el = null;
    if (typeof target === 'function') {
      r = target(getCtx());
    } else if (target) {
      el = document.querySelector(target);
      if (visible(el)) r = el.getBoundingClientRect();
    }
    ring.hidden = false;
    if (!r) {
      // 가리킬 버튼이 없는 단계: 화면 전체만 살짝 어둡게
      ring.dataset.empty = '';
      ring.style.transform = `translate(${window.innerWidth / 2}px, ${window.innerHeight / 2}px)`;
      ring.style.width = '0px';
      ring.style.height = '0px';
      card.dataset.pos = 'bottom';
      return;
    }
    delete ring.dataset.empty;
    if (scrolledFor !== i) {
      scrolledFor = i;
      if (el) el.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
      else if (r.top < 60 || r.bottom > window.innerHeight * 0.55) {
        window.scrollBy({ top: r.top - window.innerHeight / 3, behavior: 'smooth' });
      }
    }
    ring.style.transform = `translate(${r.left - 4}px, ${r.top - 4}px)`;
    ring.style.width = `${r.width + 8}px`;
    ring.style.height = `${r.height + 8}px`;
    // 카드는 강조한 요소의 반대쪽 절반에 둔다 (가리지 않게)
    card.dataset.pos = r.top + r.height / 2 < window.innerHeight / 2 ? 'bottom' : 'top';
  }

  function loop() {
    if (!active) return;
    place();
    raf = requestAnimationFrame(loop);
  }

  return {
    begin,
    stop,
    poke,
    get active() { return active; },
  };
}
