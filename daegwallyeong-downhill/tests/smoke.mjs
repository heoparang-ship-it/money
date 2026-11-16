// 브라우저 스모크 테스트: 부팅 → 코스 선택 → VS → 출발 → 주행(자동 조종)까지 오류 없이 도는지.
// FULL=1 이면 한 판을 끝까지 달려 결과 화면과 저장까지 확인한다 (소프트웨어 렌더링이라 몇 분 걸린다).
import path from 'node:path';
import { launch, openGame, check, SHOTS } from './lib.mjs';

const { browser, url, close } = await launch();
const { page, errors } = await openGame(browser, url('q=low&auto=1'), { width: 800, height: 450 });
const boot = await page.evaluate(() => { const a = window.__dh, t = a.data.track; return { n: t.raw.length, len: t.length, dev: t.stats.meanDeviation, mode: a.game.mode, title: document.getElementById('scr-title').classList.contains('on') }; });
check('부팅 후 타이틀 화면', boot.title && boot.mode === 'menu');
check('실제 코스 507점 로드', boot.n === 507, `${boot.n}점, ${boot.len} m`);
await page.screenshot({ path: path.join(SHOTS, 'smoke_title.png'), timeout: 90000 });
await page.click('#bt-start');
await page.waitForTimeout(600);
const lv = await page.evaluate(() => ({ on: document.getElementById('scr-levels').classList.contains('on'), items: document.querySelectorAll('#lv-list .lv').length, link: document.querySelector('#lv-detail a').href }));
check('코스 선택 화면: 레벨 10개', lv.on && lv.items === 10, `${lv.items}개`);
check('스트리트뷰 링크는 공식 Maps URL', lv.link.startsWith('https://www.google.com/maps/@?api=1&map_action=pano'), lv.link.slice(0, 80));
await page.screenshot({ path: path.join(SHOTS, 'smoke_levels.png'), timeout: 90000 });
await page.click('#bt-garage', { force: true }).catch(() => {});
await page.evaluate(() => window.__dh.ui.show('garage'));
await page.waitForTimeout(400);
const gar = await page.evaluate(() => { const a = window.__dh; a.save.money = 100000; a.buy('engine'); return { lv: a.save.up.engine, money: a.save.money, rows: document.querySelectorAll('#gar-list .up').length }; });
check('차고: 엔진 개조 구매', gar.lv === 1 && gar.money === 40000 && gar.rows === 8, JSON.stringify(gar));
await page.evaluate(() => window.__dh.startStage(1));
await page.waitForFunction(() => window.__dh.game.mode === 'race' && window.__dh.game.raceT > 6, null, { timeout: 300000, polling: 300 });
await page.screenshot({ path: path.join(SHOTS, 'smoke_race.png'), timeout: 90000 });
const race = await page.evaluate(() => { const g = window.__dh.game; return { v: g.player.v, s: g.player.s - g.stage.s0, gs: g.grandpa.s - g.stage.s0, hud: document.getElementById('hud').classList.contains('on'), kmh: document.getElementById('h-kmh').textContent }; });
check('주행 중: 플레이어·할배 전진', race.s > 40 && race.gs > 10 && race.v > 5, JSON.stringify(race));
check('HUD 표시', race.hud && Number(race.kmh) > 10, `${race.kmh} km/h`);
if (process.env.FULL) {
  await page.waitForFunction(() => window.__dh.state === 'result', null, { timeout: 900000, polling: 500 });
  const res = await page.evaluate(() => ({ r: window.__dh.lastResult.r, money: window.__dh.save.money, rec: window.__dh.save.stages[1], shown: document.getElementById('scr-result').classList.contains('on'), stored: JSON.parse(localStorage.getItem('dgr_downhill_save_v1')).stages[1] }));
  check('결과 화면', res.shown, `기록 ${res.r.pTime.toFixed(1)}초 / 할배 ${res.r.gTime.toFixed(1)}초`);
  check('상금 지급·기록 저장', res.money > 40000 && res.stored && res.stored.tries === 1, JSON.stringify(res.rec));
  await page.screenshot({ path: path.join(SHOTS, 'smoke_result.png'), timeout: 90000 });
}
check('콘솔·페이지 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await close();
