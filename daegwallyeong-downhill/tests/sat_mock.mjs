// 구글 위성사진 경로 모의 검증.
// 실제 API 키 없이, tile.googleapis.com 요청을 가로채 "실제 코스 선형을 자홍색으로 그린 가짜 타일"을 돌려준다.
// 세션 생성 → 타일 모자이크 → 지형 텍스처 → UV 정합(자홍색 띠가 3D 도로 양옆에 대칭으로 깔리는지)을 확인한다.
// 주의: 이 테스트는 요청 형식과 좌표 정합만 검증한다. 실제 구글 서버 응답·과금·약관 동작은 키가 있어야 확인된다.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { launch, openGame, check, ROOT, SHOTS } from './lib.mjs';

const course = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/course.json'), 'utf8')).points;
const merc = (lon, lat, z) => { const n = 256 * 2 ** z, la = (lat * Math.PI) / 180; return [((lon + 180) / 360) * n, ((1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2) * n]; };
const crcT = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcT[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function png(rgb) { // 256x256 RGB
  const raw = Buffer.alloc(256 * (1 + 256 * 3));
  for (let y = 0; y < 256; y++) { raw[y * 769] = 0; rgb.copy(raw, y * 769 + 1, y * 768, (y + 1) * 768); }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(256, 0); ihdr.writeUInt32BE(256, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function tile(z, x, y) {
  const rgb = Buffer.alloc(256 * 256 * 3);
  const dark = (x + y) % 2;
  for (let i = 0; i < 256 * 256; i++) { rgb[i * 3] = dark ? 52 : 70; rgb[i * 3 + 1] = dark ? 96 : 120; rgb[i * 3 + 2] = dark ? 48 : 60; }
  const mpp = (156543.03392 * Math.cos((37.7 * Math.PI) / 180)) / 2 ** z, r = Math.max(1, 9 / mpp); // 중심선 좌우 9 m
  const ox = x * 256, oy = y * 256;
  for (let k = 0; k < course.length - 1; k++) {
    const a = merc(course[k][0], course[k][1], z), b = merc(course[k + 1][0], course[k + 1][1], z);
    if (Math.max(a[0], b[0]) < ox - r || Math.min(a[0], b[0]) > ox + 256 + r || Math.max(a[1], b[1]) < oy - r || Math.min(a[1], b[1]) > oy + 256 + r) continue;
    const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * 2) + 1;
    for (let t = 0; t <= n; t++) {
      const px = a[0] + ((b[0] - a[0]) * t) / n - ox, py = a[1] + ((b[1] - a[1]) * t) / n - oy;
      for (let j = Math.floor(py - r); j <= py + r; j++) for (let i = Math.floor(px - r); i <= px + r; i++) {
        if (i < 0 || j < 0 || i > 255 || j > 255 || (i - px) ** 2 + (j - py) ** 2 > r * r) continue;
        const o = (j * 256 + i) * 3; rgb[o] = 255; rgb[o + 1] = 0; rgb[o + 2] = 200;
      }
    }
  }
  return png(rgb);
}

const { browser, url, close } = await launch();
const reqs = { session: 0, tiles: 0, viewport: 0, bad: [] };
const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
await ctx.route('https://tile.googleapis.com/**', async (route) => {
  const u = new URL(route.request().url()), cors = { 'Access-Control-Allow-Origin': '*' };
  if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...cors, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' } });
  if (u.pathname === '/v1/createSession') {
    reqs.session++;
    const body = JSON.parse(route.request().postData() || '{}');
    if (u.searchParams.get('key') !== 'MOCK_KEY' || body.mapType !== 'satellite') reqs.bad.push('createSession ' + u.search);
    return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ session: 'MOCK_SESSION', expiry: String(Math.floor(Date.now() / 1000) + 3600), tileWidth: 256, tileHeight: 256, imageFormat: 'png' }) });
  }
  const m = u.pathname.match(/^\/v1\/2dtiles\/(\d+)\/(\d+)\/(\d+)$/);
  if (m) {
    reqs.tiles++;
    if (u.searchParams.get('session') !== 'MOCK_SESSION' || u.searchParams.get('key') !== 'MOCK_KEY') reqs.bad.push('tile ' + u.search);
    return route.fulfill({ status: 200, headers: cors, contentType: 'image/png', body: tile(+m[1], +m[2], +m[3]) });
  }
  if (u.pathname === '/tile/v1/viewport') { reqs.viewport++; return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ copyright: '지도 데이터 ©2026 Google (모의 응답)' }) }); }
  reqs.bad.push('unknown ' + u.pathname);
  return route.fulfill({ status: 404, headers: cors });
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript(() => { localStorage.setItem('dgr_downhill_save_v1', JSON.stringify({ v: 1, money: 0, up: {}, stages: {}, settings: { assist: 0.5, diff: 0, quality: 'mid', sound: 0, gkey: 'MOCK_KEY', sat: 1 } })); });
await page.goto(url('stage=3&auto=1'));
await page.waitForFunction(() => window.__dh && window.__dh.game && window.__dh.game.mode === 'race' && window.__dh.game.raceT > 3, null, { timeout: 240000, polling: 300 });
const info = await page.evaluate(() => { const g = window.__dh.game; return { satOn: g.satOn, err: g.google.lastError, attr: document.getElementById('h-attr').textContent }; });
await page.screenshot({ path: path.join(SHOTS, 'sat_mock.png'), timeout: 90000 });
// 위에서 내려다본 정합 확인용 장면
await page.evaluate(() => { const g = window.__dh.game; window.__dh.paused = true; const p = g.pm.root.position; g.camera.position.set(p.x, p.y + 150, p.z + 1); g.camera.lookAt(p.x, p.y, p.z); g.camera.fov = 50; g.camera.updateProjectionMatrix(); g.render(); });
await page.screenshot({ path: path.join(SHOTS, 'sat_mock_top.png'), timeout: 90000 });
check('위성사진 모드 켜짐', info.satOn === true, info.err || '');
check('세션 요청 1회 이상', reqs.session >= 1, `session ${reqs.session}`);
check('타일 요청', reqs.tiles > 10, `tiles ${reqs.tiles}`);
check('요청 형식(키·세션·mapType)', reqs.bad.length === 0, reqs.bad.slice(0, 3).join(' | '));
check('저작권 표기 노출', /Google/.test(info.attr), info.attr);
check('페이지 오류 없음', errors.length === 0, errors.slice(0, 2).join(' | '));
await close();
