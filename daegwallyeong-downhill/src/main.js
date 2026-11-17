// 진입점: 저장 불러오기 → 실제 지도 데이터 풀기 → 게임·UI 연결 → 메인 루프.
import { loadWorldData } from './data.js';
import { Game } from './game.js';
import { Hud } from './hud.js';
import { UI } from './ui.js';
import { Input } from './input.js';
import { GameAudio } from './audio.js';
import { loadSave, writeSave, resetSave, stageUnlocked } from './save.js';
import { STAGES, UPGRADES } from './config.js';
import { TALK } from './talk.js';
import { ICONS, pixUrl } from './px/sprites.js';
import { clamp } from './geo.js';

const $ = (id) => document.getElementById(id);
const pick = (a) => a[(Math.random() * a.length) | 0];

class App {
  constructor() {
    this.params = new URLSearchParams(location.search);
    this.speed = clamp(Math.round(Number(this.params.get('speed')) || 1), 1, 8); // 시험용 배속 (?speed=4)
    this.save = loadSave();
    this.audio = new GameAudio();
    this.audio.setEnabled(this.save.settings.sound);
    this.px = 2;
    this.fit();
    const root = document.documentElement.style;
    root.setProperty('--heart', `url(${pixUrl(ICONS.heart)})`);
    root.setProperty('--heart-off', `url(${pixUrl(ICONS.heartOff)})`);
    root.setProperty('--star', `url(${pixUrl(ICONS.star)})`);
    this.input = new Input();
    this.hud = new Hud();
    this.paused = false; this.state = 'menu'; this.dirtyWorld = false; this.inp = {}; this.last = 0;
    const unlock = () => this.audio.unlock();
    addEventListener('pointerdown', unlock); addEventListener('keydown', unlock);
    this.touch = matchMedia('(pointer:coarse)').matches || 'ontouchstart' in window;
    addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch' && !this.touch) { this.touch = true; if (this.state === 'race') this.hud.setTouch(true); } });
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.state === 'race' && !this.paused) this.pause(); });
  }

  /**
   * 도트가 뭉개지지 않게 글자 크기를 정한다: 글꼴 한 칸(1/11 em)이 화면 픽셀의 정수 배가 되도록.
   * --p = UI 도트 한 칸의 CSS 길이. 테두리·여백·아이콘은 모두 이 값의 배수로 그린다.
   */
  fit() {
    const dpr = window.devicePixelRatio || 1, vmin = Math.min(innerWidth, innerHeight), vmax = Math.max(innerWidth, innerHeight);
    const target = clamp(Math.min(vmin * 0.036, vmax * 0.022), 12, 22);
    const k = Math.max(1, Math.round((target * dpr) / 11)), ks = Math.min(k, Math.max(k - 1, Math.ceil((10 * dpr) / 11)));
    const root = document.documentElement.style, u = (n) => (11 * n) / dpr + 'px';
    this.px = k / dpr;
    root.setProperty('--p', this.px + 'px');
    root.setProperty('--fs', u(ks)); root.setProperty('--fm', u(k)); root.setProperty('--fl', u(k * 2)); root.setProperty('--fx', u(k * 3));
    root.setProperty('--logo', u(k * (vmin > 640 && innerWidth > 900 ? 5 : innerWidth > 340 ? 3 : 2)));
  }

  bootMsg(html) { const f = $('fatal'); f.style.display = html ? 'flex' : 'none'; f.innerHTML = html || ''; }

  async boot() {
    this.bootMsg('<div><b>대관령 올라가는 중</b><small id="boot-p">실제 지도 데이터를 푸는 중</small></div>');
    if (document.fonts && document.fonts.load) { try { await Promise.all([document.fonts.load('11px Galmuri11'), document.fonts.load('bold 11px Galmuri11')]); } catch (e) { /* 기본 글꼴로 계속 */ } }
    this.data = await loadWorldData();
    this.game = new Game($('gl'), this.data, (t, p) => this.onGameEvent(t, p));
    this.game.autopilot = this.params.has('auto');
    if (this.params.get('skill')) this.game.autopilotSkill = Number(this.params.get('skill'));
    this.ui = new UI(this);
    this.game.ui = (this.px * (window.devicePixelRatio || 1)) / this.game.S;
    addEventListener('resize', () => { this.fit(); this.game.resize(); this.game.ui = (this.px * (window.devicePixelRatio || 1)) / this.game.S; this.ui.relayout(); });
    const fs = $('bt-full');
    if (document.fullscreenEnabled && fs) {
      fs.style.display = 'inline-flex';
      fs.onclick = () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {}); };
    }
    const resume = this.resumeSel && stageUnlocked(this.save, this.resumeSel) ? this.resumeSel : 0;
    const want = Number(this.params.get('stage')) || resume || STAGES.reduce((m, s) => (stageUnlocked(this.save, s.id) ? s.id : m), 1);
    const st = STAGES.find((s) => s.id === want) || STAGES[0];
    this.ui.sel = st.id;
    await this.game.loadStage(st, this.save.up, this.save.settings, (p, tip) => { const el = $('boot-p'); if (el) el.textContent = `${tip || ''} ${(p * 100).toFixed(0)}%`; });
    this.bootMsg('');
    this.ui.show('title');
    requestAnimationFrame((t) => this.loop(t));
    if (this.params.has('stage')) this.startStage(st.id);
  }

  // ------------------------------------------------------------ 화면 전환
  onScreen(name) {
    if (!this.game || !this.game.world) return;
    const sel = STAGES.find((s) => s.id === this.ui.sel) || STAGES[0];
    this.game.menuHandicap = stageUnlocked(this.save, sel.id) ? sel.handicap : 'coffee';
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
    const rec = this.save.stages[g.stage.id] || {};
    g.info = { tries: rec.tries || 0, wins: rec.wins || 0 };
    g.toGrid();
    this.hud.setStage(g.stage, g.world, g.satInfo);
    this.hud.show(true); this.hud.setTouch(this.touch);
    this.state = 'race'; this.paused = false;
    // 처음 몇 판은 조작법을 띄운다
    const tries = Object.values(this.save.stages).reduce((n, r) => n + (r.tries || 0), 0);
    this.hud.help(tries < 3 ? (this.touch
      ? '<b>왼쪽 패드</b>를 좌우로 밀어 기울이기 · <b>BRAKE</b> 브레이크<br>가속은 자동 · 좌우는 바이크 기준'
      : '<b>← →</b> 기울이기 · <b>↓ / 스페이스</b> 브레이크 · <b>Shift</b> 니트로<br>가속은 자동 · 좌우는 바이크 기준') : '', 8);
    clearTimeout(this._cd);
    this._cd = setTimeout(() => { if (this.state === 'race') g.startCountdown(); }, 900);
  }
  retry() { this.paused = false; this.enterGrid(); }
  pause() { if (this.state !== 'race' || this.paused || this.game.mode === 'finish') return; this.paused = true; this.ui.show('pause'); }
  resume() { this.paused = false; this.ui.show(null); }
  quitRace() { this.paused = false; clearTimeout(this._cd); this.ui.show('levels'); }

  // ------------------------------------------------------------ 게임 이벤트
  onGameEvent(type, p) {
    if (type === 'count') { this.hud.count(p); this.audio.play(p > 0 ? 'beep' : 'go'); }
    else if (type === 'say') this.hud.say(p);
    else if (type === 'toast') this.hud.toast(p);
    else if (type === 'sfx') this.audio.play(p);
    else if (type === 'hearts') { this.hud.hearts(p); this.audio.play('deny'); }
    else if (type === 'notice') { this.ui.setLoad(0.4, p); }
    else if (type === 'finish') { this.audio.play(p.win ? 'win' : 'lose'); this.hud.toast(p.dnf ? 'TIME OVER' : p.win ? 'YOU WIN!!' : '할배 승'); }
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
      add(`남은 멘탈 ×${r.hearts}`, base * 0.08 * r.hearts);
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
    const now = r.dnf ? 0 : r.win ? 3 : r.gap <= st.pass ? 2 : 1, before = rec.stars;
    rec.stars = Math.max(rec.stars, now);
    if (r.win) rec.wins++;
    if (!r.dnf && (!rec.best || r.pTime < rec.best)) rec.best = r.pTime;
    writeSave(save);
    // 이겨도 져도 할배는 한마디 한다 (핸디캡에 맞춘 말이 먼저)
    const by = r.win ? TALK.loseBy[st.handicap] : TALK.winBy[st.handicap];
    const quote = r.win ? (st.boss || Math.random() < 0.65 ? by : pick(TALK.lose)) : Math.random() < 0.65 ? by : pick(TALK.win);
    this.state = 'result';
    this.hud.show(false); this.hud.setTouch(false);
    const nextUnlocked = stageUnlocked(save, st.id + 1);
    this.ui.renderResult(st, r, reward, quote, { stars: now, nextUnlocked, levelUp: before < 2 && now >= 2 && st.id < STAGES.length });
    this.ui.show('result');
    if (before < 2 && now >= 2) this.audio.play('buy');
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
    else if (k === 'gkey') { s.gkey = v; this.dirtyWorld = true; if (this.game) this.game.satError = ''; }
    if (k === 'assist' && this.game) this.game.assist = s.assist;
    writeSave(this.save);
  }

  resetProgress() { resetSave(this.save); this.game.refreshPlayer(this.save.up); this.ui.sel = 1; this.ui.show('title'); }

  fatal(e) {
    console.error(e);
    this.bootMsg(`<div><b>문제가 생겼습니다</b><small>${String((e && e.message) || e).replace(/</g, '&lt;')}</small><small>페이지를 새로 고쳐 보세요.</small></div>`);
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
        for (let i = 0; i < this.speed; i++) g.update(dt, inp);
        const racing = g.mode === 'race' || g.mode === 'finish';
        if (this.state === 'race' && (racing || g.mode === 'grid' || g.mode === 'countdown')) this.hud.update(g.hud, g, dt);
        if (g.player && g.grandpa) {
          const p = g.player, gp = g.grandpa;
          this.audio.update({
            racing, idle: g.mode === 'grid' || g.mode === 'countdown', v: p.v, throttle: p.brakeIn > 0.05 || p.state === 'crash' ? 0 : 1, brake: p.brakeIn, boost: p.boostT > 0, over: p.over,
            scrape: g.scraping > 0, gV: gp.v, gDist: Math.abs(gp.s - p.s), gSide: (p.d - gp.d) / 3,
          });
        }
      } else this.audio.update({ racing: false, idle: false });
      this.ui.tick(dt);
      g.render();
    } catch (e) { this.fatal(e); return; }
    requestAnimationFrame((tt) => this.loop(tt));
  }
}

const app = new App();
window.__dh = app;
const start = (data) => { if (data && Number.isInteger(data.sel)) app.resumeSel = data.sel; app.boot().catch((e) => app.fatal(e)); };
// 클로드 아티팩트 뷰어 안에서는 페이지가 새 버전으로 바뀔 때 보고 있던 레벨을 넘겨받는다 (뷰어 밖에서는 window.claude가 없다).
// 돈·개조·기록은 localStorage에 있어 그대로 남는다.
const hot = window.claude?.hot;
try { hot?.snapshot?.(() => ({ sel: app.ui ? app.ui.sel : 1 })); } catch (e) { /* 선택 기능 */ }
if (hot?.ready) hot.ready(start); else start(hot?.data ?? {});
