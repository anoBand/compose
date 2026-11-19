// 따라 하기 튜토리얼 E2E
//  - 게스트: 처음 편집기를 열면 예시 곡으로 자동 시작, 15단계를 실제로 눌러 끝까지, 연습 내용은 저장 안 됨, 다시 안 뜸
//  - "나중에 하기"로 건너뛰기, ? 버튼으로 다시 보기, ✕로 그만두기
//  - 로그인: 계정으로 처음 로그인하면 자동 시작, 건너뛰면 계정에 기록 (다른 브라우저에서도 다시 안 뜸)
// 실행: node test/e2e/tutorial.mjs (playwright 필요, run.mjs와 같은 방식)
import { chromium, devices } from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { start } from './serve.mjs';

const OUT = process.env.E2E_OUT || new URL('./out-tutorial', import.meta.url).pathname;
await fs.rm(OUT, { recursive: true, force: true });
await fs.mkdir(OUT, { recursive: true });
await start(8091, false); // 서버 없는 모드 (정적 호스팅과 같음)
await start(8092, true); // 로그인 있는 모드
const NOAPI = 'http://127.0.0.1:8091/';
const LOGIN = 'http://127.0.0.1:8092/';

const FAKE_GSI = `window.google={accounts:{id:{
  initialize(o){window.__gsi=o},
  renderButton(el){const b=document.createElement('button');b.id='fake-google';b.type='button';b.textContent='Google 계정으로 로그인 (테스트)';
    b.onclick=async()=>{const t=await (await fetch('/__token?'+(window.__tokenQuery||''))).text();window.__gsi.callback({credential:t})};el.append(b)},
  disableAutoSelect(){}
}}};`;

const errors = [];
const browser = await chromium.launch();
const TUT_KEY = 'compose:tutorial-done:v1';

async function newPage(name, opts = {}, theme = 'light') {
  const ctx = await browser.newContext({ ...opts, colorScheme: theme });
  await ctx.route('https://accounts.google.com/gsi/client', (r) => r.fulfill({ contentType: 'application/javascript', body: FAKE_GSI }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name} pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${name} console: ${m.text()}`); });
  return { ctx, page };
}

const helpers = (page, name) => ({
  shot: (n) => page.screenshot({ path: `${OUT}/${name}-${n}.png` }),
  async tap(sel) {
    const el = page.locator(sel).first();
    await el.scrollIntoViewIfNeeded();
    await el.click();
    await page.waitForTimeout(120);
  },
  async expectStep(n, t) {
    await page.waitForFunction((x) => document.querySelector('.tut-count')?.textContent.startsWith(`${x}/`)
      && !document.querySelector('.tut-card').hidden, n, { timeout: 4000 });
    assert.equal(await page.locator('.tut-title').textContent(), t, `${name}: ${n}단계 제목`);
  },
  hash: () => page.evaluate(() => location.hash),
  waitHash: (h) => page.waitForFunction((x) => location.hash === x, h, { timeout: 4000 }),
});

// ───────── 게스트: 자동 시작 → 15단계 끝까지 ─────────
async function guestFull(name, opts, theme) {
  const { ctx, page } = await newPage(name, opts, theme);
  const { shot, tap, expectStep, waitHash } = helpers(page, name);

  await page.goto(NOAPI);
  await waitHash('#/tutorial');
  await expectStep(1, '처음 오셨네요!');
  assert.equal(await page.locator('.chart-head h1').textContent(), '예시 곡');
  await shot('01');
  await tap('.tut-next');
  await expectStep(2, '마디 고르기'); await shot('02');
  assert.equal(await page.locator('.tut-ring').isVisible(), true);
  await tap('.m[data-s="0"][data-m="0"]');
  await expectStep(3, '코드 바꾸기'); await shot('03');
  await tap('#p-close'); // 패널을 닫으면 다시 열라는 안내
  assert.match(await page.locator('.tut-text').textContent(), /패널이 닫혔어요/);
  await tap('.m[data-s="0"][data-m="0"]');
  await tap('#p-roots [data-root="D"]');
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
  assert.equal(doc.sections[0].measures[0].chords.map((c) => c.text).join(' '), 'D G7');
  assert.equal(doc.sections[0].measures[1].chords[0].text, 'A');
  assert.equal(doc.sections[0].measures[2].simile, false);

  await tap('.tut-next');
  await waitHash('#/local');
  assert.equal(await page.locator('.tut-card').isHidden(), true);
  await page.waitForTimeout(400);
  // 튜토리얼에서 고친 내용은 저장되지 않고, 편집기는 예시 곡 그대로
  assert.equal(await page.evaluate(() => window.__compose.doc.sections[0].measures[0].chords[0].text), 'C');
  assert.equal(await page.evaluate((k) => localStorage.getItem(k), TUT_KEY), '1');
  await shot('16-after');

  // 다시 열어도 자동으로 뜨지 않음
  await page.reload();
  await page.locator('#editor').waitFor();
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => location.hash), '#/local');
  assert.equal(await page.locator('.tut-card').isHidden(), true);

  // 내 악보를 고친 뒤 ?로 다시 보고 ✕로 나가도 내 악보는 그대로
  await tap('.m[data-s="0"][data-m="0"]');
  await tap('#p-roots [data-root="E"]');
  await page.waitForTimeout(400);
  const before = await page.evaluate(() => localStorage.getItem('compose:doc:v1'));
  await tap('#btn-help');
  await expectStep(1, '처음 오셨네요!');
  assert.equal(await page.evaluate(() => window.__compose.doc.sections[0].measures[0].chords[0].text), 'C'); // 튜토리얼은 예시 곡
  await tap('.tut-x');
  await waitHash('#/local');
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => localStorage.getItem('compose:doc:v1')), before);
  assert.equal(await page.evaluate(() => window.__compose.doc.sections[0].measures[0].chords[0].text), 'E');
  await ctx.close();
  console.log(`- ${name}: 게스트 자동 시작, 15단계, 저장 안 됨, 다시 안 뜸, ?·✕`);
}

await guestFull('desktop', { viewport: { width: 1280, height: 860 } });
await guestFull('mobile', { ...devices['iPhone 13'] });
await guestFull('mobile-dark', { ...devices['Pixel 7'] }, 'dark');

// ───────── 게스트: "나중에 하기" ─────────
{
  const { ctx, page } = await newPage('later', { viewport: { width: 1280, height: 860 } });
  const { tap, expectStep, waitHash } = helpers(page, 'later');
  await page.goto(NOAPI);
  await expectStep(1, '처음 오셨네요!');
  await tap('.tut-later');
  await waitHash('#/local');
  assert.equal(await page.locator('.tut-card').isHidden(), true);
  assert.equal(await page.evaluate((k) => localStorage.getItem(k), TUT_KEY), '1');
  // 뒤로 가기로 튜토리얼이 다시 열리지 않음 (자동 시작은 방문 기록을 남기지 않는다)
  await ctx.close();
  console.log('- 나중에 하기');
}

// ───────── 로그인 서버: 게스트는 "로그인 없이 쓰기"로 들어갈 때 시작 ─────────
{
  const { ctx, page } = await newPage('login-guest', { viewport: { width: 1280, height: 860 } });
  const { tap, expectStep } = helpers(page, 'login-guest');
  await page.goto(LOGIN);
  await page.locator('#home-guest').waitFor();
  assert.equal(await page.locator('.tut-card').isHidden(), true); // 로그인 화면에서는 아직
  await tap('#btn-local');
  await expectStep(1, '처음 오셨네요!');
  await ctx.close();
  console.log('- 로그인 서버 게스트: 로그인 없이 쓰기 → 자동 시작');
}

// ───────── 첫 로그인: 자동 시작, 건너뛰면 계정에 기록 ─────────
{
  const { ctx, page } = await newPage('first-login', { viewport: { width: 1280, height: 860 } });
  const { tap, expectStep, waitHash, shot } = helpers(page, 'first-login');
  await page.goto(LOGIN);
  await page.evaluate(() => { window.__tokenQuery = 'email=new@example.com&sub=999'; });
  await page.locator('#fake-google').click();
  await expectStep(1, '처음 오셨네요!');
  assert.equal(await page.locator('.chart-head h1').textContent(), '예시 곡');
  await shot('01');
  await tap('.tut-next');
  await expectStep(2, '마디 고르기');
  await tap('.tut-x');
  await waitHash('#/');
  await page.locator('#home-user').waitFor();
  const me = await page.evaluate(async () => (await (await fetch('api/me')).json()).user);
  assert.equal(me.tutorialDone, true);
  // 튜토리얼에서 서버 악보가 생기지 않음
  assert.equal(await page.locator('#chart-list li').count(), 0);
  await page.reload();
  await page.locator('#home-user').waitFor();
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.tut-card').isHidden(), true);
  await ctx.close();

  // 다른 브라우저(기록 없음)에서 같은 계정으로 로그인해도 다시 안 뜸
  const other = await newPage('first-login-2', { viewport: { width: 1280, height: 860 } });
  await other.page.goto(LOGIN);
  await other.page.evaluate(() => { window.__tokenQuery = 'email=new@example.com&sub=999'; });
  await other.page.locator('#fake-google').click();
  await other.page.locator('#home-user').waitFor();
  await other.page.waitForTimeout(400);
  assert.equal(await other.page.locator('.tut-card').isHidden(), true);
  await other.ctx.close();

  // 이 브라우저에서 게스트로 이미 봤으면 첫 로그인 때 다시 띄우지 않고 계정에만 기록
  const seen = await newPage('first-login-seen', { viewport: { width: 1280, height: 860 } });
  await seen.ctx.addInitScript((k) => localStorage.setItem(k, '1'), TUT_KEY);
  await seen.page.goto(LOGIN);
  await seen.page.evaluate(() => { window.__tokenQuery = 'email=third@example.com&sub=333'; });
  await seen.page.locator('#fake-google').click();
  await seen.page.locator('#home-user').waitFor();
  await seen.page.waitForTimeout(400);
  assert.equal(await seen.page.locator('.tut-card').isHidden(), true);
  const me3 = await seen.page.evaluate(async () => (await (await fetch('api/me')).json()).user);
  assert.equal(me3.tutorialDone, true);
  await seen.ctx.close();
  console.log('- 첫 로그인: 자동 시작, ✕로 건너뛰면 계정에 기록, 다른 브라우저에서도 안 뜸, 게스트로 본 브라우저는 생략');
}

await browser.close();
const real = errors.filter((e) => !/api\/config|Failed to load resource.*404/.test(e));
if (real.length) { console.error(real.join('\n')); process.exit(1); }
console.log('OK');
process.exit(0);
