// 게임 본체 (도트 탑뷰): 월드, 레이스 진행, 카메라, 이펙트, 날씨, 할배 핸디캡 연출.
import { PxWorld, MPP, CH } from './px/world.js';
import { drawActor, playerModel, grandpaModel, cargoPart, obstacleModel } from './px/vox.js';
import { pxText } from './px/text.js';
import { SkyScene } from './px/sky.js';
import { INK } from './px/palette.js';
import { PlayerBike } from './physics.js';
import { Grandpa, stageReference } from './rival.js';
import { Bot } from './bot.js';
import { DS } from './track.js';
import { bikeParams, GRANDPA, WEATHERS, horsepower, totalSpent } from './config.js';
import { TalkDirector, HANDICAPS } from './talk.js';
import { clamp, mulberry32 } from './geo.js';
import { GoogleTiles } from './google.js';

// 클로드 아티팩트 뷰어 안에서는 외부 요청이 막혀 있다
const NET_OK = typeof __ARTIFACT__ === 'undefined' || !__ARTIFACT__;

const tick = () => new Promise((r) => setTimeout(r, 0));
const STEP = 1 / 120;

export class Game {
  constructor(canvas, data, hooks) {
    this.cv = canvas; this.g = canvas.getContext('2d', { alpha: false });
    this.data = data; this.track = data.track; this.hooks = hooks;
    this.sky = new SkyScene(data);
    this.ov = document.createElement('canvas'); this.og = this.ov.getContext('2d');
    this.pv = document.createElement('canvas'); this.pv.width = 72; this.pv.height = 72; this.pg = this.pv.getContext('2d');
    this.mode = 'boot'; this.time = 0; this.acc = 0; this.autopilot = false;
    this.cam = { x: 0, y: 0 }; this.shake = 0; this.vx = 0; this.vy = 0;
    this.parts = []; this.wx = [];
    this.world = null; this.stage = null; this.up = {}; this.info = {};
    this._a = {}; this._b = {}; this._q = {}; this._pp = { x: 0, y: 0, ang: 0 }; this._gp = { x: 0, y: 0, ang: 0 };
    this._list = []; this.menuHandicap = 'coffee'; this.combo = new Map();
    this.google = new GoogleTiles(); this.satOn = false; this.satInfo = ''; this.satError = ''; this.speakT = 0;
    this.resize();
  }

  emit(type, payload) { if (this.hooks) this.hooks(type, payload); }

  resize() {
    const dpr = window.devicePixelRatio || 1, W = innerWidth, H = innerHeight;
    const S = Math.max(1, Math.round((Math.min(W, H) * dpr) / 260)); // 도트 한 칸 = 화면 픽셀 S개
    this.S = S; this.vw = Math.ceil((W * dpr) / S); this.vh = Math.ceil((H * dpr) / S);
    this.cv.width = this.vw; this.cv.height = this.vh;
    this.cv.style.width = (this.vw * S) / dpr + 'px'; this.cv.style.height = (this.vh * S) / dpr + 'px';
    this.ov.width = this.vw; this.ov.height = this.vh;
    this.g.imageSmoothingEnabled = false;
    this.cssScale = S / dpr;
    this.ui = this.ui || 0.7; // UI 도트 한 칸이 게임 도트 몇 칸인지 (main.js가 넣어 준다)
    this._initWeatherFx();
  }

  // ------------------------------------------------------------------ 스테이지
  async loadStage(cfg, up, settings, onProgress = () => {}) {
    const t = this.track;
    const st = (this.stage = { ...cfg, i0: Math.round(cfg.s0 / DS), i1: Math.min(t.n - 2, Math.round(cfg.s1 / DS)) });
    st.k = cfg.k + (settings.diff || 0);
    this.mode = 'loading';
    this.weatherKey = cfg.weather; this.weather = WEATHERS[cfg.weather] || WEATHERS.day;
    onProgress(0.05, '실제 지도 펼치는 중'); await tick();
    this.world = new PxWorld(this.data, st, cfg.weather, this.weather.season);
    this.up = { ...up }; this.grip = this.weather.grip; this.assist = settings.assist ?? 0.5;
    this.reference = stageReference(t, st, this.grip);
    await this._satellite(settings, onProgress);
    this._resetRace();
    const keys = this._chunksAlong(st.i0 - 14, st.i0 + 150);
    for (let k = 0; k < keys.length; k++) {
      this.world.ensure(keys[k][0], keys[k][1]);
      if (k % 12 === 11) { onProgress(0.1 + (0.88 * k) / keys.length, '도트 찍는 중'); await tick(); }
    }
    onProgress(1, '준비 완료'); await tick();
    this.mode = 'menu';
    return st;
  }

  /** 구글 지도 키가 있으면 이 구간의 위성사진을 받아 도트 바닥으로 쓴다 */
  async _satellite(settings, onProgress) {
    this.satOn = false; this.satInfo = '';
    if (!settings.sat || !settings.gkey || !NET_OK) return;
    const t = this.track, st = this.stage, pr = this.data.proj;
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let i = Math.max(0, st.i0 - 40); i <= Math.min(t.n - 1, st.i1 + 160); i += 4) { x0 = Math.min(x0, t.X[i]); x1 = Math.max(x1, t.X[i]); z0 = Math.min(z0, t.Z[i]); z1 = Math.max(z1, t.Z[i]); }
    const a = pr.toLonLat(x0 - 110, z1 + 110), b = pr.toLonLat(x1 + 110, z0 - 110);
    try {
      this.google.setKey(settings.gkey);
      onProgress(0.06, '구글 위성사진 받는 중');
      const m = await this.google.mosaic(a[0], a[1], b[0], b[1], 3584, 19, (p) => onProgress(0.06 + p * 0.3, '구글 위성사진 받는 중'));
      this.world.setSatellite(m);
      this.satOn = true; this.satError = '';
      this.satInfo = this.google.copyright || `지도 데이터 ©${new Date().getFullYear()} Google`;
    } catch (e) {
      this.satError = String((e && e.message) || e);
      this.emit('notice', '위성사진을 받지 못해 기본 바닥으로 그립니다');
    }
  }

  _chunksAlong(ia, ib) {
    const w = this.world, t = this.track, set = new Map(), o = {}, hx = this.vw / 2 + CH * 0.5, hy = this.vh / 2 + CH * 0.5;
    for (let i = Math.max(0, ia); i <= Math.min(t.n - 1, ib); i += 6) {
      w.toPx(t.X[i], t.Z[i], o);
      for (let cy = Math.floor((o.y - hy) / CH); cy <= Math.floor((o.y + hy) / CH); cy++) for (let cx = Math.floor((o.x - hx) / CH); cx <= Math.floor((o.x + hx) / CH); cx++) set.set(cx + ',' + cy, [cx, cy]);
    }
    return [...set.values()];
  }

  _resetRace() {
    const st = this.stage, t = this.track;
    this.player = new PlayerBike(t, bikeParams(this.up), { assist: this.assist });
    this.player.place(st.s0 - 6, -2.4);
    this.player.finished = false;
    this.grandpa = new Grandpa(t, st, this.reference);
    this.bot = new Bot(t, this.reference, bikeParams(this.up), { skill: this.autopilotSkill || 0.9, grip: this.grip, assist: this.assist });
    this.raceT = 0; this.pFinish = 0; this.finT = 0; this.resultSent = false;
    this.corners = t.corners.filter((c) => c.i1 > st.i0 && c.i0 < st.i1);
    this.cornerIdx = 0; this.dirty = false; this.clean = 0; this.streak = 0; this.bumpCool = 0; this.overtakes = 0; this.led = 0;
    this.tagT = 5; this.hearts = 5; this.heartCool = 0; this.brakeT = 0; this.brakeSaid = false; this.slideT = 0; this.slideCool = 0; this.zT = 0;
    this.obst = this._makeObstacles();
    this.talk = new TalkDirector({ stageId: st.id, weather: this.weatherKey, tries: this.info.tries || 0, wins: this.info.wins || 0, spent: totalSpent(this.up), hp: horsepower(this.up), sticker: !!this.up.sticker });
    this.parts.length = 0; this.lastSkid = [null, null];
    this._frames(0);
    this.cam.x = this._pp.x; this.cam.y = this._pp.y - 20;
    this.gates = this._makeGates();
    this.hud = { speed: 0, corner: null, warn: null, hearts: 5 };
    this._hudState();
  }

  /** 개조 후 모델 갱신 */
  refreshPlayer(up) {
    this.up = { ...up };
    if (this.world) { this.player = new PlayerBike(this.track, bikeParams(this.up), { assist: this.assist }); this.player.place(this.stage.s0 - 6, -2.4); this.player.finished = false; }
  }
  toGrid() { this._resetRace(); this.mode = 'grid'; }
  startCountdown() { this.mode = 'countdown'; this.countT = 3.2; this.lastCount = 4; }

  _makeObstacles() {
    const st = this.stage, t = this.track, kind = st.obstacles, list = [];
    if (!kind) return list;
    const rnd = mulberry32(st.id * 991 + 7), full = st.i1 - st.i0 > 3000, types = kind === 'mixed' ? ['rocks', 'deer', 'tractor'] : [kind];
    const gapOf = { rocks: 85, deer: 110, tractor: 190 };
    let i = st.i0 + 80, n = 0;
    while (i < st.i1 - 70) {
      const type = types[n % types.length], win = Math.round((gapOf[type] || 100) * (full ? 2.6 : 1));
      let best = -1, bestK = 1e9;
      for (let j = i; j < Math.min(st.i1 - 60, i + win); j += 2) {
        let k = 0;
        for (let m = -8; m <= 10; m += 2) k = Math.max(k, Math.abs(t.K[clamp(j + m, 0, t.n - 1)]));
        if (k < bestK) { bestK = k; best = j; }
      }
      if (best > 0 && bestK < 0.03 && !t.BR[best] && rnd() > 0.15) {
        const hw = t.HW[best];
        if (type === 'rocks') list.push({ kind: 'rock', s: best * DS, d: (rnd() < 0.5 ? -1 : 1) * (hw * 0.28 + rnd() * hw * 0.3), w: 1.2, len: 1.4, label: '낙석', ang: rnd() * 6.28 });
        else if (type === 'deer') list.push({ kind: 'deer', s: best * DS, d: hw + 2.5, w: 0.8, len: 1.8, label: '고라니', phase: 0, t: 0, from: rnd() < 0.5 ? 1 : -1, hw });
        else list.push({ kind: 'tractor', s: best * DS, d: -hw * 0.5, w: 1.3, len: 3.8, label: '경운기', v: 4.2 });
      }
      i += win; n++;
    }
    return list;
  }

  _makeGates() {
    return this.world.gates.map((gt) => {
      const pad = 8, x0 = Math.floor(Math.min(gt.ax, gt.bx)) - pad, y0 = Math.floor(Math.min(gt.ay, gt.by)) - 21 - pad;
      const w = Math.ceil(Math.abs(gt.bx - gt.ax)) + pad * 2, h = Math.ceil(Math.abs(gt.by - gt.ay)) + pad * 2;
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d'), img = g.createImageData(w, h), D = img.data;
      const ax = gt.ax - x0, ay = gt.ay - 21 - y0, dx = gt.bx - gt.ax, dy = gt.by - gt.ay, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const rx = x - ax, ry = y - ay, u = rx * ux + ry * uy, v = -rx * uy + ry * ux;
        if (u < -1 || u > L + 1 || v < -5.5 || v > 5.5) continue;
        const p = (y * w + x) * 4, edge = v < -4.5 || v > 4.5 || u < 0 || u > L;
        const chk = (Math.floor(u / 4) + (v > 0 ? 1 : 0)) & 1;
        const col = edge ? [43, 20, 100] : gt.finish ? (chk ? [255, 255, 255] : [43, 20, 100]) : (chk ? [255, 90, 122] : [255, 255, 255]);
        D[p] = col[0]; D[p + 1] = col[1]; D[p + 2] = col[2]; D[p + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      return { c, x: x0, y: y0, sortY: Math.max(gt.ay, gt.by) + 2 };
    });
  }

  // ------------------------------------------------------------------ 갱신
  update(dt, input) {
    dt = Math.min(dt, 0.1);
    this.time += dt;
    if (this.mode === 'boot' || this.mode === 'loading') return;
    if (this.mode === 'menu' || this.mode === 'garage') { this.sky.update(dt); return; }
    if (this.mode === 'grid') { this._frames(dt); this._camera(dt); this._hudState(); }
    else if (this.mode === 'countdown') {
      this.countT -= dt;
      const n = Math.ceil(this.countT);
      if (n !== this.lastCount) { this.lastCount = n; this.emit('count', n); }
      this._frames(dt); this._camera(dt); this._hudState();
      if (this.countT <= 0) { this.mode = 'race'; this.raceT = 0; this.acc = 0; this._say(this.talk.event('start', this.stage.handicap, true)); }
    } else if (this.mode === 'race' || this.mode === 'finish') {
      this.acc += dt;
      let n = 0;
      while (this.acc >= STEP && n < 12) { this._step(STEP, input); input.boost = false; this.acc -= STEP; n++; }
      if (n === 12) this.acc = 0;
      this._frames(dt); this._effects(dt); this._camera(dt); this._hudState();
      if (this.mode === 'finish') { this.finT += dt; if (this.finT > 2.6 && !this.resultSent) { this.resultSent = true; this.emit('result', this.result); } }
    }
    this._particles(dt);
    this.shake = Math.max(0, this.shake - dt * 2.4);
    // 할배 머리 위 상태 글씨는 상황이 바뀔 때 잠깐, 그리고 가끔 한 번씩만 띄운다
    this.tagT -= dt; if (this.tagT < -11) this.tagT = 3;
    this.speakT = Math.max(0, this.speakT - dt);
  }

  _say(line) { if (line) { this.speakT = 2.4 + line.length * 0.06; this.emit('say', line); } }

  _step(h, input) {
    const p = this.player, g = this.grandpa, st = this.stage;
    this.raceT += h;
    let inp = input;
    if (this.autopilot || p.finished) {
      inp = this.bot.control(p, (this._bi ||= {}));
      if (p.finished) { inp.throttle = p.v < 11 ? 0.5 : 0; inp.brake = p.v > 16 ? 0.6 : 0; inp.boost = false; }
      else if (p.nitroLeft > 0 && Math.abs(this.track.curvatureAt(p.s + 60)) < 0.003 && p.v > 25) inp.boost = true;
    }
    const gap = g.s - p.s;
    const draft = gap > 4 && gap < 22 && Math.abs(g.d - p.d) < 2 ? 1 - (gap - 4) / 18 : 0;
    p.update(h, inp, { grip: this.grip, draft, locked: false });
    g.update(h, this.raceT, p, this.obst);
    this._obstacles(h);
    // 할배와 접촉: 할배는 꿈쩍도 안 한다
    this.bumpCool -= h; this.heartCool -= h; this.slideCool -= h;
    if (Math.abs(gap) < 4.6 && Math.abs(g.d - p.d) < 1.9 && p.state === 'ride') {
      p.d += Math.sign(p.d - g.d || 1) * 4 * h;
      if (gap > 0 && p.v > g.v - 0.3) p.v = Math.max(0, g.v - 0.3);
      if (this.bumpCool <= 0) { this.bumpCool = 3.5; this._say(this.talk.event('bump', g.handicap)); this.emit('sfx', 'scrape'); this.shake = Math.max(this.shake, 0.3); }
    }
    if (gap < -2.5) this.led += h;
    // 플레이어 사건
    for (const e of p.events) {
      if (e.type === 'crash') {
        this.dirty = true; this.streak = 0; this.shake = 1; this.emit('sfx', 'crash'); this._loseHeart();
        this.emit('toast', e.reason === 'deer' ? '고라니!!' : e.reason === 'rock' ? '낙석!' : e.reason === 'tractor' ? '경운기…!' : 'CRASH!');
        this._say(this.talk.event('crash', g.handicap, true));
        for (let k = 0; k < 28; k++) this._spawn('spark', this._pp.x, this._pp.y - 4, (Math.random() - 0.5) * 120, (Math.random() - 0.5) * 120, 0.3 + Math.random() * 0.4, k % 3 ? '#ffd23f' : '#ffffff');
        for (let k = 0; k < 8; k++) this._spawn('smoke', this._pp.x + (Math.random() - 0.5) * 10, this._pp.y + (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 20, -10 - Math.random() * 14, 0.7 + Math.random() * 0.5, '#e8e2f6', 3);
      } else if (e.type === 'scrapeStart') {
        this.dirty = true; this.streak = 0; this.shake = Math.max(this.shake, 0.35 + e.vn * 0.08); this.emit('sfx', 'scrape');
        this._say(this.talk.event('scrape', g.handicap));
      } else if (e.type === 'scrape') this.scraping = 0.08;
      else if (e.type === 'nitro') { this.emit('sfx', 'nitro'); this.emit('toast', 'NITRO!'); this._say(this.talk.event('nitro', g.handicap, true)); }
    }
    p.events.length = 0;
    // 브레이크를 길게 잡거나 코너에서 밀리면 한 소리 듣는다
    if (inp.brake > 0.5 && p.v > 8 && !p.finished) { this.brakeT += h; if (this.brakeT > 1.3 && !this.brakeSaid) { this.brakeSaid = true; this._say(this.talk.event('brakeLong', g.handicap)); } } else { this.brakeT = 0; this.brakeSaid = false; }
    if (p.over > 0.55 && p.v > 12) { this.slideT += h; if (this.slideT > 0.5 && this.slideCool <= 0) { this.slideCool = 9; this._say(this.talk.event('slide', g.handicap)); } } else this.slideT = 0;
    // 할배 사건
    for (const e of g.events) {
      const H = HANDICAPS[g.handicap] || HANDICAPS.coffee;
      if (e.type === 'overtake') { this.emit('sfx', 'horn'); this.overtakes++; this._loseHeart(true); this._say(this.talk.event('overtake', g.handicap, true)); }
      else if (e.type === 'overtaken') this._say(this.talk.event('overtaken', g.handicap, true));
      else if (e.type === 'effort') { this.tagT = 4; this.emit('sfx', 'wake'); this.emit('toast', H.effort || '할배가 한 손을 썼다!'); this._say(this.talk.event('effort', g.handicap)); }
      else if (e.type === 'lazy') { this.tagT = 4.5; this._say(this.talk.event('lazy', g.handicap)); }
      else if (e.type === 'medley') { this.tagT = 5; this.emit('toast', `핸디캡 교체: ${H.name}`); this.emit('sfx', 'click'); this._say(this.talk.event('medley', g.handicap)); }
      else if (e.type === 'serious') { this.tagT = 6; this.emit('toast', '할배가 핸들을 잡았다!!'); this.emit('sfx', 'wake'); this.shake = 0.6; this._say(this.talk.event('by', 'serious', true)); }
    }
    g.events.length = 0;
    // 평소 트래시토크
    if (!p.finished && !g.finished) this._say(this.talk.tick(h, { gap, progress: (p.s - st.s0) / (st.s1 - st.s0), hearts: this.hearts, handicap: g.handicap }));
    // 클린 코너
    while (this.cornerIdx < this.corners.length && p.s > this.corners[this.cornerIdx].s1 + 4) {
      const c = this.corners[this.cornerIdx++];
      if (c.s0 < st.s0 || c.rMin > 60) { this.dirty = false; continue; }
      if (!this.dirty) { this.clean++; this.streak++; if (this.streak >= 3 && !p.finished) { this.emit('toast', `CLEAN ×${this.streak}`); this.emit('sfx', 'clean'); } }
      this.dirty = false;
    }
    // 결승
    if (!p.finished && p.s >= st.s1) { p.finished = true; this.pFinish = this.raceT; this.emit('sfx', 'coin'); }
    if (this.mode === 'race') {
      const dnf = g.finished && !p.finished && this.raceT - g.finishTime > 25;
      if ((p.finished && (g.finished || this.raceT - this.pFinish > 5)) || dnf) {
        const gTime = g.finished ? g.finishTime : this.raceT + (st.s1 - g.s) / Math.max(8, g.v);
        const pTime = dnf ? this.raceT : this.pFinish, win = !dnf && pTime < gTime;
        const H = HANDICAPS[st.handicap] || HANDICAPS.coffee;
        let sinc = H.sincerity + Math.round((g.effortTime / Math.max(1, this.raceT)) * 28);
        sinc = st.boss ? (win ? 100 : Math.min(60, 30 + sinc)) : Math.min(19, sinc);
        this.result = {
          win, dnf, pTime, gTime, gap: pTime - gTime, crashes: p.stats.crashes, scrapes: p.stats.scrapes, clean: this.clean,
          topSpeed: p.stats.topSpeed * 3.6, boosts: p.stats.boosts, led: this.led, overtakes: this.overtakes, hearts: this.hearts, sincerity: sinc, handicap: st.handicap, lines: this.talk.count,
        };
        this.mode = 'finish'; this.finT = 0;
        this.emit('finish', this.result);
      }
    }
  }

  _loseHeart(soft) {
    if (this.hearts <= 0 || (soft && this.heartCool > 0)) return;
    this.heartCool = 7; this.hearts--;
    this.emit('hearts', this.hearts);
  }

  _obstacles(h) {
    const p = this.player, t = this.track, g = this.grandpa;
    for (const ob of this.obst) {
      if (ob.kind === 'tractor') { if (ob.s < this.stage.s1 + 100) ob.s += ob.v * h; }
      else if (ob.kind === 'deer') {
        if (ob.phase === 0 && ob.s - p.s < 66 && ob.s - p.s > 0) { ob.phase = 1; ob.t = 0; ob.d = ob.from * (ob.hw + 2.5); this.emit('sfx', 'deer'); }
        if (ob.phase > 0 && ob.phase < 4) {
          ob.t += h;
          const stopD = ob.from * -0.8;
          if (ob.phase === 1) { ob.d -= ob.from * 9 * h; if ((ob.from > 0 && ob.d <= stopD) || (ob.from < 0 && ob.d >= stopD)) { ob.phase = 2; ob.t = 0; } }
          else if (ob.phase === 2) { if (ob.t > 0.8) ob.phase = 3; }
          else { ob.d -= ob.from * 12 * h; if (Math.abs(ob.d) > ob.hw + 5) ob.phase = 4; }
        }
      }
      if (ob.kind === 'deer' && (ob.phase === 0 || ob.phase === 4)) continue;
      const ds = ob.s - p.s;
      if (!ob.said && ds > 0 && ds < 85) { ob.said = true; this._say(this.talk.event(ob.kind, g.handicap)); }
      if (Math.abs(ds) < ob.len + 1.6 && Math.abs(ob.d - p.d) < ob.w + 0.75 && p.state === 'ride' && p.invuln <= 0) p.crash(ob.kind);
    }
    void t;
  }

  // ------------------------------------------------------------------ 위치·카메라
  /** 두 바이크의 화면 좌표와 방향을 계산한다 */
  _frames() {
    const t = this.track, w = this.world, p = this.player, g = this.grandpa, o = this._q;
    let a = t.at(p.s, 0, this._a);
    const lim = a.hw - 1.0;
    a = t.at(p.s, clamp(p.d, -lim, lim), this._a);
    const cs = Math.cos(p.psi), sn = Math.sin(p.psi);
    a.fx = a.tx * cs + a.nx * sn; a.fz = a.tz * cs + a.nz * sn;
    w.toPx(a.x, a.z, o);
    this._pp.x = o.x; this._pp.y = o.y; this._pp.ang = w.angleOf(a.fx, a.fz);
    const b = t.at(g.s, clamp(g.d, -lim, lim), this._b);
    w.toPx(b.x, b.z, o);
    this._gp.x = o.x; this._gp.y = o.y; this._gp.ang = w.angleOf(b.tx, b.tz);
  }

  _camera(dt) {
    const p = this.player, t = this.track, w = this.world, a = this._a, o = this._q;
    const lead = clamp(p.v * 1.15, 2, 42), b = t.at(Math.min(p.s + 26, t.length - 1), 0, this._b);
    let dx = (a.fx ?? a.tx) * 0.55 + b.tx * 0.45, dz = (a.fz ?? a.tz) * 0.55 + b.tz * 0.45;
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    w.toPx(a.x + dx * lead, a.z + dz * lead, o);
    // 바이크가 화면 밖으로 밀려나지 않게: 앞보기 거리를 화면 크기에 맞춰 타원으로 제한한다
    let lx = o.x - this._pp.x, ly = o.y - this._pp.y;
    const e = Math.hypot(lx / (this.vw * 0.3), ly / (this.vh * 0.3));
    if (e > 1) { lx /= e; ly /= e; }
    const k = 1 - Math.exp(-dt * 3.4);
    this.cam.x += (this._pp.x + lx - this.cam.x) * k; this.cam.y += (this._pp.y + ly - this.cam.y) * k;
    // 진행 방향 앞쪽 청크를 미리 구워 둔다
    const a2 = t.at(Math.min(p.s + 50 + p.v * 1.2, t.length - 1), 0, this._b);
    w.toPx(a2.x, a2.z, o);
    w.ensureRect(o.x - this.vw / 2 - 8, o.y - this.vh / 2 - 8, o.x + this.vw / 2 + 8, o.y + this.vh / 2 + 8, 1);
  }

  // ------------------------------------------------------------------ 이펙트
  _spawn(kind, x, y, vx, vy, life, col, size = 1, txt = null) {
    if (this.parts.length > 420) this.parts.shift();
    this.parts.push({ kind, x, y, vx, vy, life, max: life, col, size, txt });
  }
  _particles(dt) {
    const a = this.parts;
    for (let i = a.length - 1; i >= 0; i--) {
      const p = a[i];
      p.life -= dt;
      if (p.life <= 0) { a.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.kind === 'spark') { p.vy += 160 * dt; } else if (p.kind === 'smoke') { p.size += 5 * dt; p.vx *= 1 - 2 * dt; }
    }
  }
  _skid(idx, x, y, on, alpha) {
    const last = this.lastSkid[idx];
    if (on) {
      if (last) { const n = Math.max(1, Math.ceil(Math.hypot(x - last[0], y - last[1]))); for (let k = 1; k <= n; k++) this.world.skid(last[0] + ((x - last[0]) * k) / n, last[1] + ((y - last[1]) * k) / n, alpha); }
      this.lastSkid[idx] = [x, y];
    } else this.lastSkid[idx] = null;
  }
  _effects(dt) {
    const p = this.player, g = this.grandpa, P = this._pp, Gp = this._gp;
    const rear = (F, k) => [F.x - Math.sin(F.ang) * k, F.y + Math.cos(F.ang) * k];
    // 타이어 자국과 연기
    const pSkid = p.state === 'ride' && p.v > 9 && (Math.abs(p.lean) > 0.62 || p.over > 0.35 || (p.brakeIn > 0.5 && p.v > 13));
    const pr = rear(P, 8);
    this._skid(0, pr[0], pr[1], pSkid, 0.34);
    if (pSkid && Math.random() < dt * 26) this._spawn('smoke', pr[0], pr[1], (Math.random() - 0.5) * 12, -6 - Math.random() * 8, 0.45 + Math.random() * 0.3, '#f0eafc', 2);
    const gSkid = g.v > 8 && Math.abs(g.lean) > 0.7, gr = rear(Gp, 8);
    this._skid(1, gr[0], gr[1], gSkid, 0.28);
    if (Math.abs(g.lean) > 0.86 && g.v > 8 && Math.random() < dt * 40) this._spawn('spark', gr[0], gr[1], (Math.random() - 0.5) * 60, -20 - Math.random() * 50, 0.25 + Math.random() * 0.25, '#ffd23f');
    this.scraping = Math.max(0, (this.scraping || 0) - dt);
    if (this.scraping > 0) for (let k = 0; k < 2; k++) this._spawn('spark', P.x, P.y - 3, (Math.random() - 0.5) * 90, -30 - Math.random() * 60, 0.2 + Math.random() * 0.3, k ? '#ffd23f' : '#ffffff');
    if (p.boostT > 0) for (let k = 0; k < 2; k++) this._spawn('flame', pr[0], pr[1] - 4, -Math.sin(P.ang) * -50 + (Math.random() - 0.5) * 20, Math.cos(P.ang) * 50 + (Math.random() - 0.5) * 20, 0.22, k ? '#7fe0ff' : '#ff7fd8', 2);
    // 딴짓하거나 자는 할배
    this.zT -= dt;
    if (this.zT <= 0 && (g.lazy || g.handicap === 'nap')) { this.zT = 0.7; this._spawn('txt', Gp.x + 8, Gp.y - 30, 6, -14, 1.4, '#ffffff', 1, g.handicap === 'nap' ? 'Z' : '♪'); }
  }

  // ------------------------------------------------------------------ 그리기
  render() {
    const g = this.g;
    if (this.mode === 'boot' || this.mode === 'loading') return;
    if (this.mode === 'menu' || this.mode === 'garage') {
      this.sky.draw(g, this.vw, this.vh, { player: playerModel(this.up), grandpa: this._grandpaParts(this.menuHandicap === 'medley' ? 'eggtower' : this.menuHandicap, false) }, this.mode === 'garage' ? 0.25 : 0, Math.round(this.vh * 0.08));
      if (this.mode === 'garage') {
        // 차고: 내 바이크를 크게 돌려 보여 준다
        const pg = this.pg; pg.clearRect(0, 0, 72, 72);
        drawActor(pg, 36, 52, playerModel(this.up), this.time * 0.8, 0.25, this.time);
        const k = clamp(Math.round(Math.min(this.vw, this.vh) / 70), 2, 6), wide = this.vw > this.vh * 1.2;
        g.drawImage(this.pv, Math.round((wide ? this.vw * 0.26 : this.vw * 0.5) - 36 * k), Math.round(this.vh * (wide ? 0.5 : 0.16) - 36 * k), 72 * k, 72 * k);
      }
      return;
    }
    this._drawRace();
  }

  _grandpaParts(hc, effort) {
    const frame = Math.floor(this.time * 3) & 1, lazy = this.grandpa && this.grandpa.lazy;
    const n = hc === 'nap' ? 64 : hc === 'eggtower' && lazy ? 104 : 90, key = hc + (effort ? 'e' : '') + frame + n;
    let parts = this.combo.get(key);
    if (!parts) {
      parts = grandpaModel(hc, effort, frame, n);
      const cg = (HANDICAPS[hc] || {}).cargo;
      if (cg) parts = [...parts, cargoPart(cg)];
      this.combo.set(key, parts);
    }
    return parts;
  }

  _drawRace() {
    const g = this.g, w = this.world, vw = this.vw, vh = this.vh, p = this.player, gp = this.grandpa, P = this._pp, Gp = this._gp;
    const sh = this.shake * 5;
    const vx = Math.round(this.cam.x - vw / 2 + (Math.random() - 0.5) * sh), vy = Math.round(this.cam.y - vh / 2 + (Math.random() - 0.5) * sh);
    this.vx = vx; this.vy = vy;
    w.ensureRect(vx - 8, vy - 8, vx + vw + 8, vy + vh + 8, 4);
    const base = w.pal.land[1][1];
    g.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`; g.fillRect(0, 0, vw, vh);
    for (let cy = Math.floor(vy / CH); cy <= Math.floor((vy + vh) / CH); cy++) for (let cx = Math.floor(vx / CH); cx <= Math.floor((vx + vw) / CH); cx++) {
      const c = w.chunk(cx, cy);
      if (c) g.drawImage(c, cx * CH - vx, cy * CH - vy);
    }
    // LED 언더글로우
    if (this.up.led) { g.fillStyle = `hsla(${(this.time * 80) % 360},100%,65%,0.55)`; g.fillRect(Math.round(P.x - vx) - 6, Math.round(P.y - vy) - 5, 13, 11); }
    // y 순서대로: 장애물, 바이크, 게이트 현수막
    const list = this._list; list.length = 0;
    const t = this.track, o = this._q, a = {};
    for (const ob of this.obst) {
      if (ob.kind === 'deer' && (ob.phase === 0 || ob.phase === 4)) continue;
      t.at(ob.s, ob.d, a); w.toPx(a.x, a.z, o);
      const x = o.x - vx, y = o.y - vy;
      if (x < -50 || y < -50 || x > vw + 50 || y > vh + 70) continue;
      let ang = ob.kind === 'rock' ? ob.ang : w.angleOf(a.tx, a.tz), hop = 0;
      if (ob.kind === 'deer') { ang += ob.phase === 2 ? Math.PI : ob.from > 0 ? Math.PI / 2 : -Math.PI / 2; hop = ob.phase === 2 ? 0 : Math.round(Math.abs(Math.sin(ob.t * 14)) * 3); }
      list.push({ y: o.y, k: 0, m: obstacleModel(ob.kind), x, sy: y - hop, ang });
    }
    for (const gt of this.gates) list.push({ y: gt.sortY, k: 1, gt });
    list.push({ y: Gp.y, k: 2 }); list.push({ y: P.y, k: 3 });
    list.sort((u, v) => u.y - v.y);
    for (const it of list) {
      if (it.k === 0) drawActor(g, it.x, it.sy, it.m, it.ang, 0, this.time);
      else if (it.k === 1) g.drawImage(it.gt.c, it.gt.x - vx, it.gt.y - vy);
      else if (it.k === 2) {
        const jig = gp.kicking && this.mode !== 'menu' ? Math.round(Math.sin(this.time * 44)) : 0;
        drawActor(g, Gp.x - vx + jig, Gp.y - vy, this._grandpaParts(gp.handicap, gp.effort), Gp.ang + clamp(gp.lean * 0.22, -0.3, 0.3), gp.lean * 0.9, this.time, gp.handicap === 'serious' ? '#ff2a4a' : INK);
      } else {
        const crash = p.state === 'crash', blink = p.invuln > 0 && !crash && Math.floor(this.time * 12) % 2 === 0;
        drawActor(g, P.x - vx, P.y - vy, playerModel(this.up), P.ang + (crash ? p.crashT * 9 : clamp(p.lean * 0.28, -0.32, 0.32)), crash ? 0 : p.lean * 0.9, this.time, INK, blink ? 0.4 : 1);
      }
    }
    // 계란탑 뒤에 내 바이크가 가려지면 비쳐 보이게 한 번 더 그린다
    if ((gp.handicap === 'eggtower' || gp.handicap === 'nap') && Gp.y > P.y && Gp.y - P.y < 118 && Math.abs(Gp.x - P.x) < 22 && p.state !== 'crash') {
      drawActor(g, P.x - vx, P.y - vy, playerModel(this.up), P.ang + clamp(p.lean * 0.28, -0.32, 0.32), p.lean * 0.9, this.time, '#ffe14a', 0.6);
    }
    // 풍력발전기 날개
    g.fillStyle = '#ffffff';
    for (const tb of w.turbines) {
      const x = tb.x - vx, y = tb.y - vy;
      if (x < -30 || y < -30 || x > vw + 30 || y > vh + 30) continue;
      for (let b = 0; b < 3; b++) { const an = this.time * 1.6 + tb.ph + (b * Math.PI * 2) / 3; for (let q = 2; q <= 24; q++) g.fillRect(Math.round(x + Math.cos(an) * q), Math.round(y + Math.sin(an) * q * 0.85), 2, 1); }
    }
    // 입자
    for (const pt of this.parts) {
      const x = Math.round(pt.x - vx), y = Math.round(pt.y - vy), f = pt.life / pt.max;
      if (pt.kind === 'txt') { g.globalAlpha = Math.min(1, f * 2); g.drawImage(pxText(pt.txt, pt.col), x, y); g.globalAlpha = 1; continue; }
      g.fillStyle = pt.col;
      if (pt.kind === 'smoke') { const s = Math.round(pt.size); g.globalAlpha = f * 0.75; g.fillRect(x - (s >> 1), y - (s >> 1), s, s); g.globalAlpha = 1; }
      else g.fillRect(x, y, pt.size, pt.size);
    }
    this._weatherOverlay(vx, vy);
    // 할배 상태 표시와 화면 밖 화살표
    const gx = Gp.x - vx, gy = Gp.y - vy, H = HANDICAPS[gp.handicap] || HANDICAPS.coffee;
    if (this.mode !== 'grid' && this.mode !== 'countdown') {
      if (gx > 6 && gy > 6 && gx < vw - 6 && gy < vh - 6) {
        const tag = gp.lazy ? H.lazy : H.tag;
        if (tag && this.tagT > 0) { const c = pxText(tag, gp.effort ? '#ffe14a' : '#ffffff'); g.drawImage(c, clamp(Math.round(gx + 14), 2, vw - c.width - 2), Math.round(gy - 20)); }
        if (this.speakT > 0) {
          // 말하는 중: 머리 위 말풍선
          const bx = Math.round(gx - 20), by = Math.round(gy - 34 - (Math.floor(this.time * 6) & 1));
          g.fillStyle = INK; g.fillRect(bx - 1, by, 15, 9); g.fillRect(bx, by - 1, 13, 11); g.fillRect(bx + 9, by + 10, 2, 2);
          g.fillStyle = '#ffffff'; g.fillRect(bx, by, 13, 9); g.fillRect(bx + 9, by + 9, 2, 1);
          g.fillStyle = '#ff7fd8'; for (let q = 0; q < 3; q++) g.fillRect(bx + 2 + q * 4, by + 3, 2, 2);
        }
      } else if (!this.resultSent) {
        // 화면 밖에 있으면 가장자리에 방향과 거리를 띄운다 (왼쪽 위 HUD, 오른쪽 위 미니맵은 피해서)
        const u = this.ui, ex = clamp(gx, 16, vw - 16);
        let ey = clamp(gy, 30, vh - 30);
        if (ex < vw * (vh > vw ? 0.94 : 0.47)) ey = Math.max(ey, 150 * u); else if (ex > vw - 84 * u) ey = Math.max(ey, 112 * u);
        ey = Math.min(ey, vh - 30);
        const c = pxText(`할배 ${Math.abs(Math.round(gp.s - p.s))}m`, '#ffe14a');
        g.drawImage(c, clamp(Math.round(ex - c.width / 2), 2, vw - c.width - 2), Math.round(ey - 6));
        g.fillStyle = '#ffe14a';
        const up = gy < 6 ? -1 : gy > vh - 6 ? 1 : 0, sd = gx < 6 ? -1 : gx > vw - 6 ? 1 : 0;
        for (let q = 0; q < 4; q++) g.fillRect(Math.round(ex + sd * (c.width / 2 + 6) - (sd ? 0 : q)), Math.round(ey + up * 12 + (up ? -up * q : 0) - (sd ? q : 0)), sd ? 1 : q * 2 + 1, sd ? q * 2 + 1 : 1);
      }
    }
  }

  _initWeatherFx() {
    const r = mulberry32(9);
    this.wx = Array.from({ length: 150 }, () => ({ x: r() * this.vw, y: r() * this.vh, s: 0.6 + r() * 0.8, p: r() * 6.28 }));
  }
  _weatherOverlay(vx, vy) {
    const g = this.g, vw = this.vw, vh = this.vh, wk = this.weatherKey, tm = this.time;
    if (wk === 'autumn' || wk === 'sunset') {
      for (let i = 0; i < 46; i++) { const f = this.wx[i], x = (((f.x + tm * 14 * f.s + Math.sin(tm * 1.3 + f.p) * 8 - vx * 0.5) % vw) + vw) % vw, y = (((f.y + tm * 22 * f.s - vy * 0.5) % vh) + vh) % vh; g.fillStyle = i % 3 ? '#ff9a3c' : '#e8506e'; g.fillRect(x | 0, y | 0, 2, 1); }
    } else if (wk === 'rain') {
      g.fillStyle = 'rgba(40,50,120,0.16)'; g.fillRect(0, 0, vw, vh);
      g.fillStyle = 'rgba(210,225,255,0.75)';
      for (const f of this.wx) { const x = (((f.x - tm * 60 * f.s - vx * 0.6) % vw) + vw) % vw, y = (((f.y + tm * 320 * f.s - vy * 0.6) % vh) + vh) % vh; g.fillRect(x | 0, y | 0, 1, 4); }
    }
    if (wk !== 'night' && wk !== 'fog') return;
    const og = this.og, P = this._pp, Gp = this._gp;
    og.globalCompositeOperation = 'source-over';
    og.clearRect(0, 0, vw, vh);
    og.fillStyle = wk === 'night' ? 'rgba(16,6,58,0.8)' : 'rgba(214,218,236,0.92)';
    og.fillRect(0, 0, vw, vh);
    og.globalCompositeOperation = 'destination-out';
    const hole = (x, y, r, al) => { og.fillStyle = `rgba(0,0,0,${al})`; og.beginPath(); og.arc(x, y, r, 0, 7); og.fill(); };
    if (wk === 'fog') { for (const [r, al] of [[150, 0.3], [118, 0.45], [88, 1]]) hole(P.x - vx, P.y - vy, r, al); hole(Gp.x - vx, Gp.y - vy, 30, 0.6); }
    else {
      const cone = (F, len, half, al) => {
        const x = F.x - vx, y = F.y - vy, dx = Math.sin(F.ang), dy = -Math.cos(F.ang);
        og.fillStyle = `rgba(0,0,0,${al})`; og.beginPath(); og.moveTo(x - dx * 6, y - dy * 6);
        for (let k = -4; k <= 4; k++) { const an = F.ang + (half * k) / 4; og.lineTo(x + Math.sin(an) * len, y - Math.cos(an) * len); }
        og.closePath(); og.fill();
      };
      for (const [k, al] of [[1.25, 0.3], [1.08, 0.45], [0.9, 1]]) { cone(P, 150 * k, 0.5 * k, al); cone(Gp, 96 * k, 0.42 * k, al); }
      hole(P.x - vx, P.y - vy, 26, 1); hole(Gp.x - vx, Gp.y - vy, 22, 1);
    }
    g.drawImage(this.ov, 0, 0);
  }

  /** UI용 미리보기 캔버스에 모델을 그린다 */
  preview(canvas, who, t) {
    const c = canvas.getContext('2d'); c.imageSmoothingEnabled = false;
    c.clearRect(0, 0, canvas.width, canvas.height);
    const parts = who === 'player' ? playerModel(this.up) : this._grandpaParts(who === 'medley' ? ['eggtower', 'dog', 'feet', 'boxes2'][Math.floor(t / 1.5) % 4] : who, false);
    drawActor(c, canvas.width >> 1, canvas.height - 16, parts, t * 0.9, 0.2, t);
  }

  _hudState() {
    const p = this.player, g = this.grandpa, st = this.stage, h = this.hud;
    h.speed = p.v * 3.6; h.time = p.finished ? this.pFinish : this.raceT;
    h.gapM = p.s - g.s;
    h.gapS = h.gapM / Math.max(12, (p.v + g.v) / 2);
    h.pp = clamp((p.s - st.s0) / (st.s1 - st.s0), 0, 1); h.pg = clamp((g.s - st.s0) / (st.s1 - st.s0), 0, 1);
    h.nitro = p.nitroLeft; h.boost = p.boostT > 0; h.draft = p.draft > 0.25; h.over = p.over > 0.3 && p.v > 10; h.wake = g.effort; h.wait = g.lazy; h.hearts = this.hearts;
    const H = HANDICAPS[g.handicap] || HANDICAPS.coffee;
    h.tag = g.effort ? H.effort : g.lazy ? H.lazy : H.tag;
    h.sinc = g.handicap === 'serious' ? 100 : clamp(H.sincerity + (g.effort ? 5 : 0) - (g.lazy ? 2 : 0), 1, 19);
    h.corner = null;
    for (let i = this.cornerIdx; i < Math.min(this.corners.length, this.cornerIdx + 3); i++) {
      const c = this.corners[i], d = c.s0 - p.s;
      if (d > Math.max(45, p.v * 3.2)) break;
      if (c.s1 < p.s || c.rMin > 62) continue;
      // 화면에서 어느 쪽으로 꺾이는지 (고정 카메라라 진행 방향 기준이 아니라 화면 기준으로 알려 준다)
      h.corner = { dir: c.dir, r: c.rMin, d: Math.max(0, d), turn: c.turn };
      break;
    }
    h.warn = null;
    for (const ob of this.obst) { const d = ob.s - p.s; if (d > 5 && d < 110 && !(ob.kind === 'deer' && ob.phase === 0) && ob.phase !== 4) { h.warn = { label: ob.label, d }; break; } }
  }
}
export { MPP };
