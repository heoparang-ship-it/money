// 브라우저 스모크 테스트: 부팅 → 코스 선택 → 차고 → VS → 출발 → 주행(자동 조종)까지 오류 없이 도는지.
// 도트 화면 조건(정수 배 확대, 도트 글꼴), 할배의 핸디캡과 트래시토크가 실제로 나오는지도 본다.
// FULL=1 이면 한 판을 끝까지 달려 결과 화면과 저장까지 확인한다 (4배속, 20초쯤).
import path from 'node:path';
import { launch, openGame, check, SHOTS } from './lib.mjs';

const { browser, url, close } = await launch();
const { page, errors } = await openGame(browser, url('auto=1' + (process.env.FULL ? '&speed=4' : '')), { width: 800, height: 450 });
const boot = await page.evaluate(() => {
  const a = window.__dh, t = a.data.track, cv = document.getElementById('gl'), cs = getComputedStyle(cv), dpr = devicePixelRatio;
  return {
    n: t.raw.length, len: t.length, mode: a.game.mode, title: document.getElementById('scr-title').classList.contains('on'),
    S: a.game.S, cssW: parseFloat(cs.width), exactW: (cv.width * a.game.S) / dpr, render: cs.imageRendering, ctx2d: !!cv.getContext('2d'),
    font: document.fonts.check('11px Galmuri11') && document.fonts.check('bold 11px Galmuri11'), fm: getComputedStyle(document.documentElement).getPropertyValue('--fm'),
    hearts: document.querySelectorAll('#tt-hearts i').length,
  };
});
check('부팅 후 타이틀 화면', boot.title && boot.mode === 'menu');
check('실제 코스 507점 로드', boot.n === 507, `${boot.n}점, ${boot.len} m`);
check('도트 화면: Canvas 2D를 화면 픽셀의 정수 배로 확대', boot.ctx2d && Number.isInteger(boot.S) && Math.abs(boot.cssW - boot.exactW) < 0.01 && /pixelated|crisp/.test(boot.render), `도트 1칸 = 화면 ${boot.S}px, ${boot.render}`);
check('도트 글꼴(갈무리11) 내장·로드, 글자 크기는 11px의 정수 배', boot.font && (parseFloat(boot.fm) * 1) % 11 === 0, `--fm ${boot.fm}`);
await page.screenshot({ path: path.join(SHOTS, 'smoke_title.png') });
await page.click('#bt-start');
await page.waitForTimeout(400);
const lv = await page.evaluate(() => ({ on: document.getElementById('scr-levels').classList.contains('on'), items: document.querySelectorAll('#lv-list .lv').length, link: document.querySelector('#lv-db a').href, hc: document.querySelector('#lv-db .hc').textContent, map: document.getElementById('lv-canvas').width }));
check('코스 선택 화면: 레벨 10개 + 도트 지도', lv.on && lv.items === 10 && lv.map > 40, `${lv.items}개, 지도 ${lv.map}px`);
check('레벨 정보에 할배의 핸디캡 표시', lv.hc.includes('믹스커피'), lv.hc);
check('스트리트뷰 링크는 공식 Maps URL', lv.link.startsWith('https://www.google.com/maps/@?api=1&map_action=pano'), lv.link.slice(0, 80));
await page.screenshot({ path: path.join(SHOTS, 'smoke_levels.png') });
await page.evaluate(() => window.__dh.ui.show('garage'));
await page.waitForTimeout(300);
const gar = await page.evaluate(() => { const a = window.__dh; a.save.money = 100000; a.buy('engine'); return { lv: a.save.up.engine, money: a.save.money, cards: document.querySelectorAll('#gar-list .up').length, icons: [...document.querySelectorAll('#gar-list .up img')].every((i) => i.src.startsWith('data:image/png')) }; });
check('차고: 아이템 카드 8장, 엔진 개조 구매', gar.lv === 1 && gar.money === 40000 && gar.cards === 8 && gar.icons, JSON.stringify(gar));
await page.screenshot({ path: path.join(SHOTS, 'smoke_garage.png') });
await page.evaluate(() => window.__dh.startStage(1));
await page.waitForFunction(() => window.__dh.game.mode === 'race' && window.__dh.game.raceT > 9, null, { timeout: 60000, polling: 200 });
await page.screenshot({ path: path.join(SHOTS, 'smoke_race.png') });
const race = await page.evaluate(() => {
  const g = window.__dh.game;
  return { v: g.player.v, s: g.player.s - g.stage.s0, gs: g.grandpa.s - g.stage.s0, hud: document.getElementById('hud').classList.contains('on'), kmh: document.getElementById('h-kmh').textContent,
    hearts: document.querySelectorAll('#h-hearts i').length, hc: g.grandpa.handicap, lines: g.talk.count, say: document.getElementById('h-say-t').textContent, sinc: g.hud.sinc, tag: document.getElementById('h-hc').textContent };
});
check('주행 중: 플레이어·할배 전진', race.s > 40 && race.gs > 10 && race.v > 5, `나 ${race.s.toFixed(0)} m, 할배 ${race.gs.toFixed(0)} m`);
check('HUD: 속도, 멘탈 하트 5칸', race.hud && Number(race.kmh) > 10 && race.hearts === 5, `${race.kmh} km/h`);
check('할배 핸디캡(레벨 1 = 믹스커피)과 낮은 진심도', race.hc === 'coffee' && race.sinc < 20 && race.tag.includes('할배'), `${race.tag} / 진심도 ${race.sinc}%`);
check('트래시토크가 9초 안에 2번 이상', race.lines >= 2 && race.say.length > 3, `${race.lines}번, 마지막: ${race.say}`);
if (process.env.FULL) {
  await page.waitForFunction(() => window.__dh.state === 'result', null, { timeout: 180000, polling: 300 });
  const res = await page.evaluate(() => ({ r: window.__dh.lastResult.r, money: window.__dh.save.money, rec: window.__dh.save.stages[1], shown: document.getElementById('scr-result').classList.contains('on'), q: document.getElementById('res-q').textContent, stored: JSON.parse(localStorage.getItem('dgr_downhill_save_v1')).stages[1] }));
  check('결과 화면', res.shown, `기록 ${res.r.pTime.toFixed(1)}초 / 할배 ${res.r.gTime.toFixed(1)}초`);
  check('상금 지급·기록 저장', res.money > 40000 && res.stored && res.stored.tries === 1, JSON.stringify(res.rec));
  check('한 판 내내 떠든다 (평균 7초에 한 번 이상)', res.r.lines >= res.r.pTime / 7, `${res.r.lines}번 / ${res.r.pTime.toFixed(0)}초`);
  check('진심도는 20% 미만, 결과 화면에도 한마디', res.r.sincerity < 20 && res.q.length > 3, `${res.r.sincerity}% · ${res.q}`);
  await page.screenshot({ path: path.join(SHOTS, 'smoke_result.png') });
}
check('콘솔·페이지 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
await close();
