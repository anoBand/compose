// 악보 모델 → 코드 차트 HTML

import {
  transposeKey, transposeChord, chordToString, keyToString, prettyAccidentals,
} from '../core/music.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

const pretty = (s) => esc(prettyAccidentals(s));

/**
 * @param model parseChart() 결과
 * @param view  { semitones, altSpelling, showOriginal }
 */
export function renderChart(model, view = {}) {
  const semitones = view.semitones ?? 0;
  const fromKey = model.meta.key;
  const toKey = transposeKey(fromKey, semitones, view.altSpelling);
  const moved = semitones !== 0;

  const keyLine = moved
    ? `<span class="key-orig">${pretty(keyToString(fromKey))} Key</span>
       <span class="key-shift">${semitones > 0 ? '+' : ''}${semitones}</span>
       <span class="key-arrow">›</span>
       <span class="key-new">${pretty(keyToString(toKey))} Key</span>`
    : `<span class="key-orig">${pretty(keyToString(fromKey))} Key</span>`;

  const { beats, unit } = model.meta.time;
  const metaBits = [`${beats}/${unit}`];
  if (model.meta.tempo) metaBits.push(`${model.meta.tempo} BPM`);

  const head = `
    <header class="chart-head">
      ${model.meta.title ? `<h1>${esc(model.meta.title)}</h1>` : ''}
      ${model.meta.artist ? `<p class="artist">${esc(model.meta.artist)}</p>` : ''}
      <p class="chart-meta"><span class="key${moved ? ' moved' : ''}">${keyLine}</span>
        <span class="dot">·</span><span>${metaBits.join(' · ')}</span></p>
    </header>`;

  const chordHtml = (c) => {
    if (!c.chord) return `<span class="chord bad" style="--dur:${c.duration}">${esc(c.text)}</span>`;
    const orig = chordToString(c.chord);
    const shown = moved ? chordToString(transposeChord(c.chord, fromKey, toKey)) : orig;
    const origTag = moved && view.showOriginal && !c.chord.nc
      ? `<small class="orig">${pretty(orig)}</small>` : '';
    return `<span class="chord${moved && !c.chord.nc ? ' chg' : ''}" style="--dur:${c.duration}">${origTag}${pretty(shown)}</span>`;
  };

  const measureHtml = (m, i) => {
    const cls = ['m'];
    if (m.repeatStart) cls.push('rs');
    if (m.repeatEnd) cls.push('re');
    if (m.doubleBar) cls.push('dbl');
    if (m.error) cls.push('err');
    const body = m.simile
      ? `<span class="simile">%</span>`
      : m.chords.length ? m.chords.map(chordHtml).join('')
        : `<span class="chord bad">${esc(m.raw || '?')}</span>`;
    const extras = [
      i === 0 ? `<span class="mnum">${m.number}</span>` : '',
      m.timeChange ? `<span class="tsig">${m.time.beats}/${m.time.unit}</span>` : '',
      m.repeatEnd && m.repeatCount !== 2 ? `<span class="rcount">×${m.repeatCount}</span>` : '',
    ].join('');
    const title = m.error ? ` title="${esc(m.error)}"` : '';
    return `<div class="${cls.join(' ')}" data-line="${m.line}" style="--beats:${m.time.beats}"${title}>${extras}<div class="beats">${body}</div></div>`;
  };

  const sections = model.sections.map((s) => `
    <section class="sec">
      ${s.name ? `<h2 class="sec-name">${esc(s.name)}</h2>` : ''}
      ${s.rows.map((row) => `<div class="row">${row.map(measureHtml).join('')}</div>`).join('')}
    </section>`).join('');

  const empty = model.sections.length === 0
    ? '<p class="empty">마디를 입력하면 여기에 악보가 표시됩니다.</p>' : '';

  return head + sections + empty;
}
