// 악보 → PDF(A4) / JPG. 화면 HTML을 캡처하지 않고 캔버스에 직접 그린다
// (코드 이름 하나를 fillText 한 번으로 그려서 ♭·♯·한글이 어느 브라우저에서나 같게 나온다).
// PDF는 쪽마다 그린 이미지를 jsPDF(src/vendor/, 내보낼 때만 불러옴)로 묶는다.

import { transposeKey, transposeChord, chordToString, keyToString, prettyAccidentals } from './core/music.js';

const PAGE_W = 794; // CSS px, A4 210mm @96dpi
const PAGE_H = 1123; // 297mm
const MX = 56; // 좌우 여백
const MY = 60; // 위아래 여백
const FOOT = 30; // 쪽 번호 자리
const CONTENT_W = PAGE_W - MX * 2;
const PER_ROW = 4;

const FONT = 'system-ui, -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif';
const INK = '#111';
const MUTED = '#6b6b70';
const RED = '#c0392b';

const ROW_H = 62;
const ROW_GAP = 6;
const CHORD_PX = 20;

const font = (px, weight = 400) => `${weight} ${px}px ${FONT}`;

// ───────── 블록: 높이를 알고, (ctx, y)에 그릴 수 있는 단위 ─────────

function wrapText(ctx, text, maxW) {
  const lines = [];
  let line = '';
  for (const ch of text) {
    if (ctx.measureText(line + ch).width > maxW && line) {
      const cut = line.lastIndexOf(' ');
      if (cut > 0) { lines.push(line.slice(0, cut)); line = line.slice(cut + 1) + ch; } else { lines.push(line); line = ch; }
    } else line += ch;
  }
  if (line) lines.push(line);
  return lines;
}

function headerBlock(ctx, model, view) {
  const { meta } = model;
  const semis = view.semitones || 0;
  const toKey = transposeKey(meta.key, semis, view.altSpelling);
  ctx.font = font(30, 700);
  const titleLines = meta.title ? wrapText(ctx, meta.title, CONTENT_W) : [];
  const metaParts = [];
  const from = prettyAccidentals(keyToString(meta.key));
  if (semis) {
    metaParts.push({ t: `${from} Key ${semis > 0 ? '+' : ''}${semis} › `, c: MUTED, w: 400 });
    metaParts.push({ t: `${prettyAccidentals(keyToString(toKey))} Key`, c: INK, w: 700 });
  } else metaParts.push({ t: `${from} Key`, c: INK, w: 700 });
  const rest = [`${meta.time.beats}/${meta.time.unit}`];
  if (meta.tempo) rest.push(`${meta.tempo} BPM`);
  metaParts.push({ t: `  ·  ${rest.join('  ·  ')}`, c: MUTED, w: 400 });

  ctx.font = font(14);
  const noteLines = noteToLines(ctx, meta.note, CONTENT_W);
  const height = titleLines.length * 38 + (meta.artist ? 26 : 0) + 30 + (noteLines.length ? noteLines.length * 20 + 8 : 0) + 18;
  return {
    height,
    draw(c, y) {
      let yy = y;
      c.fillStyle = INK;
      c.font = font(30, 700);
      for (const l of titleLines) { c.fillText(l, MX, yy + 30); yy += 38; }
      if (meta.artist) {
        c.font = font(16);
        c.fillStyle = MUTED;
        c.fillText(meta.artist, MX, yy + 18);
        yy += 26;
      }
      let x = MX;
      for (const p of metaParts) {
        c.font = font(15, p.w);
        c.fillStyle = p.c;
        c.fillText(p.t, x, yy + 22);
        x += c.measureText(p.t).width;
      }
      c.font = font(14);
      c.fillStyle = MUTED;
      noteLines.forEach((l, i) => c.fillText(l, MX, yy + 30 + 22 + i * 20));
    },
  };
}

/** 메모(여러 줄) → 폭에 맞춰 나눈 줄 목록. 빈 줄은 유지 */
function noteToLines(ctx, note, maxW) {
  if (!note) return [];
  return note.split('\n').flatMap((p) => (p.trim() ? wrapText(ctx, p, maxW) : ['']));
}

/** 구간 머리: 이름 상자 + 오른쪽에 메모 */
function sectionHead(ctx, sec) {
  if (!sec.name && !sec.note) return { height: 0, draw() {} };
  ctx.font = font(13, 700);
  const noteX = MX + (sec.name ? ctx.measureText(sec.name).width + 18 + 10 : 0);
  ctx.font = font(13);
  const lines = noteToLines(ctx, sec.note, MX + CONTENT_W - noteX);
  return {
    height: Math.max(sec.name ? 22 : 0, lines.length * 18 + 2) + 12,
    draw(c, y) {
      drawSectionLabel(c, sec.name, y);
      c.font = font(13);
      c.fillStyle = MUTED;
      lines.forEach((l, i) => c.fillText(l, noteX, y + 16 + i * 18));
    },
  };
}

function drawSectionLabel(c, name, y) {
  if (!name) return;
  c.font = font(13, 700);
  const w = c.measureText(name).width + 18;
  c.strokeStyle = INK;
  c.lineWidth = 1.5;
  roundRect(c, MX + 0.75, y + 0.75, w, 22, 4);
  c.stroke();
  c.fillStyle = INK;
  c.fillText(name, MX + 9.75, y + 16.5);
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function vline(c, x, y, h, w = 1.5) {
  c.fillStyle = INK;
  c.fillRect(x - w / 2, y, w, h);
}
function doubleLine(c, x, y, h, side) {
  // side: +1이면 오른쪽으로 두 번째 줄(반복 시작), -1이면 왼쪽(반복 끝, 겹세로줄)
  vline(c, x, y, h, 1.3);
  vline(c, x + side * 3.5, y, h, 1.3);
}
function repeatDots(c, x, y, h) {
  c.fillStyle = INK;
  for (const dy of [-5.5, 5.5]) {
    c.beginPath();
    c.arc(x, y + h / 2 + 6 + dy, 2.1, 0, Math.PI * 2);
    c.fill();
  }
}

function chordLabel(ch, fromKey, toKey, moved, showOriginal) {
  if (!ch.chord) return { text: ch.text, bad: true };
  const orig = chordToString(ch.chord);
  const shown = moved ? chordToString(transposeChord(ch.chord, fromKey, toKey)) : orig;
  return {
    text: prettyAccidentals(shown),
    orig: moved && showOriginal && !ch.chord.nc ? prettyAccidentals(orig) : '',
  };
}

function drawMeasure(c, m, x, y, w, isRowFirst, isRowLast, ctxInfo) {
  const h = ROW_H;
  // 왼쪽 세로줄
  if (m.repeatStart) { doubleLine(c, x, y, h, +1); repeatDots(c, x + 9, y, h); } else vline(c, x, y, h);
  // 오른쪽 세로줄 (줄 끝, 겹세로줄, 반복 끝)
  const rx = x + w;
  if (m.repeatEnd) { doubleLine(c, rx, y, h, -1); repeatDots(c, rx - 9, y, h); } else if (m.doubleBar) doubleLine(c, rx, y, h, -1);
  else if (isRowLast) vline(c, rx, y, h);

  const padL = m.repeatStart ? 21 : 9;
  const padR = m.repeatEnd ? 20 : 8;

  // 위쪽 작은 표시: 마디 번호, 박자 변경, 반복 횟수
  c.font = font(10);
  c.fillStyle = MUTED;
  let tx = x + (m.repeatStart ? 13 : 5);
  if (isRowFirst) { c.fillText(String(m.number), tx, y + 12); tx += c.measureText(String(m.number)).width + 6; }
  if (m.timeChange) { c.font = font(11, 700); c.fillStyle = INK; c.fillText(`${m.time.beats}/${m.time.unit}`, Math.max(tx, x + 26), y + 12); }
  if (m.repeatEnd && m.repeatCount !== 2) {
    c.font = font(12, 700);
    c.fillStyle = INK;
    const t = `×${m.repeatCount}`;
    c.fillText(t, rx - padR - c.measureText(t).width, y + 13);
  }

  const innerL = x + padL;
  const innerW = w - padL - padR;
  const base = y + 44;

  if (m.error) {
    c.fillStyle = 'rgba(192,57,43,.08)';
    c.fillRect(x + 1, y, w - 1, h);
  }
  if (m.simile) {
    c.font = font(24, 600);
    c.fillStyle = MUTED;
    const tw = c.measureText('%').width;
    c.fillText('%', innerL + (innerW - tw) / 2, base);
    return;
  }
  if (!m.chords.length) return;

  const { fromKey, toKey, moved, showOriginal } = ctxInfo;
  const labels = m.chords.map((ch) => ({ ...chordLabel(ch, fromKey, toKey, moved, showOriginal), beat: ch.beat }));
  // 박 위치에 놓되, 글자가 겹치면 밀고, 그래도 넘치면 마디 전체 글자를 줄인다
  let size = CHORD_PX;
  const gap = 8;
  const layout = (px) => {
    c.font = font(px, 700);
    let cursor = innerL;
    return labels.map((l) => {
      const want = innerL + (innerW * l.beat) / m.time.beats;
      const left = Math.max(want, cursor);
      const tw = c.measureText(l.text).width;
      cursor = left + tw + gap;
      return { ...l, left, tw };
    });
  };
  let placed = layout(size);
  while (size > 11) {
    const last = placed[placed.length - 1];
    if (last.left + last.tw <= innerL + innerW) break;
    size -= 1;
    placed = layout(size);
  }
  c.font = font(size, 700);
  for (const p of placed) {
    c.fillStyle = p.bad ? RED : INK;
    c.fillText(p.text, p.left, base);
    if (p.orig) {
      c.font = font(11);
      c.fillStyle = MUTED;
      c.fillText(p.orig, p.left, base - size - 2);
      c.font = font(size, 700);
    }
  }
}

function rowBlock(row, ctxInfo) {
  const w = CONTENT_W / PER_ROW;
  return {
    height: ROW_H + ROW_GAP,
    draw(c, y) {
      row.forEach((m, i) => drawMeasure(c, m, MX + i * w, y, w, i === 0, i === row.length - 1 || i === PER_ROW - 1, ctxInfo));
    },
  };
}

/** 악보 → 블록 목록. 구간 이름은 첫 줄과 붙여서 한 블록으로 (쪽 끝에 이름만 남지 않게) */
function buildBlocks(ctx, model, view) {
  const semis = view.semitones || 0;
  const ctxInfo = {
    fromKey: model.meta.key,
    toKey: transposeKey(model.meta.key, semis, view.altSpelling),
    moved: semis !== 0,
    showOriginal: Boolean(view.showOriginal),
  };
  const blocks = [headerBlock(ctx, model, view)];
  model.sections.forEach((sec, si) => {
    const head = sectionHead(ctx, sec);
    const labelH = head.height;
    const topGap = si === 0 ? 0 : 18;
    if (!sec.rows.length) {
      blocks.push({ height: topGap + labelH, gapTop: topGap, draw: (c, y) => head.draw(c, y + topGap) });
      return;
    }
    sec.rows.forEach((row, ri) => {
      const rb = rowBlock(row, ctxInfo);
      if (ri === 0) {
        blocks.push({
          height: topGap + labelH + rb.height,
          gapTop: topGap,
          draw(c, y) {
            head.draw(c, y + topGap);
            rb.draw(c, y + topGap + labelH);
          },
        });
      } else blocks.push(rb);
    });
  });
  return blocks;
}

function paginate(blocks) {
  const usable = PAGE_H - MY * 2 - FOOT;
  const pages = [];
  let page = [];
  let used = 0;
  for (const b of blocks) {
    // 쪽 첫머리에서는 구간 사이 위 여백을 없앤다
    let shift = page.length ? 0 : -(b.gapTop || 0);
    if (page.length && used + b.height > usable) {
      pages.push(page);
      page = [];
      used = 0;
      shift = -(b.gapTop || 0);
    }
    page.push({ b, shift });
    used += b.height + shift;
  }
  if (page.length) pages.push(page);
  return pages;
}

function makeCanvas(w, h, scale) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const c = canvas.getContext('2d');
  c.scale(scale, scale);
  c.fillStyle = '#fff';
  c.fillRect(0, 0, w, h);
  c.textBaseline = 'alphabetic';
  return { canvas, c };
}

// 모바일 브라우저 캔버스 한도(약 1600만 픽셀) 안에서 최대한 선명하게
const fitScale = (w, h, max) => Math.min(max, Math.sqrt(15_000_000 / (w * h)));

function drawBlocks(c, items, y0) {
  let y = y0;
  for (const { b, shift = 0 } of items) {
    b.draw(c, y + shift);
    y += b.height + shift;
  }
  return y;
}

function download(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

const measureCtx = () => document.createElement('canvas').getContext('2d');

async function ready() {
  try { await document.fonts?.ready; } catch { /* 무시 */ }
}

/** 한 장짜리 긴 JPG */
export async function exportJpg(model, view, filename) {
  await ready();
  const blocks = buildBlocks(measureCtx(), model, view);
  const total = MY * 2 + blocks.reduce((n, b) => n + b.height, 0);
  const { canvas, c } = makeCanvas(PAGE_W, total, fitScale(PAGE_W, total, 2));
  drawBlocks(c, blocks.map((b) => ({ b })), MY);
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.92));
  if (!blob) throw new Error('이미지를 만들지 못했어요');
  download(blob, `${filename}.jpg`);
}

let jspdfPromise = null;
function loadJsPdf() {
  jspdfPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'src/vendor/jspdf.umd.min.js';
    s.onload = () => resolve(window.jspdf.jsPDF);
    s.onerror = () => { jspdfPromise = null; reject(new Error('PDF 도구를 불러오지 못했어요')); };
    document.head.append(s);
  });
  return jspdfPromise;
}

/** A4 PDF. 줄 중간에서 쪽을 나누지 않고, 쪽마다 아래에 "제목 · 1 / 3" */
export async function exportPdf(model, view, filename) {
  const [JsPDF] = await Promise.all([loadJsPdf(), ready()]);
  const pages = paginate(buildBlocks(measureCtx(), model, view));
  const title = model.meta.title || '';
  const pdf = new JsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
  if (title) pdf.setProperties({ title });
  const scale = 2.5;
  pages.forEach((items, i) => {
    const { canvas, c } = makeCanvas(PAGE_W, PAGE_H, scale);
    drawBlocks(c, items, MY);
    c.font = font(11);
    c.fillStyle = '#888';
    const foot = `${title ? `${title}  ·  ` : ''}${i + 1} / ${pages.length}`;
    c.fillText(foot, PAGE_W - MX - c.measureText(foot).width, PAGE_H - MY + 18);
    if (i > 0) pdf.addPage('a4', 'portrait');
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.9), 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
    canvas.width = 0; // 메모리 바로 반환 (iOS)
  });
  download(pdf.output('blob'), `${filename}.pdf`);
}
