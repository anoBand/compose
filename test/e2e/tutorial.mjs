// 따라 하기 튜토리얼 E2E: 모든 단계를 실제로 눌러서 끝까지 가는지, 연습 악보가 저장되지 않는지
// 실행: node test/e2e/tutorial.mjs (playwright 필요, run.mjs와 같은 방식)
import { chromium, devices } from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { start } from './serve.mjs';

const OUT = process.env.E2E_OUT || new URL('./out-tutorial', import.meta.url).pathname;
await fs.rm(OUT, { recursive: true, force: true });
await fs.mkdir(OUT, { recursive: true });
await start(8091, false); // 서버 없는 모드 (로그인 없음)
const BASE = 'http://127.0.0.1:8091/';

const errors = [];
const browser = await chromium.launch();

async function run(name, opts, theme = 'light') {
  const ctx = await browser.newContext({ ...opts, colorScheme: theme });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name} pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${name} console: ${m.text()}`); });

  // 먼저 내 로컬 악보를 하나 만들어 둔다 (튜토리얼이 덮어쓰지 않는지 확인용)
  await page.goto(`${BASE}#/local`);
  await page.locator('.m[data-s="0"][data-m="0"]').click();
  await page.locator('#p-roots [data-root="E"]').click();
  await page.waitForTimeout(400);
  const before = await page.evaluate(() => localStorage.getItem('compose:doc:v1'));
  assert.ok(before);

  await page.locator('#btn-help').click();
  await page.locator('.tut-card').waitFor();
  const title = () => page.locator('.tut-title').textContent();
  const count = () => page.locator('.tut-count').textContent();
  const shot = async (n) => page.screenshot({ path: `${OUT}/${name}-${n}.png` });
  const tap = async (sel) => {
    const el = page.locator(sel).first();
    await el.scrollIntoViewIfNeeded();
    await el.click();
    await page.waitForTimeout(120);
  };
  const expectStep = async (n, t) => {
    await page.waitForFunction((x) => document.querySelector('.tut-count').textContent.startsWith(`${x}/`), n, { timeout: 3000 });
    assert.equal(await title(), t, `${name}: ${n}단계 제목`);
  };

  await expectStep(1, '따라 하기'); await shot('01');
  await tap('.tut-next');
  await expectStep(2, '마디 고르기');
  assert.equal(await page.locator('.tut-ring').isVisible(), true); await shot('02');
  await tap('.m[data-s="0"][data-m="0"]');
  await expectStep(3, '코드 넣기'); await shot('03');
  // 패널을 닫으면 다시 열라는 안내
  await tap('#p-close');
  assert.match(await page.locator('.tut-text').textContent(), /패널이 닫혔어요/);
  await shot('03b-closed');
  await tap('.m[data-s="0"][data-m="0"]');
  await tap('#p-roots [data-root="C"]');
  await expectStep(4, '박 고르기'); await shot('04');
  await tap('#p-beats .beat:nth-child(3)');
  await expectStep(5, '키에 맞는 코드'); await shot('05');
  await tap('#p-diatonic .dia:nth-child(5)');
  await expectStep(6, '코드 종류 바꾸기'); await shot('06');
  await tap('#p-qualities [data-q="7"]');
  await expectStep(7, '다음 마디'); await shot('07');
  await tap('.m[data-s="0"][data-m="1"]');
  await tap('#p-roots [data-root="A"]');
  await expectStep(8, '마디 반복 기호');
  await tap('.m[data-s="0"][data-m="2"]'); await shot('08');
  await tap('#p-tools [data-act="simile"]');
  await expectStep(9, '실행 취소'); await shot('09');
  await tap('#btn-undo');
  await expectStep(10, '마디 추가'); await shot('10');
  await tap('#p-tools [data-act="add"]');
  await expectStep(11, '조옮김'); await shot('11');
  await tap('#tr-up');
  await expectStep(12, '원래 키로'); await shot('12');
  await tap('#tr-reset');
  await expectStep(13, '곡 정보'); await shot('13');
  await tap('#songinfo > summary');
  await expectStep(14, '내보내기'); await shot('14');
  await tap('.tut-next');
  await expectStep(15, '끝!'); await shot('15');

  const doc = await page.evaluate(() => window.__compose.doc);
  const m0 = doc.sections[0].measures[0].chords.map((c) => c.text).join(' ');
  assert.equal(m0, 'C G7');
  assert.equal(doc.sections[0].measures[2].simile, false);
  assert.equal(doc.sections[0].measures.length, 5);

  await tap('.tut-next');
  await page.waitForFunction(() => location.hash === '#/local');
  assert.equal(await page.locator('.tut-card').isHidden(), true);
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => localStorage.getItem('compose:doc:v1'));
  assert.equal(after, before, '튜토리얼이 내 로컬 악보를 바꾸면 안 됨');
  const mine = await page.evaluate(() => window.__compose.doc.sections[0].measures[0].chords[0]?.text);
  assert.equal(mine, 'E');
  await shot('16-back');

  // ✕로 중간에 그만두기
  await page.goto(`${BASE}#/tutorial`);
  await page.locator('.tut-card').waitFor();
  await tap('.tut-x');
  await page.waitForFunction(() => location.hash !== '#/tutorial');
  assert.equal(await page.locator('.tut-card').isHidden(), true);
  await ctx.close();
  console.log(`- ${name}: 15단계 통과`);
}

await run('desktop', { viewport: { width: 1280, height: 860 } });
await run('mobile', { ...devices['iPhone 13'] });
await run('mobile-dark', { ...devices['Pixel 7'] }, 'dark');
await browser.close();
const real = errors.filter((e) => !/api\/config|Failed to load resource.*404/.test(e));
if (real.length) { console.error(real.join('\n')); process.exit(1); }
console.log('OK');
process.exit(0);
