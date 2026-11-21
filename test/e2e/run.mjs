// E2E (실행 예: playwright 이미지에서 npm i --no-save playwright 후 node test/e2e/run.mjs)
// 로그인 → 목록 → 편집·자동 저장 → 충돌 → 복제·삭제 → 내보내기(PDF/JPG) → 로그아웃 → 로컬 모드 → 서버 없는 모드
import { chromium, devices } from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { start } from './serve.mjs';

const OUT = process.env.E2E_OUT || new URL('./out', import.meta.url).pathname;
await fs.rm(OUT, { recursive: true, force: true });
await fs.mkdir(OUT, { recursive: true });
await start(8080, true);
await start(8090, false);
const BASE = 'http://127.0.0.1:8080/';

const FAKE_GSI = `window.google={accounts:{id:{
  initialize(o){window.__gsi=o},
  renderButton(el){const b=document.createElement('button');b.id='fake-google';b.type='button';b.textContent='Google 계정으로 로그인 (테스트)';
    b.onclick=async()=>{const t=await (await fetch('/__token?'+(window.__tokenQuery||''))).text();window.__gsi.callback({credential:t})};el.append(b)},
  disableAutoSelect(){}
}}};`;

const errors = [];
const browser = await chromium.launch();
async function newPage(opts = {}) {
  const ctx = await browser.newContext({ acceptDownloads: true, ...opts });
  // 첫 방문 튜토리얼은 test/e2e/tutorial.mjs에서 따로 확인한다
  await ctx.addInitScript(() => { try { localStorage.setItem('compose:tutorial-done:v1', '1'); } catch { /* 무시 */ } });
  await ctx.route('https://accounts.google.com/gsi/client', (r) => r.fulfill({ contentType: 'application/javascript', body: FAKE_GSI }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  return { ctx, page };
}
const shot = (page, name, full = false) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
const savedState = (page) => page.locator('#save-state').getAttribute('data-state');
/** 편집기 머리말(입력 칸)의 제목이 t가 될 때까지 */
async function expectTitle(page, t) {
  await page.waitForFunction((x) => !document.querySelector('#head-edit').hidden && document.querySelector('#f-title').value === x, t, { timeout: 8000 });
}

async function waitSaved(page) {
  await page.waitForFunction(() => document.querySelector('#save-state').dataset.state === 'saved', null, { timeout: 8000 });
}
const step = (s) => console.log(`- ${s}`);

const LONG = ['title: 긴 노래 테스트', 'artist: 테스트 밴드', 'key: Eb', 'time: 4/4', 'tempo: 120', ''];
for (let i = 1; i <= 9; i++) {
  LONG.push(`[Part ${i}]`, '|: Eb | Cm7 | Abmaj7 | Bb7sus4 . Bb7 . |', '| Gm7 | C7 | Fm7 . Bb7/D . | Eb :|x3', '| Ab/C | Bbm7 . Eb7 . | Abmaj7 | Db9 ||', '');
}

// ───────── 데스크톱 ─────────
const { ctx, page } = await newPage({ viewport: { width: 1280, height: 860 } });
await page.goto(BASE);
await page.locator('#home-guest').waitFor();
step('로그인 전 홈');
await shot(page, '01-guest');
assert.equal(await page.locator('#home-guest a[href="#/tutorial"]').count(), 0, '로그인 화면에 따라 하기 링크 없음');

// 테마: 기기 설정(라이트) → 다크 → 새로고침해도 유지 → 라이트로 되돌림
const themeOf = () => page.evaluate(() => [document.documentElement.dataset.theme || '', getComputedStyle(document.body).backgroundColor]);
assert.equal(await page.locator('#btn-theme').isVisible(), true, '로그인 화면에 테마 버튼');
const [, lightBg] = await themeOf();
await page.click('#btn-theme');
const [t1, darkBg] = await themeOf();
assert.equal(t1, 'dark');
assert.notEqual(darkBg, lightBg, '다크 모드 배경색');
await page.reload();
await page.locator('#home-guest').waitFor();
assert.equal((await themeOf())[0], 'dark', '새로고침 뒤에도 다크');
assert.equal(await page.locator('#btn-theme').getAttribute('aria-label'), '라이트 모드로');
await shot(page, '01-guest-dark');
await page.click('#btn-theme');
assert.deepEqual(await themeOf(), ['light', lightBg]);
step('로그인 화면: 따라 하기 링크 없음, 테마 버튼(다크 ↔ 라이트, 새로고침 뒤 유지)');

await page.click('#fake-google');
await page.locator('#home-user').waitFor();
await page.waitForFunction(() => document.querySelector('#list-state').textContent.includes('아직'));
assert.equal(await page.locator('#acct-name').textContent(), '테스터');
assert.equal(await page.locator('#btn-theme').isVisible(), true, '내 악보 화면에 테마 버튼');
step('로그인 → 빈 목록');
await shot(page, '02-empty-list');

await page.click('#home-new');
await page.waitForURL(/#\/c\/[a-f0-9]{24}$/);
const chartId = page.url().split('/').pop();
await page.locator('#editor').waitFor();
await expectTitle(page, '');
assert.equal(await page.locator('#btn-theme').isHidden(), true, '편집기에는 테마 버튼 없음');
assert.equal(await page.evaluate(() => document.activeElement.id), 'f-title'); // 빈 새 악보는 제목 칸으로
await page.fill('#f-title', '첫 번째 곡');
await page.locator('#f-title').press('Tab');
await page.click('.m[data-s="0"][data-m="0"]', { position: { x: 14, y: 30 } }); // 1박
await page.click('#p-diatonic .dia[data-step="0"]');
await page.keyboard.press('Space');
await page.keyboard.press('Space');
await page.keyboard.press('g');
await page.click('#p-bass');
await page.click('#p-roots button[data-root="B"]');
await waitSaved(page);
step(`새 악보 만들고 편집 → 자동 저장 (${chartId})`);

// 곡 메모·구간 메모 (구간 이름 상자를 누르면 구간 메모 칸)
await page.fill('#f-note', 'Intro → Verse → Chorus');
await page.click('.sec[data-sec="0"] .sec-name');
await page.keyboard.type('조용히 시작');
await page.keyboard.press('Escape');
await waitSaved(page);
const noted = await (await page.request.get(`${BASE}api/charts/${chartId}`)).json();
assert.equal(noted.doc.meta.note, 'Intro → Verse → Chorus');
assert.equal(noted.doc.sections[0].note, '조용히 시작');
step('곡 메모·구간 메모 → 서버 저장');
await shot(page, '03-editor');

// 텍스트 가져오기로 긴 악보 만들기 (지금 악보 바꾸기)
await page.click('#btn-import');
await page.fill('#import-text', LONG.join('\n'));
await page.click('#import-go');
await waitSaved(page);
assert.equal(await page.locator('.m').count(), 9 * 12);
step('가져오기로 긴 악보 → 저장');

// 새로고침해도 로그인·내용 유지
await page.reload();
await expectTitle(page, '긴 노래 테스트');
assert.equal(await savedState(page), 'saved');
step('새로고침 → 로그인·내용 유지');

// ───── 내보내기 ─────
await page.click('#tr-up');
await page.click('#tr-up');
await page.click('#btn-export');
assert.match(await page.locator('#export-note').textContent(), /F 키/);
await shot(page, '04-export-dialog');
let dl = page.waitForEvent('download');
await page.click('[data-fmt="pdf"]');
let d = await dl;
assert.equal(d.suggestedFilename(), '긴 노래 테스트 (F).pdf');
await d.saveAs(`${OUT}/export.pdf`);
const pdf = await fs.readFile(`${OUT}/export.pdf`);
const pages = (pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length;
assert.ok(pages >= 2, `PDF 쪽 수 ${pages}`);
assert.equal(await page.locator('.export-sheet').count(), 0);
step(`PDF 내보내기 (${pages}쪽, ${Math.round(pdf.length / 1024)}KB)`);

await page.click('#btn-export');
dl = page.waitForEvent('download');
await page.click('[data-fmt="jpg"]');
d = await dl;
assert.equal(d.suggestedFilename(), '긴 노래 테스트 (F).jpg');
await d.saveAs(`${OUT}/export.jpg`);
const jpg = await fs.readFile(`${OUT}/export.jpg`);
assert.equal(jpg[0], 0xff); assert.equal(jpg[1], 0xd8);
step(`JPG 내보내기 (${Math.round(jpg.length / 1024)}KB)`);

await page.click('#btn-export');
dl = page.waitForEvent('download');
await page.click('[data-fmt="json"]');
d = await dl;
const json = JSON.parse(await fs.readFile(await d.path(), 'utf8'));
assert.equal(json.meta.key, 'Eb');
step('JSON 내보내기 (원래 키 Eb)');
await page.click('#tr-reset');

// ───── 다른 기기에서 동시에 고치면 충돌 처리 ─────
const other = await newPage({ viewport: { width: 1000, height: 800 } });
await other.page.goto(BASE);
await other.page.click('#fake-google');
await other.page.locator('#home-user').waitFor();
await other.page.goto(`${BASE}#/c/${chartId}`);
await expectTitle(other.page, '긴 노래 테스트');
await other.page.fill('#f-note', '다른 기기');
await other.page.locator('#f-note').press('Tab');
await waitSaved(other.page);

let dialogMsg = '';
page.once('dialog', (dg) => { dialogMsg = dg.message(); dg.dismiss(); }); // 취소 = 서버 내용 불러오기
await page.fill('#f-title', '이 기기 제목');
await page.locator('#f-title').press('Tab');
await page.waitForFunction(() => document.querySelector('#f-note').value === '다른 기기', null, { timeout: 8000 });
assert.match(dialogMsg, /먼저 바뀌었어요/);
await waitSaved(page);
step('충돌 → 다른 기기 내용 불러오기');

page.once('dialog', (dg) => dg.accept()); // 이번엔 덮어쓰기
await other.page.fill('#f-tempo', '99');
await other.page.locator('#f-tempo').press('Tab');
await waitSaved(other.page);
await page.fill('#f-title', '덮어쓴 제목');
await page.locator('#f-title').press('Tab');
await page.waitForTimeout(2500);
await waitSaved(page);
const check = await (await other.page.request.get(`${BASE}api/charts/${chartId}`)).json();
assert.equal(check.doc.meta.title, '덮어쓴 제목');
step('충돌 → 덮어쓰기');
await other.ctx.close();

// ───── 목록: 복제·검색·삭제 ─────
await page.click('#btn-home');
await page.waitForURL(/#\/$/);
await page.locator('.ci').first().waitFor();
await page.click('.ci [data-dup]');
await page.waitForFunction(() => document.querySelectorAll('.ci').length === 2);
assert.match(await page.locator('.ci-title').first().textContent(), /\(사본\)/);
await page.fill('#chart-search', '사본');
assert.equal(await page.locator('.ci').count(), 1);
await page.fill('#chart-search', '');
await shot(page, '05-list');
page.once('dialog', (dg) => dg.accept());
await page.click('.ci:first-child [data-del]');
await page.waitForFunction(() => document.querySelectorAll('.ci').length === 1);
step('목록: 복제·검색·삭제');

// ───── 로그아웃 → 로그인 없이 쓰기 → 다시 로그인하면 옮기기 배너 ─────
await page.click('#btn-logout');
await page.locator('#home-guest').waitFor();
assert.equal((await page.request.get(`${BASE}api/charts`)).status(), 401);
await page.click('#btn-local');
await page.locator('#editor').waitFor();
assert.equal(await page.locator('#save-state').isHidden(), true);
await page.click('#btn-new');
page.once('dialog', (dg) => dg.accept());
await page.click('#btn-new');
await page.fill('#f-title', '로컬 곡');
await page.locator('#f-title').press('Tab');
await page.waitForTimeout(400);
step('로그아웃 → 로그인 없이 쓰기');
await page.click('#btn-home');
await page.click('#fake-google');
await page.locator('#local-banner').waitFor();
assert.match(await page.locator('#local-banner-text').textContent(), /로컬 곡/);
await shot(page, '06-local-banner');
await page.click('#local-move');
await page.waitForURL(/#\/c\//);
await expectTitle(page, '로컬 곡');
await page.click('#btn-home');
await page.locator('.ci').nth(1).waitFor();
assert.equal(await page.locator('#local-banner').isHidden(), true);
step('다시 로그인 → 로컬 악보 옮기기');

// 다른 사용자는 내 악보를 못 본다
const stranger = await newPage();
await stranger.page.goto(BASE);
await stranger.page.evaluate(() => { window.__tokenQuery = 'email=b@example.com&sub=222'; });
await stranger.page.click('#fake-google');
await stranger.page.waitForFunction(() => document.querySelector('#list-state').textContent.includes('아직'));
await stranger.page.goto(`${BASE}#/c/${chartId}`);
await stranger.page.waitForURL(/#\/$/);
step('다른 사용자: 목록 비어 있음, 남의 악보 주소는 홈으로');
await stranger.ctx.close();

// 다크 모드에서도 내보내기는 흰 종이
const dark = await newPage({ colorScheme: 'dark', viewport: { width: 1280, height: 860 } });
await dark.page.goto(`${BASE}#/local`);
await expectTitle(dark.page, '예시 곡');
await shot(dark.page, '07-dark-editor');
await dark.page.click('#btn-export');
dl = dark.page.waitForEvent('download');
await dark.page.click('[data-fmt="jpg"]');
await (await dl).saveAs(`${OUT}/export-dark.jpg`);
step('다크 모드 JPG');
await dark.ctx.close();

// ───────── 모바일 ─────────
const mob = await newPage({ ...devices['iPhone 13'] });
await mob.page.goto(BASE);
await mob.page.locator('#home-guest').waitFor();
await shot(mob.page, '10-m-guest', true);
await mob.page.click('#fake-google');
await mob.page.locator('#home-user').waitFor();
await mob.page.waitForFunction(() => document.querySelector('#list-state').textContent !== '불러오는 중…');
await mob.page.click('#home-import');
await mob.page.fill('#import-text', LONG.join('\n'));
await mob.page.click('#import-go');
await mob.page.waitForURL(/#\/c\//);
await expectTitle(mob.page, '긴 노래 테스트');
await waitSaved(mob.page);
await shot(mob.page, '11-m-editor');
await mob.page.click('.m[data-s="0"][data-m="1"]');
await shot(mob.page, '12-m-panel');
await mob.page.click('#p-close');
await mob.page.mouse.wheel(0, 1500);
await mob.page.click('#btn-export');
dl = mob.page.waitForEvent('download');
await mob.page.click('[data-fmt="pdf"]');
await (await dl).saveAs(`${OUT}/export-mobile.pdf`);
await mob.page.click('#btn-home');
await mob.page.locator('.ci').first().waitFor();
await shot(mob.page, '13-m-list', true);
const overflow = await mob.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
assert.equal(overflow, false, '모바일 가로 스크롤');
step('모바일: 가져오기로 새 악보, 편집 패널, 스크롤한 상태에서 PDF, 목록');
await mob.ctx.close();

// ───────── 서버 없는 곳 (GitHub Pages 등): 바로 로컬 편집기 ─────────
const noapi = await newPage();
await noapi.page.goto('http://127.0.0.1:8090/');
await noapi.page.locator('#editor').waitFor();
assert.equal(await noapi.page.locator('#btn-home').isHidden(), true);
assert.equal(await noapi.page.locator('#btn-theme').isVisible(), true, '홈이 없으니 편집기에 테마 버튼');
await expectTitle(noapi.page, '예시 곡');
step('서버 없음 → 바로 로컬 편집기 (예전과 같음)');
await noapi.ctx.close();

await ctx.close();
await browser.close();
const real = errors.filter((e) => !/api\/config|Failed to load resource.*404/.test(e));
console.log(real.length ? `콘솔 오류:\n${real.join('\n')}` : '콘솔 오류 없음');
console.log('E2E 통과');
process.exit(0);
