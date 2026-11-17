// 메뉴 화면: 타이틀, 코스 선택(실제 코스 도트 지도), 차고(아이템 카드), VS, 결과, 설정.
import { STAGES, UPGRADES, WEATHERS, GRANDPA, BIKE_PRICE, bikeParams, bikeTitle, horsepower, totalSpent, TIPS } from './config.js';
import { stageUnlocked, won } from './save.js';
import { streetViewLink, satelliteLink, embedUrl } from './google.js';
import { fmtTime, drawFace } from './hud.js';
import { DS } from './track.js';
import { HANDICAPS, TALK } from './talk.js';
import { ICONS, pixUrl } from './px/sprites.js';
import { pxText } from './px/text.js';
import { BAYER, hex } from './px/palette.js';

const $ = (id) => document.getElementById(id);
// 클로드 아티팩트 뷰어 안에서는 외부 프레임·외부 요청이 막혀 있다
const EMBED_OK = typeof __ARTIFACT__ === 'undefined' || !__ARTIFACT__;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const stars = (n, cls = '') => `<span class="stars ${cls}">${[0, 1, 2].map((i) => `<i class="${i < n ? '' : 'off'}"></i>`).join('')}</span>`;
const pick = (a) => a[(Math.random() * a.length) | 0];
const MAPCOL = ['#35178a', '#3f1f9a', '#4c27b0', '#5b2bc4', '#6a3ad8', '#7a4df0', '#8f66f4', '#a580f8', '#b79bff'].map(hex);

export class UI {
  constructor(app) {
    this.app = app; this.cur = null; this.prev = 'title'; this.sel = 1; this.vsStage = null; this.t = 0;
    this.screens = ['title', 'levels', 'garage', 'vs', 'result', 'settings', 'pause'];
    document.body.addEventListener('click', (e) => {
      const go = e.target.closest('[data-go]');
      if (go) { app.audio.play('click'); this.show(go.dataset.go === 'back' ? this.prev : go.dataset.go); }
    });
    $('bt-start').onclick = () => { app.audio.play('click'); this.show('levels'); };
    $('bt-garage').onclick = () => { app.audio.play('click'); this.show('garage'); };
    $('bt-settings').onclick = () => { app.audio.play('click'); this.show('settings'); };
    $('bt-resume').onclick = () => app.resume();
    $('bt-retry').onclick = () => app.retry();
    $('bt-quit').onclick = () => app.quitRace();
    // 확인 창 대신 두 번 누르기 (일부 환경에서는 confirm()이 뜨지 않는다)
    const rs = $('bt-reset');
    rs.onclick = () => {
      if (rs.dataset.arm === '1') { rs.dataset.arm = ''; rs.textContent = '처음부터 다시'; app.resetProgress(); return; }
      rs.dataset.arm = '1'; rs.textContent = '정말 지울까요? 한 번 더';
      setTimeout(() => { rs.dataset.arm = ''; rs.textContent = '처음부터 다시'; }, 4000);
    };
    $('h-pause').onclick = () => app.pause();
    $('bt-go').onclick = () => app.enterGrid();
    document.querySelectorAll('#set-panel .seg').forEach((seg) => seg.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      app.audio.play('click');
      app.setSetting(seg.dataset.set, b.dataset.v);
      this.renderSettings();
    }));
    const gk = $('set-gkey');
    gk.addEventListener('change', () => { app.setSetting('gkey', gk.value.trim()); this.renderSettings(); });
    drawFace($('res-face'), false);
  }

  show(name) {
    if (name === 'back') name = this.prev;
    if (this.cur && this.cur !== name && this.cur !== 'settings' && this.cur !== 'pause' && this.cur !== 'vs' && this.cur !== 'result') this.prev = this.cur;
    this.cur = name;
    for (const s of this.screens) $('scr-' + s).classList.toggle('on', s === name);
    document.querySelectorAll('[data-money]').forEach((el) => (el.textContent = won(this.app.save.money)));
    if (name === 'levels') { this.renderLevels(); requestAnimationFrame(() => this.drawMap()); }
    if (name === 'garage') this.renderGarage();
    if (name === 'settings') this.renderSettings();
    this.app.onScreen(name);
  }
  /** 화면 크기가 바뀌었을 때 */
  relayout() {
    if (this.cur === 'levels') this.drawMap();
    if (this.cur === 'vs') this.sizePreviews();
  }
  /** 매 프레임: 돌아가는 도트 모델 미리보기 */
  tick(dt) {
    this.t += dt;
    if (this.cur === 'vs' && this.vsStage && this.app.game) {
      this.app.game.preview($('vs-cme'), 'player', this.t);
      this.app.game.preview($('vs-cgp'), this.vsStage.handicap, this.t + 1.5);
    }
  }

  // ------------------------------------------------------------ 코스 선택
  stageInfo(st) {
    const t = this.app.data.track, i0 = Math.round(st.s0 / DS), i1 = Math.min(t.n - 1, Math.round(st.s1 / DS));
    const cs = t.corners.filter((c) => c.i0 >= i0 && c.i1 <= i1 && c.rMin < 60);
    const rMin = cs.reduce((m, c) => Math.min(m, c.rMin), 999);
    const ll = this.app.data.proj.toLonLat(t.X[i0], t.Z[i0]);
    const heading = (Math.atan2(t.TX[i0], -t.TZ[i0]) * 180) / Math.PI;
    return { i0, i1, len: st.s1 - st.s0, y0: t.Y[i0], y1: t.Y[i1], corners: cs.length, rMin, lon: ll[0], lat: ll[1], heading: (heading + 360) % 360 };
  }

  renderLevels() {
    const save = this.app.save;
    const maxUnlocked = STAGES.reduce((m, s) => (stageUnlocked(save, s.id) ? s.id : m), 1);
    if (!stageUnlocked(save, this.sel)) this.sel = maxUnlocked;
    const list = $('lv-list');
    list.innerHTML = STAGES.map((s) => {
      const rec = save.stages[s.id] || {}, un = stageUnlocked(save, s.id);
      return `<button class="lv ${s.id === this.sel ? 'sel' : ''} ${un ? '' : 'lock'}" data-id="${s.id}"><span class="n">${s.boss ? 'B' : s.id}</span><span class="t"><b>${esc(s.name)}</b><small>${un ? esc(HANDICAPS[s.handicap].name) : '???'} · ${WEATHERS[s.weather].label}</small></span><span class="st">${un ? stars(rec.stars || 0) : 'LOCK'}</span></button>`;
    }).join('');
    list.onclick = (e) => { const b = e.target.closest('.lv'); if (!b) return; this.sel = Number(b.dataset.id); this.app.audio.play('click'); this.renderLevels(); this.drawMap(); this.app.onScreen('levels'); };
    const sel = list.querySelector('.sel');
    if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: 'nearest' });
    this.renderDetail();
  }

  renderDetail() {
    const st = STAGES.find((s) => s.id === this.sel), save = this.app.save, rec = save.stages[st.id] || {}, un = stageUnlocked(save, st.id);
    const inf = this.stageInfo(st), key = save.settings.gkey, H = HANDICAPS[st.handicap];
    $('lv-dt').textContent = st.boss ? 'BOSS STAGE' : `LEVEL ${st.id}`;
    $('lv-db').innerHTML = `<h4>${esc(st.name)} ${stars(rec.stars || 0)}</h4>
      <p><span class="chip">실제 구간 ${(st.s0 / 1000).toFixed(2)}→${(st.s1 / 1000).toFixed(2)} km</span><span class="chip">길이 ${(inf.len / 1000).toFixed(2)} km</span><span class="chip">해발 ${inf.y0.toFixed(0)}→${inf.y1.toFixed(0)} m</span><span class="chip">코너 ${inf.corners}개</span><span class="chip">최소 반경 ${inf.rMin < 900 ? inf.rMin.toFixed(0) + ' m' : '-'}</span><span class="chip">${WEATHERS[st.weather].label}</span></p>
      <p class="hc"><b>할배의 핸디캡</b> · ${un ? esc(H.name) : '???'}</p>
      <p class="long">할배와 <b>${st.pass.toFixed(1)}초 이내</b>로 들어오면 통과(별 둘), 이기면 별 셋${rec.best ? ` · 내 최고 ${fmtTime(rec.best)}` : ''}</p>
      <div class="row"><button class="btn" id="lv-go" ${un ? '' : 'disabled'}>${un ? '<span class="ar">▶</span>출전' : '앞 레벨을 별 둘 이상으로'}</button>
      <a class="btn sec sm" href="${streetViewLink(inf.lat, inf.lon, inf.heading)}" target="_blank" rel="noopener">스트리트뷰 <span style="font-weight:400">↗</span></a>
      ${EMBED_OK ? `<button class="btn sec sm" id="lv-gmap">${key ? '스트리트뷰 미리보기' : '구글 지도 미리보기'}</button>` : `<a class="btn sec sm" href="${satelliteLink(inf.lat, inf.lon, 16)}" target="_blank" rel="noopener">구글 위성지도 <span style="font-weight:400">↗</span></a>`}</div>
      <div id="gmap-wrap"></div>`;
    $('lv-go').onclick = () => this.app.startStage(st.id);
    if ($('lv-gmap')) $('lv-gmap').onclick = () => {
      const w = $('gmap-wrap');
      if (w.style.display === 'block') { w.style.display = 'none'; w.innerHTML = ''; return; }
      w.style.display = 'block';
      w.innerHTML = `<iframe loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen src="${esc(embedUrl(inf.lat, inf.lon, inf.heading, key))}"></iframe>`;
    };
  }

  /** 실제 고도와 코스를 도트 지도로 그린다 (북쪽이 위) */
  drawMap() {
    const cv = $('lv-canvas'), box = cv.parentElement.getBoundingClientRect();
    if (box.width < 10) return;
    const q = this.app.px, W = Math.max(40, Math.floor(box.width / q)), H = Math.max(30, Math.floor(box.height / q));
    cv.width = W; cv.height = H; cv.style.width = W * q + 'px'; cv.style.height = H * q + 'px';
    const c = cv.getContext('2d'), t = this.app.data.track, save = this.app.save, f = this.app.data.features;
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let i = 0; i < t.n; i += 8) { x0 = Math.min(x0, t.X[i]); x1 = Math.max(x1, t.X[i]); z0 = Math.min(z0, t.Z[i]); z1 = Math.max(z1, t.Z[i]); }
    const pad = 16, sc = Math.min((W - pad * 2) / (x1 - x0), (H - pad * 2) / (z1 - z0));
    const ox = (W - (x1 - x0) * sc) / 2 - x0 * sc, oz = (H - (z1 - z0) * sc) / 2 - z0 * sc;
    const X = (x) => Math.round(x * sc + ox), Z = (z) => Math.round(z * sc + oz);
    // 지형: 고도 띠 + 언덕 음영 (크기가 같으면 다시 계산하지 않는다)
    const key = W + 'x' + H;
    if (!this.terrain || this.terrain.key !== key) {
      const img = c.createImageData(W, H), D = img.data, dem = this.app.data.dem, n = MAPCOL.length - 1;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const wx = (x - ox) / sc, wz = (y - oz) / sc, h = dem.height(wx, wz);
        const sh = (dem.height(wx - 40, wz - 40) - dem.height(wx + 40, wz + 40)) / 80;
        const fv = Math.max(0, Math.min(0.999, h / 1150 + sh * 0.5)) * n, i = fv | 0;
        const col = MAPCOL[BAYER[(x & 3) + ((y & 3) << 2)] / 16 < fv - i ? i + 1 : i], p = (y * W + x) * 4;
        D[p] = col[0]; D[p + 1] = col[1]; D[p + 2] = col[2]; D[p + 3] = 255;
      }
      this.terrain = { key, img };
    }
    c.putImageData(this.terrain.img, 0, 0);
    const line = (pts, col, r) => {
      c.fillStyle = col;
      for (let i = 0; i < pts.length - 2; i += 2) {
        const ax = pts[i], ay = pts[i + 1], bx = pts[i + 2], by = pts[i + 3], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)));
        for (let k = 0; k <= n; k++) c.fillRect(Math.round(ax + ((bx - ax) * k) / n) - r, Math.round(ay + ((by - ay) * k) / n) - r, r * 2 + 1, r * 2 + 1);
      }
    };
    const feat = (p) => { const o = []; for (let k = 0; k < p.length; k += 2) o.push(X(p[k]), Z(-p[k + 1])); return o; };
    for (const s of f.streams) line(feat(s.p), '#4b88ee', 0);
    for (const r of f.roads) line(feat(r.p), '#8f66f4', 0);
    const seg = (i0, i1) => { const o = []; for (let i = i0; i <= i1; i += 2) o.push(X(t.X[i]), Z(t.Z[i])); return o; };
    const all = seg(0, t.n - 1);
    line(all, '#2b1464', 2); line(all, '#e4d8ff', 1);
    for (const s of STAGES) {
      if (s.boss) continue;
      const un = stageUnlocked(save, s.id), pts = seg(Math.round(s.s0 / DS), Math.round(s.s1 / DS));
      if (s.id === this.sel) { line(pts, '#2b1464', 3); line(pts, '#ffe14a', 2); } else line(pts, un ? '#ffffff' : '#8f7fc4', 1);
    }
    const selSt = STAGES.find((s) => s.id === this.sel);
    if (selSt.boss) { line(all, '#2b1464', 3); line(all, '#ffe14a', 2); }
    for (const tb of f.turbines) { const x = X(tb[0]), y = Z(-tb[1]); c.fillStyle = '#ffffff'; c.fillRect(x - 1, y, 3, 1); c.fillRect(x, y - 1, 1, 3); }
    const label = (x, z, text, dy, col = '#ffffff') => {
      const im = pxText(text, col), px = Math.max(1, Math.min(W - im.width - 1, X(x) - (im.width >> 1))), py = Math.max(1, Math.min(H - 15, Z(z) + dy));
      c.fillStyle = '#2b1464'; c.fillRect(X(x) - 2, Z(z) - 2, 5, 5); c.fillStyle = col; c.fillRect(X(x) - 1, Z(z) - 1, 3, 3);
      c.drawImage(im, px, py);
    };
    const at = (s) => [t.X[Math.round(s / DS)], t.Z[Math.round(s / DS)]];
    for (const [s, name, dy] of [[900, '사친시비', 3], [5730, '대관령1교', -17], [8740, '가마골', -17], [10180, '대관령박물관', 3]]) { const p = at(s); label(p[0], p[1], name, dy, '#e4d8ff'); }
    label(t.X[0], t.Z[0], '대관령 정상 843m', 4, '#ffe14a');
    label(t.X[t.n - 1], t.Z[t.n - 1], '성산 72m', -18, '#ffe14a');
    for (const s of STAGES) {
      if (s.boss) continue;
      const m = (Math.round(s.s0 / DS) + Math.round(s.s1 / DS)) >> 1, un = stageUnlocked(save, s.id), on = s.id === this.sel;
      const im = pxText(String(s.id), on ? '#2b1464' : un ? '#ffffff' : '#b79bff', on ? null : '#2b1464'), x = X(t.X[m]), y = Z(t.Z[m]);
      if (on) { c.fillStyle = '#2b1464'; c.fillRect(x - 6, y - 8, 13, 15); c.fillStyle = '#ffe14a'; c.fillRect(x - 5, y - 7, 11, 13); }
      c.drawImage(im, x - (im.width >> 1), y - 7);
    }
    c.drawImage(pxText('N', '#ffffff'), W - 12, 2);
    c.fillStyle = '#ffffff'; c.fillRect(W - 9, 15, 3, 1); c.fillRect(W - 8, 14, 1, 1);
    const km = Math.round(1000 * sc);
    c.fillStyle = '#2b1464'; c.fillRect(W - 6 - km - 1, H - 6, km + 2, 3); c.fillStyle = '#ffffff'; c.fillRect(W - 6 - km, H - 5, km, 1);
    c.drawImage(pxText('1 km', '#ffffff'), W - 6 - km, H - 20);
  }

  // ------------------------------------------------------------ 차고
  renderGarage() {
    const save = this.app.save, up = save.up, p = bikeParams(up);
    $('gar-name').textContent = bikeTitle(up);
    $('gar-sub').textContent = `${horsepower(up)}마력 · 차값+개조비 ${won(BIKE_PRICE + totalSpent(up))} · 할배의 씨티백은 8마력`;
    const bar = (label, v, lo, hi, txt) => `<div>${label} <b>${txt}</b><div class="bar"><i style="width:${Math.max(4, Math.min(100, ((v - lo) / (hi - lo)) * 100)).toFixed(0)}%"></i></div></div>`;
    $('gar-stats').innerHTML = bar('최고속', p.vTop, 30, 70, `${(p.vTop * 3.6).toFixed(0)} km/h`) + bar('가속', p.a0, 4, 10.5, `${p.a0.toFixed(1)} m/s²`) + bar('코너 접지', p.mu, 0.8, 1.4, `최대 ${((Math.atan(p.mu) * 180) / Math.PI).toFixed(0)}°`) + bar('제동', p.brake, 6, 13.5, `${(p.brake / 9.81).toFixed(2)} G`) + bar('민첩성', p.leanRate, 1.6, 3.7, `${p.leanRate.toFixed(1)}`) + bar('니트로', p.nitro, 0, 3, `${p.nitro}회`);
    $('gar-list').innerHTML = UPGRADES.map((u) => {
      const lv = up[u.key] || 0, maxed = lv >= u.max, cost = maxed ? 0 : u.cost[lv + 1], can = !maxed && save.money >= cost;
      const pips = Array.from({ length: u.max }, (_, i) => `<i class="${i < lv ? 'on' : ''}"></i>`).join('');
      return `<div class="up"><div class="hd"><img class="pix" alt="" src="${pixUrl(ICONS[u.key])}"><div><b>${esc(u.name)}</b><small>${esc(u.steps[lv])}</small><div class="pips">${pips}</div></div></div>
        <div class="ft"><small>${esc(u.desc)}${maxed ? '' : `<br>다음: ${esc(u.steps[lv + 1])}`}</small><button class="btn sm ${can ? '' : 'sec'}" data-up="${u.key}" ${maxed ? 'disabled' : ''}>${maxed ? 'MAX' : won(cost)}</button></div></div>`;
    }).join('');
    $('gar-list').onclick = (e) => { const b = e.target.closest('[data-up]'); if (b) this.app.buy(b.dataset.up); };
    document.querySelectorAll('[data-money]').forEach((el) => (el.textContent = won(save.money)));
  }

  // ------------------------------------------------------------ VS / 로딩
  sizePreviews() {
    const dpr = window.devicePixelRatio || 1, vmin = Math.min(innerWidth, innerHeight), port = innerHeight > innerWidth;
    const tall = this.vsStage && ['eggtower', 'nap', 'medley'].includes(this.vsStage.handicap);
    const gp = $('vs-cgp'), h = tall ? 132 : 60;
    if (gp.height !== h) gp.height = h;
    for (const id of ['vs-cme', 'vs-cgp']) {
      const c = $(id);
      // 화면 픽셀의 정수 배로만 키운다. 세로 화면이나 낮은 화면에서는 카드가 넘치지 않게 줄인다
      let k = Math.max(1, Math.round((vmin >= 700 ? 3 : vmin >= 520 ? 2 : 1.34) * dpr));
      while (k > 1 && (c.height * k) / dpr > innerHeight * (port ? 0.2 : 0.42)) k--;
      c.style.width = (c.width * k) / dpr + 'px'; c.style.height = (c.height * k) / dpr + 'px';
    }
  }
  renderVS(st) {
    const up = this.app.save.up, p = bikeParams(up), H = HANDICAPS[st.handicap];
    this.vsStage = st;
    this.sizePreviews();
    $('vs-me').innerHTML = `<h4>${esc(bikeTitle(up))}</h4><div class="who">꽤 비싼 바이크 · 풀페이스 · 가죽 슈트</div>
      <dl><dt>출력</dt><dd>${horsepower(up)}마력</dd><dt>최고속</dt><dd>${(p.vTop * 3.6).toFixed(0)} km/h</dd><dt>최대 기울기</dt><dd>${((Math.atan(p.mu) * 180) / Math.PI).toFixed(0)}°</dd><dt>차값+개조비</dt><dd>${won(BIKE_PRICE + totalSpent(up))}</dd></dl>`;
    $('vs-gp').innerHTML = `<h4>${GRANDPA.bike} (97cc)</h4><div class="who">${GRANDPA.name} · 대관령 40년 · 중고 35만 원</div>
      <div class="hcname">오늘의 핸디캡 · ${esc(H.name)}</div>
      <dl><dt>출력</dt><dd>8마력</dd>${H.vs.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}<dt>진심도</dt><dd>${H.sincerity}%</dd></dl>`;
    $('vs-quote').textContent = `"${pick(TALK.start[st.handicap])}"`;
    $('bt-go').style.display = 'none'; $('load-bar').style.display = 'block';
    this.setLoad(0, TIPS[(Math.random() * TIPS.length) | 0]);
  }
  setLoad(p, tip) { $('load-bar').firstElementChild.style.width = (p * 100).toFixed(0) + '%'; if (tip) $('load-tip').textContent = tip; }
  showGo() { $('load-bar').style.display = 'none'; $('bt-go').style.display = 'inline-flex'; $('load-tip').textContent = 'TIP · ' + TIPS[(Math.random() * TIPS.length) | 0]; }

  // ------------------------------------------------------------ 결과
  renderResult(st, r, reward, quote, info) {
    const H = HANDICAPS[st.handicap], head = $('res-head');
    $('res-tb').textContent = `RESULT · Lv.${st.id} ${st.name}`;
    const badge = $('res-badge');
    badge.classList.remove('on'); void badge.offsetWidth;
    badge.classList.toggle('on', info.stars >= 2);
    $('res-stars').innerHTML = [0, 1, 2].map((i) => `<i class="${i < info.stars ? '' : 'off'}"></i>`).join('');
    $('res-badge-t').textContent = info.levelUp ? 'LEVEL UP' : r.win ? 'YOU WIN' : 'CLEAR';
    head.className = r.win ? 'won' : 'lost';
    head.textContent = r.dnf ? '할배는 벌써 감자 삶는 중' : r.win ? (st.boss ? '대관령의 새 주인!' : '할배를 이겼다!!') : '할배 승';
    $('res-sub').textContent = r.dnf ? '완주 실패' : r.win ? `${Math.abs(r.gap).toFixed(2)}초 차로 승리` : `${r.gap.toFixed(2)}초 뒤 · ${r.gap <= st.pass ? '통과 기준 달성' : `통과 기준 ${st.pass.toFixed(1)}초`}`;
    $('res-times').innerHTML = `<div><small>나 · ${esc(bikeTitle(this.app.save.up))}</small><b>${r.dnf ? '--' : fmtTime(r.pTime)}</b></div><div><small>${GRANDPA.name} · ${esc(H.name)}</small><b>${fmtTime(r.gTime)}</b></div>`;
    $('res-meta').innerHTML = `<div>남은 멘탈<div class="hearts" style="margin-top:calc(var(--p)*2)">${[0, 1, 2, 3, 4].map((i) => `<i class="${i < r.hearts ? '' : 'off'}"></i>`).join('')}</div></div>
      <div>할배 진심도 <b>${r.sincerity}%</b> · 한마디 ${r.lines}번<div class="bar"><i style="width:${r.sincerity}%"></i></div></div>`;
    $('res-rows').innerHTML = reward.rows.map(([k, v]) => `<div><span>${esc(k)}</span><span>${won(v)}</span></div>`).join('') + `<div class="sum"><span>이번 상금</span><span>+${won(reward.total)}</span></div>
      <div class="nb"><span>최고속 ${r.topSpeed.toFixed(0)} km/h · 클린 코너 ${r.clean} · 넘어짐 ${r.crashes} · 스침 ${r.scrapes}</span><span>보유 ${won(this.app.save.money)}</span></div>`;
    $('res-q').textContent = quote;
    const next = STAGES.find((s) => s.id === st.id + 1);
    $('res-btns').innerHTML = `<button class="btn ${r.win ? 'sec' : ''}" id="rs-retry">다시 도전</button><button class="btn sec" id="rs-garage">차고 · 개조</button>${next && info.nextUnlocked ? '<button class="btn" id="rs-next">다음 레벨 ▶</button>' : ''}<button class="btn sec" id="rs-levels">코스 선택</button>`;
    $('rs-retry').onclick = () => this.app.retry();
    $('rs-garage').onclick = () => { this.prev = 'levels'; this.show('garage'); };
    $('rs-levels').onclick = () => this.show('levels');
    if ($('rs-next')) $('rs-next').onclick = () => { this.sel = next.id; this.app.startStage(next.id); };
  }

  // ------------------------------------------------------------ 설정
  renderSettings() {
    const s = this.app.save.settings, g = this.app.game;
    const val = { assist: String(s.assist), diff: String(s.diff), sound: String(s.sound ? 1 : 0), sat: String(s.sat ? 1 : 0) };
    document.querySelectorAll('#set-panel .seg').forEach((seg) => seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === val[seg.dataset.set])));
    const gk = $('set-gkey');
    if (document.activeElement !== gk) gk.value = s.gkey || '';
    $('set-gstatus').textContent = !s.gkey ? '키 없음 — 바닥은 실제 고도와 토지피복으로 그립니다. 스트리트뷰는 코스 선택 화면의 링크로 열 수 있습니다.'
      : g && g.satError ? `마지막 오류: ${g.satError}` : g && g.satOn ? '위성사진 도트 바닥 적용 중' : '키 저장됨 — 다음 코스를 불러올 때 위성사진을 받습니다.';
    $('set-env').textContent = EMBED_OK ? '' : '이 미리보기 화면에서는 외부 지도 서버 요청이 차단되어 위성사진이 적용되지 않습니다. 저장소의 index.html을 직접 열면 동작합니다.';
  }
}
