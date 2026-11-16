// 진입점: 저장 불러오기 → 실제 지도 데이터 풀기 → 게임·UI 연결 → 메인 루프.
import { loadWorldData } from './data.js';
import { Game } from './game.js';
import { Hud } from './hud.js';
import { UI } from './ui.js';
import { Input } from './input.js';
import { GameAudio } from './audio.js';
import { loadSave, writeSave, resetSave, stageUnlocked } from './save.js';
import { STAGES, UPGRADES, LINES } from './config.js';
import { clamp } from './geo.js';

const $ = (id) => document.getElementById(id);
const pick = (a) => a[(Math.random() * a.length) | 0];

class App {
  constructor() {
    this.params = new URLSearchParams(location.search);
    this.save = loadSave();
    this.audio = new GameAudio();
    this.audio.setEnabled(this.save.settings.sound);
    this.input = new Input();
    this.hud = new Hud();
    this.paused = false; this.state = 'menu'; this.dirtyWorld = false; this.inp = {}; this.last = 0;
    const unlock = () => this.audio.unlock();
    addEventListener('pointerdown', unlock); addEventListener('keydown', unlock);
    this.touch = matchMedia('(pointer:coarse)').matches || 'ontouchstart' in window;
    if (this.touch) $('rotate').classList.add('need');
    addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch' && !this.touch) { this.touch = true; if (this.state === 'race') this.hud.setTouch(true); } });
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.state === 'race' && !this.paused) this.pause(); });
  }

  bootMsg(text) { const f = $('fatal'); f.style.display = text ? 'flex' : 'none'; f.innerHTML = text || ''; }

  async boot() {
    this.bootMsg('<div><div style="font-size:44px">🛵</div><b style="font-size:20px">대관령 올라가는 중…</b><div id="boot-p" style="color:#a7adb8;margin-top:6px">실제 지도 데이터를 푸는 중</div></div>');
    this.data = await loadWorldData();
    this.game = new Game($('gl'), this.data, (t, p) => this.onGameEvent(t, p));
    let q = this.params.get('q') || this.save.settings.quality;
    if (!['low', 'mid', 'high'].includes(q)) q = this.autoQuality();
    this.game.setQuality(q);
    this.game.autopilot = this.params.has('auto');
    if (this.params.get('skill')) this.game.autopilotSkill = Number(this.params.get('skill'));
    this.ui = new UI(this);
    addEventListener('resize', () => this.game.resize());
    const fs = $('bt-full');
    if (document.fullscreenEnabled && fs) {
      fs.style.display = 'inline-block';
      fs.onclick = () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {}); };
    }
    const want = Number(this.params.get('stage')) || STAGES.reduce((m, s) => (stageUnlocked(this.save, s.id) ? s.id : m), 1);
    const st = STAGES.find((s) => s.id === want) || STAGES[0];
    this.ui.sel = st.id;
    await this.game.loadStage(st, this.save.up, this.save.settings, (p, tip) => { const el = $('boot-p'); if (el) el.textContent = `${tip || ''} ${(p * 100).toFixed(0)}%`; });
    this.bootMsg('');
    this.ui.show('title');
    requestAnimationFrame((t) => this.loop(t));
    if (this.params.has('stage')) this.startStage(st.id);
  }

  autoQuality() {
    let soft = false;
    try {
      const gl = this.game.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
      const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
      soft = /swiftshader|llvmpipe|software/i.test(name);
    } catch (e) { /* 정보 없음 */ }
    if (soft) return 'low';
    return this.touch || Math.min(innerWidth, innerHeight) < 600 ? 'mid' : 'high';
  }

  // ------------------------------------------------------------ 화면 전환
  onScreen(name) {
    if (!this.game || !this.game.world) return;
    if (name === 'title' || name === 'levels') { this.state = 'menu'; this.paused = false; this.game.mode = 'menu'; this.hud.show(false); this.hud.setTouch(false); }
    else if (name === 'garage') { this.state = 'menu'; this.paused = false; this.game.mode = 'garage'; this.hud.show(false); this.hud.setTouch(false); }
  }

  async startStage(id) {
    const st = STAGES.find((s) => s.id === id);
    if (!st || this.loading) return;
    this.loading = true; this.state = 'vs'; this.paused = false;
    this.hud.show(false); this.hud.setTouch(false);
    this.ui.show('vs'); this.ui.renderVS(st);
    const g = this.game, s = this.save.settings;
    try {
      if (!g.stage || g.stage.id !== id || this.dirtyWorld) {
        g.mode = 'loading';
        await new Promise((r) => setTimeout(r, 60));
        await g.loadStage(st, this.save.up, s, (p, tip) => this.ui.setLoad(p, tip));
      } else {
        g.stage.k = st.k + (s.diff || 0); g.assist = s.assist;
        g.refreshPlayer(this.save.up);
        g.mode = 'menu';
      }
      this.dirtyWorld = false;
      this.ui.setLoad(1); this.ui.showGo();
      if (g.autopilot) this.enterGrid();
    } catch (e) { this.fatal(e); }
    this.loading = false;
  }

  enterGrid() {
    const g = this.game;
    this.audio.unlock();
    this.ui.show(null);
    this.hud.setStage(g.stage, this.data.track, g.satInfo);
    this.hud.show(true); this.hud.setTouch(this.touch);
    g.toGrid();
    this.state = 'race'; this.paused = false;
    // 처음 몇 판은 조작법을 띄운다
    const tries = Object.values(this.save.stages).reduce((n, r) => n + (r.tries || 0), 0);
    this.hud.help(tries < 3 ? (this.touch
      ? '<b>왼쪽 패드</b>를 좌우로 밀어 기울이기 · <b>오른쪽 버튼</b> 브레이크<br>가속은 자동 · 코너 앞에서 미리 감속!'
      : '<b>← →</b> 기울이기 · <b>↓ / 스페이스</b> 브레이크 · <b>Shift</b> 니트로<br>가속은 자동 · 코너 앞에서 미리 감속!') : '', 8);
    clearTimeout(this._cd);
    this._cd = setTimeout(() => { if (this.state === 'race') g.startCountdown(); }, 900);
  }
  retry() { this.paused = false; this.enterGrid(); }
  pause() { if (this.state !== 'race' || this.paused || this.game.mode === 'finish') return; this.paused = true; this.ui.show('pause'); }
  resume() { this.paused = false; this.ui.show(null); }
  quitRace() { this.paused = false; clearTimeout(this._cd); this.ui.show('levels'); }

  // ------------------------------------------------------------ 게임 이벤트
  onGameEvent(type, p) {
    if (type === 'count') {
      this.hud.count(p); this.audio.play(p > 0 ? 'beep' : 'go');
      if (p <= 0 && this.save.up.sticker && Math.random() < 0.6) setTimeout(() => this.state === 'race' && this.hud.say(LINES.sticker[0]), 3600);
    } else if (type === 'say') this.hud.say(p);
    else if (type === 'toast') this.hud.toast(p);
    else if (type === 'sfx') this.audio.play(p);
    else if (type === 'notice') { this.ui.setLoad(0.4, p); }
    else if (type === 'finish') { this.audio.play(p.win ? 'win' : 'lose'); this.hud.toast(p.dnf ? '시간 초과…' : p.win ? '할배를 이겼다!!' : '할배 승…'); }
    else if (type === 'result') this.onResult(p);
  }

  reward(st, r, firstWin) {
    const base = (40000 + 14000 * st.id) * (st.boss ? 2 : 1), rows = [];
    const add = (k, v) => { v = Math.round(v / 100) * 100; if (v > 0) rows.push([k, v]); };
    if (r.dnf) add('참가상', base * 0.3);
    else {
      add('완주 수당', base);
      if (r.win) { add('할배 격파!', base * 2.5); if (firstWin) add('첫 승리 보너스', base * 2.5); }
      else add('할배와 접전', base * clamp(1 - r.gap / 8, 0, 1));
      if (r.crashes === 0) add('무사고', base * 0.4);
      add(`클린 코너 ×${r.clean}`, 3000 * r.clean);
      add(`선두 주행 ${Math.round(r.led)}초`, 1000 * Math.round(r.led));
    }
    return { rows, total: rows.reduce((s, x) => s + x[1], 0) };
  }

  onResult(r) {
    const st = STAGES.find((s) => s.id === this.game.stage.id), save = this.save;
    const rec = (save.stages[st.id] ||= { stars: 0, best: 0, wins: 0, tries: 0 });
    rec.tries++;
    const reward = this.reward(st, r, r.win && !rec.wins);
    save.money += reward.total;
    const now = r.dnf ? 0 : r.win ? 3 : r.gap <= st.pass ? 2 : 1;
    rec.stars = Math.max(rec.stars, now);
    if (r.win) rec.wins++;
    if (!r.dnf && (!rec.best || r.pTime < rec.best)) rec.best = r.pTime;
    writeSave(save);
    const quote = r.win ? (st.boss ? LINES.bossLose[0] : pick(LINES.lose)) : pick(LINES.win);
    this.state = 'result';
    this.hud.show(false); this.hud.setTouch(false);
    this.ui.renderResult(st, r, reward, quote, stageUnlocked(save, st.id + 1));
    this.ui.show('result');
    this.lastResult = { r, reward };
  }

  buy(key) {
    const u = UPGRADES.find((x) => x.key === key), lv = this.save.up[key] || 0;
    if (!u || lv >= u.max) return;
    const cost = u.cost[lv + 1];
    if (this.save.money < cost) { this.audio.play('deny'); return; }
    this.save.money -= cost; this.save.up[key] = lv + 1;
    writeSave(this.save);
    this.audio.play('buy');
    this.game.refreshPlayer(this.save.up);
    this.game.mode = 'garage';
    this.ui.renderGarage();
  }

  setSetting(k, v) {
    const s = this.save.settings;
    if (k === 'assist' || k === 'diff') s[k] = parseFloat(v);
    else if (k === 'sound') { s.sound = v === '1' ? 1 : 0; this.audio.setEnabled(s.sound); }
    else if (k === 'sat') { s.sat = v === '1' ? 1 : 0; this.dirtyWorld = true; }
    else if (k === 'quality') { s.quality = v; this.game.setQuality(v); this.dirtyWorld = true; }
    else if (k === 'gkey') { s.gkey = v; this.dirtyWorld = true; if (this.game.google) this.game.google.lastError = ''; }
    if (k === 'assist' && this.game) this.game.assist = s.assist;
    writeSave(this.save);
  }

  resetProgress() { resetSave(this.save); this.game.refreshPlayer(this.save.up); this.ui.sel = 1; this.ui.show('title'); }

  fatal(e) {
    console.error(e);
    this.bootMsg(`<div><div style="font-size:40px">🛠️</div><b>문제가 생겼습니다</b><div style="color:#a7adb8;margin-top:8px;max-width:560px">${String((e && e.message) || e).replace(/</g, '&lt;')}</div><div style="margin-top:12px;color:#a7adb8">페이지를 새로 고쳐 보세요. WebGL을 지원하는 최신 브라우저가 필요합니다.</div></div>`);
  }

  // ------------------------------------------------------------ 루프
  loop(t) {
    const dt = Math.min(0.1, Math.max(0, (t - this.last) / 1000));
    this.last = t;
    const g = this.game;
    try {
      if (!this.paused) {
        const inp = this.input.read(dt, this.inp);
        if (inp.pause && this.state === 'race') this.pause();
        g.update(dt, inp);
        const racing = g.mode === 'race' || g.mode === 'finish';
        if (racing && this.state === 'race') this.hud.update(g.hud, g, dt);
        if (g.player && g.grandpa) {
          const p = g.player, gp = g.grandpa;
          this.audio.update({
            racing, idle: g.mode === 'grid' || g.mode === 'countdown', v: p.v, throttle: p.brakeIn > 0.05 || p.state === 'crash' ? 0 : 1, brake: p.brakeIn, boost: p.boostT > 0, over: p.over,
            scrape: g.scraping > 0, gV: gp.v, gDist: Math.abs(gp.s - p.s), gSide: (p.d - gp.d) / 3,
          });
        }
      } else this.audio.update({ racing: false, idle: false });
      g.render();
    } catch (e) { this.fatal(e); return; }
    requestAnimationFrame((tt) => this.loop(tt));
  }
}

const app = new App();
window.__dh = app;
app.boot().catch((e) => app.fatal(e));
