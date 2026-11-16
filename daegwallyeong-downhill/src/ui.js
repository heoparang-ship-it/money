// 메뉴 화면: 타이틀, 코스 선택(실제 코스 지도), 차고, VS/로딩, 결과, 설정.
import { STAGES, UPGRADES, WEATHERS, CARGO_LABEL, GRANDPA, BIKE_PRICE, bikeParams, bikeTitle, horsepower, totalSpent, TIPS } from './config.js';
import { stageUnlocked, won, writeSave } from './save.js';
import { streetViewLink, satelliteLink, embedUrl } from './google.js';
import { fmtTime } from './hud.js';
import { DS } from './track.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const stars = (n) => '★'.repeat(n) + '☆'.repeat(3 - n);

export class UI {
  constructor(app) {
    this.app = app; this.cur = null; this.prev = 'title'; this.sel = 1;
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
    $('bt-reset').onclick = () => { if (confirm('돈·개조·기록을 모두 지우고 처음부터 시작할까요?')) app.resetProgress(); };
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
    addEventListener('resize', () => { if (this.cur === 'levels') this.drawMap(); });
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
      return `<button class="lv ${s.id === this.sel ? 'sel' : ''} ${un ? '' : 'lock'}" data-id="${s.id}"><span class="n">${s.boss ? '👑' : s.id}</span><span class="t"><b>${esc(s.name)}</b><small>${esc(s.place)} · ${WEATHERS[s.weather].label}</small></span><span class="st">${un ? stars(rec.stars || 0) : '🔒'}</span></button>`;
    }).join('');
    list.onclick = (e) => { const b = e.target.closest('.lv'); if (!b) return; this.sel = Number(b.dataset.id); this.app.audio.play('click'); this.renderLevels(); this.drawMap(); };
    const sel = list.querySelector('.sel');
    if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: 'nearest' });
    this.renderDetail();
  }

  renderDetail() {
    const st = STAGES.find((s) => s.id === this.sel), save = this.app.save, rec = save.stages[st.id] || {}, un = stageUnlocked(save, st.id);
    const inf = this.stageInfo(st), key = save.settings.gkey;
    const el = $('lv-detail');
    el.innerHTML = `<h4>Lv.${st.id} ${esc(st.name)} <span style="color:var(--y);font-size:14px">${stars(rec.stars || 0)}</span></h4>
      <p><span class="chip">실제 구간 ${(st.s0 / 1000).toFixed(2)}→${(st.s1 / 1000).toFixed(2)} km</span><span class="chip">길이 ${(inf.len / 1000).toFixed(2)} km</span><span class="chip">해발 ${inf.y0.toFixed(0)}→${inf.y1.toFixed(0)} m</span><span class="chip">코너 ${inf.corners}개</span><span class="chip">최소 반경 ${inf.rMin < 900 ? inf.rMin.toFixed(0) + ' m' : '-'}</span><span class="chip">${WEATHERS[st.weather].label}</span></p>
      <p class="long">👴 "${esc(st.intro)}" — 짐: ${esc(CARGO_LABEL[st.cargo])}</p>
      <p>통과 기준: 할배와 <b>${st.pass.toFixed(1)}초 이내</b> 완주 (★★) · 할배를 이기면 ★★★${rec.best ? ` · 내 최고 ${fmtTime(rec.best)}` : ''}</p>
      <div class="row"><button class="btn" id="lv-go" ${un ? '' : 'disabled'}>${un ? '출전!' : '이전 레벨을 ★★ 이상으로 통과하세요'}</button>
      <a class="btn sec sm" href="${streetViewLink(inf.lat, inf.lon, inf.heading)}" target="_blank" rel="noopener">실제 도로 스트리트뷰 ↗</a>
      <button class="btn sec sm" id="lv-gmap">${key ? '스트리트뷰 미리보기' : '구글 지도 미리보기'}</button></div>
      <div id="gmap-wrap"></div>`;
    $('lv-go').onclick = () => this.app.startStage(st.id);
    $('lv-gmap').onclick = () => {
      const w = $('gmap-wrap');
      if (w.style.display === 'block') { w.style.display = 'none'; w.innerHTML = ''; return; }
      w.style.display = 'block';
      w.innerHTML = `<iframe loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen src="${esc(embedUrl(inf.lat, inf.lon, inf.heading, key))}"></iframe>`;
    };
  }

  drawMap() {
    const cv = $('lv-canvas'), box = cv.parentElement.getBoundingClientRect();
    if (box.width < 10) return;
    const dpr = Math.min(2, devicePixelRatio || 1);
    cv.width = box.width * dpr; cv.height = box.height * dpr;
    const c = cv.getContext('2d'), t = this.app.data.track, save = this.app.save, f = this.app.data.features;
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let i = 0; i < t.n; i += 8) { x0 = Math.min(x0, t.X[i]); x1 = Math.max(x1, t.X[i]); z0 = Math.min(z0, t.Z[i]); z1 = Math.max(z1, t.Z[i]); }
    const pad = 34 * dpr, sc = Math.min((cv.width - pad * 2) / (x1 - x0), (cv.height - pad * 2) / (z1 - z0));
    const ox = (cv.width - (x1 - x0) * sc) / 2 - x0 * sc, oz = (cv.height - (z1 - z0) * sc) / 2 - z0 * sc;
    const X = (x) => x * sc + ox, Z = (z) => z * sc + oz;
    c.fillStyle = '#18222b'; c.fillRect(0, 0, cv.width, cv.height);
    // 등고선 느낌의 음영 (실제 고도)
    const dem = this.app.data.dem, step = 7 * dpr;
    for (let py = 0; py < cv.height; py += step) for (let px = 0; px < cv.width; px += step) {
      const h = dem.height((px + step / 2 - ox) / sc, (py + step / 2 - oz) / sc);
      const v = Math.max(0, Math.min(1, h / 1100));
      c.fillStyle = `rgb(${(24 + v * 46) | 0},${(44 + v * 58) | 0},${(34 + v * 30) | 0})`;
      c.fillRect(px, py, step, step);
    }
    // 주변 도로·하천
    c.lineCap = c.lineJoin = 'round';
    const poly = (p, col, w) => { c.beginPath(); for (let k = 0; k < p.length; k += 2) { const x = X(p[k]), y = Z(-p[k + 1]); if (k) c.lineTo(x, y); else c.moveTo(x, y); } c.strokeStyle = col; c.lineWidth = w * dpr; c.stroke(); };
    for (const s of f.streams) poly(s.p, 'rgba(90,150,190,.55)', 1.2);
    for (const r of f.roads) poly(r.p, 'rgba(255,255,255,.16)', 1);
    // 전체 코스
    const seg = (i0, i1, col, w) => { c.beginPath(); for (let i = i0; i <= i1; i += 2) { if (i === i0) c.moveTo(X(t.X[i]), Z(t.Z[i])); else c.lineTo(X(t.X[i]), Z(t.Z[i])); } c.strokeStyle = col; c.lineWidth = w * dpr; c.stroke(); };
    seg(0, t.n - 1, 'rgba(0,0,0,.6)', 7); seg(0, t.n - 1, '#8b939c', 3.2);
    for (const s of STAGES) {
      if (s.boss) continue;
      const i0 = Math.round(s.s0 / DS), i1 = Math.round(s.s1 / DS), un = stageUnlocked(save, s.id);
      seg(i0, i1, s.id === this.sel ? '#ffd21f' : un ? '#e9edf2' : '#59616b', s.id === this.sel ? 6 : 3.4);
    }
    const selSt = STAGES.find((s) => s.id === this.sel);
    if (selSt.boss) seg(Math.round(selSt.s0 / DS), Math.round(selSt.s1 / DS), '#ffd21f', 5);
    const numbers = () => {
      for (const s of STAGES) {
        if (s.boss) continue;
        const i0 = Math.round(s.s0 / DS), i1 = Math.round(s.s1 / DS), un = stageUnlocked(save, s.id), m = (i0 + i1) >> 1;
        c.font = `900 ${13 * dpr}px sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillStyle = s.id === this.sel ? '#ffd21f' : 'rgba(0,0,0,.82)'; c.beginPath(); c.arc(X(t.X[m]), Z(t.Z[m]), 10.5 * dpr, 0, 7); c.fill();
        c.fillStyle = s.id === this.sel ? '#111' : un ? '#fff' : '#9aa2ab'; c.fillText(String(s.id), X(t.X[m]), Z(t.Z[m]) + dpr);
      }
    };
    const label = (x, z, text, dy = -12, col = '#fff') => {
      c.font = `700 ${11.5 * dpr}px sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
      const w = c.measureText(text).width + 10 * dpr;
      c.fillStyle = 'rgba(8,10,16,.78)'; c.fillRect(X(x) - w / 2, Z(z) + dy * dpr - 9 * dpr, w, 18 * dpr);
      c.fillStyle = col; c.fillText(text, X(x), Z(z) + dy * dpr);
      c.beginPath(); c.arc(X(x), Z(z), 3.5 * dpr, 0, 7); c.fillStyle = col; c.fill();
    };
    label(t.X[0], t.Z[0], '대관령 정상 843m', 16, '#ffd21f');
    label(t.X[t.n - 1], t.Z[t.n - 1], '성산 72m', -14, '#ffd21f');
    const at = (s) => [t.X[Math.round(s / DS)], t.Z[Math.round(s / DS)]];
    for (const [s, name, dy] of [[900, '신사임당 사친시비', 15], [5730, '대관령1교', -14], [8740, '가마골', -14], [10180, '대관령박물관', 16]]) { const p = at(s); label(p[0], p[1], name, dy, '#cfd6de'); }
    numbers();
    for (const tb of f.turbines) { c.fillStyle = 'rgba(255,255,255,.75)'; c.font = `${10 * dpr}px sans-serif`; c.fillText('✣', X(tb[0]), Z(-tb[1])); }
    // 북쪽 표시 + 축척
    c.fillStyle = '#fff'; c.font = `900 ${12 * dpr}px sans-serif`; c.textAlign = 'center'; c.fillText('N ▲', cv.width - 26 * dpr, 18 * dpr);
    const km = 1000 * sc; c.fillRect(cv.width - 20 * dpr - km, cv.height - 16 * dpr, km, 3 * dpr); c.font = `700 ${10.5 * dpr}px sans-serif`; c.fillText('1 km', cv.width - 20 * dpr - km / 2, cv.height - 25 * dpr);
  }

  // ------------------------------------------------------------ 차고
  renderGarage() {
    const save = this.app.save, up = save.up, p = bikeParams(up), base = bikeParams({});
    $('gar-name').textContent = bikeTitle(up);
    $('gar-sub').textContent = `${horsepower(up)}마력 · 차값+개조비 ${won(BIKE_PRICE + totalSpent(up))} · 할배의 씨티백은 8마력`;
    const bar = (label, v, lo, hi, txt) => `<div>${label} <b style="float:right">${txt}</b><div class="bar"><i style="width:${Math.max(4, Math.min(100, ((v - lo) / (hi - lo)) * 100)).toFixed(0)}%"></i></div></div>`;
    $('gar-stats').innerHTML = bar('최고속', p.vTop, 30, 70, `${(p.vTop * 3.6).toFixed(0)} km/h`) + bar('가속', p.a0, 4, 10.5, `${p.a0.toFixed(1)} m/s²`) + bar('코너 접지', p.mu, 0.8, 1.4, `최대 ${((Math.atan(p.mu) * 180) / Math.PI).toFixed(0)}°`) + bar('제동', p.brake, 6, 13.5, `${(p.brake / 9.81).toFixed(2)} G`) + bar('민첩성', p.leanRate, 1.6, 3.7, `${p.leanRate.toFixed(1)}`) + bar('니트로', p.nitro, 0, 3, `${p.nitro}회`);
    void base;
    $('gar-list').innerHTML = UPGRADES.map((u) => {
      const lv = up[u.key] || 0, maxed = lv >= u.max, cost = maxed ? 0 : u.cost[lv + 1], can = !maxed && save.money >= cost;
      const pips = Array.from({ length: u.max }, (_, i) => `<i class="${i < lv ? 'on' : ''}"></i>`).join('');
      return `<div class="up"><span class="ic">${u.icon}</span><span class="t"><b>${esc(u.name)}</b> <span style="font-size:12px;color:var(--y)">${esc(u.steps[lv])}</span><small>${esc(u.desc)}${maxed ? '' : ` → 다음: ${esc(u.steps[lv + 1])}`}</small><span class="pips">${pips}</span></span>
        <button class="btn sm ${can ? '' : 'sec'}" data-up="${u.key}" ${maxed ? 'disabled' : ''}>${maxed ? '완료' : won(cost)}</button></div>`;
    }).join('');
    $('gar-list').onclick = (e) => { const b = e.target.closest('[data-up]'); if (b) this.app.buy(b.dataset.up); };
    document.querySelectorAll('[data-money]').forEach((el) => (el.textContent = won(save.money)));
  }

  // ------------------------------------------------------------ VS / 로딩
  renderVS(st) {
    const up = this.app.save.up, p = bikeParams(up);
    $('vs-me').innerHTML = `<div class="big">🏍️</div><h4>${esc(bikeTitle(up))}</h4><div class="who">나 · 꽤 비싼 바이크</div>
      <dl><dt>출력</dt><dd>${horsepower(up)}마력</dd><dt>최고속</dt><dd>${(p.vTop * 3.6).toFixed(0)} km/h</dd><dt>최대 기울기</dt><dd>${((Math.atan(p.mu) * 180) / Math.PI).toFixed(0)}°</dd><dt>차값+개조비</dt><dd>${won(BIKE_PRICE + totalSpent(up))}</dd><dt>장비</dt><dd>풀페이스·가죽 슈트</dd></dl>`;
    $('vs-gp').innerHTML = `<div class="big">🛵</div><h4>${GRANDPA.bike} (97cc)</h4><div class="who">${GRANDPA.name} · 대관령 40년</div>
      <dl><dt>출력</dt><dd>8마력</dd><dt>최고속</dt><dd>계기판이 80까지</dd><dt>최대 기울기</dt><dd>측정 불가</dd><dt>차값</dt><dd>중고 35만 원</dd><dt>오늘의 짐</dt><dd>${esc(CARGO_LABEL[st.cargo])}</dd></dl>`;
    $('vs-quote').textContent = `👴 "${st.intro}"`;
    $('bt-go').style.display = 'none'; $('load-bar').style.display = 'block';
    this.setLoad(0, TIPS[(Math.random() * TIPS.length) | 0]);
  }
  setLoad(p, tip) { $('load-bar').firstElementChild.style.width = (p * 100).toFixed(0) + '%'; if (tip) $('load-tip').textContent = tip; }
  showGo() { $('load-bar').style.display = 'none'; $('bt-go').style.display = 'inline-block'; $('load-tip').textContent = 'TIP · ' + TIPS[(Math.random() * TIPS.length) | 0]; }

  // ------------------------------------------------------------ 결과
  renderResult(st, r, reward, quote, nextUnlocked) {
    const head = $('res-head');
    head.className = r.win ? 'win' : 'lose';
    head.textContent = r.dnf ? '할배는 벌써 감자 삶는 중' : r.win ? (st.boss ? '대관령의 새 주인!' : '할배를 이겼다!!') : '할배 승';
    $('res-sub').textContent = `Lv.${st.id} ${st.name} · ${r.dnf ? '완주 실패' : r.win ? `${Math.abs(r.gap).toFixed(2)}초 차로 승리` : `${r.gap.toFixed(2)}초 뒤 ${r.gap <= st.pass ? '· 통과 기준 달성 ★★' : `· 통과 기준 ${st.pass.toFixed(1)}초`}`}`;
    $('res-times').innerHTML = `<div><small>나 · ${esc(bikeTitle(this.app.save.up))}</small><b>${r.dnf ? '--' : fmtTime(r.pTime)}</b></div><div><small>${GRANDPA.name} · ${GRANDPA.bike}</small><b>${fmtTime(r.gTime)}</b></div>`;
    $('res-rows').innerHTML = reward.rows.map(([k, v]) => `<div><span>${esc(k)}</span><span>${won(v)}</span></div>`).join('') + `<div class="sum"><span>이번 상금</span><span>+${won(reward.total)}</span></div>
      <div style="border:0;color:var(--mut);font-size:12px"><span>최고속 ${r.topSpeed.toFixed(0)} km/h · 클린 코너 ${r.clean} · 넘어짐 ${r.crashes} · 스침 ${r.scrapes}</span><span>보유 ${won(this.app.save.money)}</span></div>`;
    $('res-q').textContent = quote;
    const next = STAGES.find((s) => s.id === st.id + 1);
    $('res-btns').innerHTML = `<button class="btn ${r.win ? 'sec' : ''}" id="rs-retry">다시 도전</button><button class="btn sec" id="rs-garage">차고 · 개조</button>${next && nextUnlocked ? '<button class="btn" id="rs-next">다음 레벨 →</button>' : ''}<button class="btn sec" id="rs-levels">코스 선택</button>`;
    $('rs-retry').onclick = () => this.app.retry();
    $('rs-garage').onclick = () => { this.prev = 'levels'; this.show('garage'); };
    $('rs-levels').onclick = () => this.show('levels');
    if ($('rs-next')) $('rs-next').onclick = () => { this.sel = next.id; this.app.startStage(next.id); };
  }

  // ------------------------------------------------------------ 설정
  renderSettings() {
    const s = this.app.save.settings, q = this.app.game ? this.app.game.qualityKey : s.quality;
    const val = { assist: String(s.assist), diff: String(s.diff), quality: q, sound: String(s.sound ? 1 : 0), sat: String(s.sat ? 1 : 0) };
    document.querySelectorAll('#set-panel .seg').forEach((seg) => seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === val[seg.dataset.set])));
    const gk = $('set-gkey');
    if (document.activeElement !== gk) gk.value = s.gkey || '';
    const g = this.app.game && this.app.game.google;
    $('set-gstatus').textContent = !s.gkey ? '키 없음 — 지형은 실제 고도 + 토지피복 색으로 그립니다. 스트리트뷰는 새 창 링크로 열 수 있습니다.'
      : g && g.lastError ? `마지막 오류: ${g.lastError}` : this.app.game && this.app.game.satOn ? '위성사진 적용 중 ✓' : '키 저장됨 — 다음 코스를 불러올 때 위성사진을 받습니다.';
  }
}

export function persist(save) { writeSave(save); }
export { satelliteLink };
