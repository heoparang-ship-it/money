// 게임 본체: 월드 조립, 레이스 진행, 카메라, 이펙트.
import * as THREE from 'three';
import { Environment } from './env.js';
import { Terrain } from './terrain.js';
import { analyzeRoadsides, buildRoad } from './road.js';
import { buildScenery } from './scenery.js';
import { makePlayerBike, makeGrandpaBike, poseBike, poseCrash } from './models.js';
import { PlayerBike } from './physics.js';
import { Grandpa, stageReference } from './rival.js';
import { Bot } from './bot.js';
import { DS } from './track.js';
import { bikeParams, GRANDPA, LINES, WEATHERS } from './config.js';
import { disposeTree } from './geobuf.js';
import { Fx } from './fx.js';
import { buildObstacles } from './obstacles.js';
import { GoogleTiles } from './google.js';
import { clamp, lerp } from './geo.js';

export const QUALITY = {
  low: { px: 1, shadows: false, detail: 0.45, satPx: 2048 },
  mid: { px: 1.5, shadows: false, detail: 0.75, satPx: 2048 },
  high: { px: 2, shadows: true, detail: 1, satPx: 4096 },
};
const tick = () => new Promise((r) => setTimeout(r, 0));
const pick = (a) => a[(Math.random() * a.length) | 0];
const STEP = 1 / 120;

export class Game {
  constructor(canvas, data, hooks) {
    this.data = data; this.track = data.track; this.hooks = hooks;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.5, 60000);
    this.env = new Environment(this.scene, this.renderer);
    this.terrain = new Terrain(data);
    data.terrain = this.terrain;
    data.roadside = analyzeRoadsides(data);
    this.google = new GoogleTiles();
    this.quality = QUALITY.mid; this.qualityKey = 'mid'; this.dynPx = 1;
    this.mode = 'boot'; this.time = 0; this.acc = 0;
    this.camF = new THREE.Vector3(0, 0, 1); this.shake = 0; this.orbit = 0;
    this._a = {}; this._b = {}; this._g = {};
    this.world = null; this.stage = null; this.autopilot = false;
    this.fpsAcc = 0; this.fpsN = 0;
  }

  emit(type, payload) { if (this.hooks) this.hooks(type, payload); }

  setQuality(key) {
    this.qualityKey = key; this.quality = QUALITY[key] || QUALITY.mid; this.dynPx = 1;
    this.resize();
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setPixelRatio(Math.max(0.6, Math.min(devicePixelRatio || 1, this.quality.px) * this.dynPx));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** 세로 화면에서는 좌우 시야가 너무 좁아지지 않게 수직 화각을 넓힌다 */
  _fov(base) {
    const asp = this.camera.aspect;
    if (asp >= 1.15) return base;
    return clamp(Math.max(base, (2 * Math.atan(Math.tan(0.54) / asp) * 180) / Math.PI), base, 98);
  }

  disposeWorld() {
    if (this.world) { this.scene.remove(this.world); disposeTree(this.world); this.world = null; }
    for (const k of ['pm', 'gm']) if (this[k]) { this.scene.remove(this[k].root); this[k] = null; }
    if (this.obst) { this.scene.remove(this.obst.group); disposeTree(this.obst.group); this.obst = null; }
    if (this.fxA) { this.fxA.clear(); this.fxD.clear(); }
  }

  /** 스테이지 월드를 만든다. onProgress(0..1, 문구) */
  async loadStage(cfg, up, settings, onProgress = () => {}) {
    const t = this.track, q = this.quality;
    const st = (this.stage = { ...cfg, i0: Math.round(cfg.s0 / DS), i1: Math.min(t.n - 2, Math.round(cfg.s1 / DS)) });
    st.k = cfg.k + (settings.diff || 0);
    this.mode = 'loading';
    this.disposeWorld();
    this.env.apply(cfg.weather, q);
    if (!this.fxA) { this.fxA = new Fx(this.scene, this.env.tex.dot, true, 500); this.fxD = new Fx(this.scene, this.env.tex.dot, false, 300); }
    onProgress(0.04, '코스 불러오는 중'); await tick();

    // 구글 위성사진 (키가 있을 때만)
    let sat = null; this.satInfo = '';
    this.google.setKey(settings.gkey || '');
    if (settings.sat && this.google.ready) {
      try {
        let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
        for (let i = Math.max(0, st.i0 - 70); i <= Math.min(t.n - 1, st.i1 + 90); i += 4) { x0 = Math.min(x0, t.X[i]); x1 = Math.max(x1, t.X[i]); z0 = Math.min(z0, t.Z[i]); z1 = Math.max(z1, t.Z[i]); }
        const f = this.data.dem.f, m = 380;
        sat = await this.google.build(this.data.proj, [x0 - m, z0 - m, x1 + m, z1 + m], [f.x0, -(f.y0 + (f.ny - 1) * f.step), f.x0 + (f.nx - 1) * f.step, -f.y0], q.satPx,
          (p) => onProgress(0.05 + p * 0.3, '구글 위성사진 받는 중'));
        this.satInfo = sat.attribution;
      } catch (e) {
        sat = null; this.google.lastError = String(e.message || e);
        this.emit('notice', `구글 위성사진을 불러오지 못했습니다 (${this.google.lastError}). 기본 지형으로 진행합니다.`);
      }
    }
    this.satOn = !!sat;
    const g = new THREE.Group();
    onProgress(0.38, '실제 고도로 지형 만드는 중'); await tick();
    g.add(this.terrain.build(st, this.env.palette, sat, q.detail));
    onProgress(0.6, '도로 까는 중'); await tick();
    g.add(buildRoad(this.data, st, this.env));
    onProgress(0.74, '나무 심는 중'); await tick();
    const sc = buildScenery(this.data, st, this.env, q);
    g.add(sc); this.animated = sc.userData.animated || [];
    this.scene.add(g); this.world = g;
    onProgress(0.9, '할배 깨우는 중'); await tick();

    // 바이크·라이더
    this.up = { ...up };
    this.pm = makePlayerBike(this.up); this.gm = makeGrandpaBike(cfg.cargo);
    this.scene.add(this.pm.root, this.gm.root);
    const night = !!this.env.w.night;
    if (night) {
      // 전조등: 멀리 비추는 스폿 + 노면을 위에서 밝히는 보조광 (스폿만으로는 아스팔트가 스치는 각도라 거의 안 밝아진다)
      const mk = (m, spotI, poolI) => {
        const l = new THREE.SpotLight(0xfff1cf, spotI, 170, 0.48, 0.6, 1.2), tg = new THREE.Object3D();
        l.position.set(0, 1.5, 0.9); tg.position.set(0, -0.4, 26);
        const pool = new THREE.PointLight(0xffe9c0, poolI, 46, 2);
        pool.position.set(0, 3.4, 9);
        m.root.add(l, tg, pool); l.target = tg;
      };
      mk(this.pm, 5200, 230); mk(this.gm, 1500, 80);
    }
    this.grip = WEATHERS[cfg.weather].grip;
    this.reference = stageReference(t, st, this.grip);
    this.assist = settings.assist ?? 0.5;
    this._resetRace();
    this.obst = buildObstacles(this.data, st, cfg.obstacles, this.scene);
    this.corners = t.corners.filter((c) => c.i1 > st.i0 && c.i0 < st.i1);
    this.stats = this.world.children.map((c) => c.userData.stats || c.userData.trees).filter(Boolean);
    onProgress(1, '준비 완료'); await tick();
    this.mode = 'menu'; this.orbit = 0.6;
    this.resize();
    this._idlePose(0.016);
    return st;
  }

  _resetRace() {
    const st = this.stage, t = this.track;
    this.player = new PlayerBike(t, bikeParams(this.up), { assist: this.assist });
    this.player.place(st.s0 - 6, -1.6);
    this.player.finished = false;
    this.grandpa = new Grandpa(t, st, this.reference);
    this.bot = new Bot(t, this.reference, bikeParams(this.up), { skill: this.autopilotSkill || 0.9, grip: this.grip, assist: this.assist });
    this.raceT = 0; this.pFinish = 0; this.finT = 0; this.resultSent = false;
    this.cornerIdx = 0; this.dirty = false; this.clean = 0; this.streak = 0; this.bumpCool = 0; this.overtakes = 0; this.led = 0;
    this.camF.set(t.TX[st.i0], 0, t.TZ[st.i0]);
    if (this.fxA) { this.fxA.clear(); this.fxD.clear(); }
    this.hud = { speed: 0, gap: 0, corner: null, warn: null };
  }

  /** 개조 후 플레이어 모델만 교체 */
  refreshPlayer(up) {
    this.up = { ...up };
    if (!this.world) return;
    if (this.pm) this.scene.remove(this.pm.root);
    this.pm = makePlayerBike(this.up);
    this.scene.add(this.pm.root);
    this.player = new PlayerBike(this.track, bikeParams(this.up), { assist: this.assist });
    this.player.place(this.stage.s0 - 6, -1.6);
    this._idlePose(0.016);
  }

  toGrid() { this._resetRace(); if (this.obst) { this.scene.remove(this.obst.group); this.obst = buildObstacles(this.data, this.stage, this.stage.obstacles, this.scene); } this.mode = 'grid'; this.gridT = 0; this._idlePose(0.016); }
  startCountdown() { this.mode = 'countdown'; this.countT = 3.2; this.lastCount = 4; }

  // ------------------------------------------------------------------ 갱신
  update(dt, input) {
    dt = Math.min(dt, 0.1);
    this.time += dt;
    for (const fn of this.animated || []) fn(this.time);
    if (!this.world || this.mode === 'loading' || this.mode === 'boot') return;
    if (this.mode === 'menu' || this.mode === 'garage') {
      this.orbit += dt * (this.mode === 'garage' ? 0.25 : 0.1);
      this._idlePose(dt);
      this._orbitCam(this.mode === 'garage');
    } else if (this.mode === 'grid') {
      this.gridT += dt;
      this._idlePose(dt);
      this._chaseCam(dt, true);
    } else if (this.mode === 'countdown') {
      this.countT -= dt;
      const n = Math.ceil(this.countT);
      if (n !== this.lastCount) { this.lastCount = n; this.emit('count', n); }
      this._idlePose(dt);
      this._chaseCam(dt, true);
      if (this.countT <= 0) { this.mode = 'race'; this.raceT = 0; this.acc = 0; this.grandpa.say('kick', true); }
    } else if (this.mode === 'race' || this.mode === 'finish') {
      this.acc += dt;
      let n = 0;
      const inp = input;
      while (this.acc >= STEP && n < 12) { this._step(STEP, inp); inp.boost = false; this.acc -= STEP; n++; }
      if (n === 12) this.acc = 0;
      this._poseAll(dt);
      this._effects(dt);
      this._chaseCam(dt, false);
      this._hudState();
      if (this.mode === 'finish') {
        this.finT += dt;
        if (this.finT > 2.8 && !this.resultSent) { this.resultSent = true; this.emit('result', this.result); }
      }
      // 프레임이 계속 낮으면 해상도를 조금 낮춘다
      this.fpsAcc += dt; this.fpsN++;
      if (this.fpsAcc > 3) {
        const fps = this.fpsN / this.fpsAcc; this.fpsAcc = 0; this.fpsN = 0; this.lastFps = fps;
        if (fps < 27 && this.dynPx > 0.55) { this.dynPx *= 0.85; this.resize(); }
      }
    }
    const scale = (this.renderer.domElement.height / 720) * 520;
    if (this.fxA) { this.fxA.update(dt, scale); this.fxD.update(dt, scale); }
    const focus = this._focus || this.camera.position;
    this.env.update(dt, this.camera, focus, this.time);
  }

  _step(h, input) {
    const p = this.player, g = this.grandpa, st = this.stage;
    this.raceT += h;
    let inp = input;
    if (this.autopilot || p.finished) {
      inp = this.bot.control(p, (this._bi ||= {}));
      if (p.finished) { inp.throttle = p.v < 11 ? 0.5 : 0; inp.brake = p.v > 16 ? 0.6 : 0; inp.boost = false; }
      else if (this.autopilot && p.nitroLeft > 0 && Math.abs(this.track.curvatureAt(p.s + 60)) < 0.003 && p.v > 25) inp.boost = true;
    }
    // 슬립스트림
    const gap = g.s - p.s;
    const draft = gap > 2.5 && gap < 17 && Math.abs(g.d - p.d) < 1.4 ? 1 - (gap - 2.5) / 14.5 : 0;
    p.update(h, inp, { grip: this.grip, draft, locked: false });
    g.update(h, this.raceT, p, this.obst ? this.obst.list : null);
    if (this.obst) this.obst.update(h, p, (e) => this.emit('sfx', e));
    // 할배와 접촉: 할배는 꿈쩍도 안 한다
    this.bumpCool -= h;
    if (Math.abs(gap) < 1.9 && Math.abs(g.d - p.d) < 0.78 && p.state === 'ride') {
      p.d += Math.sign(p.d - g.d || 1) * 3.2 * h;
      if (gap > 0 && p.v > g.v - 0.3) p.v = Math.max(0, g.v - 0.3);
      if (this.bumpCool <= 0) { this.bumpCool = 3; g.say('bump', true); this.emit('sfx', 'scrape'); this.shake = Math.max(this.shake, 0.25); }
    }
    if (gap < -1.5) this.led += h;
    // 이벤트
    for (const e of p.events) {
      if (e.type === 'crash') {
        this.dirty = true; this.streak = 0; this.shake = 1; this.emit('sfx', 'crash');
        this.emit('toast', e.reason === 'deer' ? '고라니!!' : e.reason === 'rock' ? '낙석!' : e.reason === 'tractor' ? '경운기…!' : '쾅!');
        g.say('crash');
        for (let k = 0; k < 26; k++) this._spark(this._a, 6);
      } else if (e.type === 'scrapeStart') { this.dirty = true; this.streak = 0; this.shake = Math.max(this.shake, 0.3 + e.vn * 0.08); this.emit('sfx', 'scrape'); }
      else if (e.type === 'scrape') this.scraping = 0.08;
      else if (e.type === 'nitro') { this.emit('sfx', 'nitro'); this.emit('toast', '니트로!'); g.say('nitro'); }
    }
    p.events.length = 0;
    for (const e of g.events) {
      if (e.type === 'say') this.emit('say', pick(LINES[e.kind] || ['…']));
      else if (e.type === 'overtake') { this.emit('sfx', 'horn'); this.overtakes++; }
      else if (e.type === 'wake') { this.emit('sfx', 'wake'); this.emit('toast', '할배 각성!'); }
    }
    g.events.length = 0;
    // 클린 코너 판정
    while (this.cornerIdx < this.corners.length && p.s > this.corners[this.cornerIdx].s1 + 4) {
      const c = this.corners[this.cornerIdx++];
      if (c.s0 < st.s0 || c.rMin > 60) { this.dirty = false; continue; }
      if (!this.dirty) {
        this.clean++; this.streak++;
        if (this.streak >= 3 && !p.finished) { this.emit('toast', `클린 코너 ×${this.streak}`); this.emit('sfx', 'clean'); }
      }
      this.dirty = false;
    }
    // 결승
    if (!p.finished && p.s >= st.s1) { p.finished = true; this.pFinish = this.raceT; this.emit('sfx', 'coin'); }
    if (this.mode === 'race') {
      const dnf = g.finished && !p.finished && this.raceT - g.finishTime > 25;
      if ((p.finished && (g.finished || this.raceT - this.pFinish > 5)) || dnf) {
        const gTime = g.finished ? g.finishTime : this.raceT + (st.s1 - g.s) / Math.max(8, g.v);
        const pTime = dnf ? this.raceT : this.pFinish;
        this.result = {
          win: !dnf && pTime < gTime, dnf, pTime, gTime, gap: pTime - gTime, crashes: p.stats.crashes, scrapes: p.stats.scrapes,
          clean: this.clean, topSpeed: p.stats.topSpeed * 3.6, boosts: p.stats.boosts, led: this.led, overtakes: this.overtakes,
        };
        this.mode = 'finish'; this.finT = 0;
        this.emit('finish', this.result);
      }
    }
  }

  // ------------------------------------------------------------------ 표현
  _bikeFrame(s, d, psi, out) {
    const a = this.track.at(s, d, out);
    const cs = Math.cos(psi), sn = Math.sin(psi);
    a.fx = a.tx * cs + a.nx * sn; a.fz = a.tz * cs + a.nz * sn;
    return a;
  }

  _idlePose(dt) {
    const p = this.player, g = this.grandpa, night = !!this.env.w.night;
    const a = this._bikeFrame(p.s, p.d, 0, this._a);
    poseBike(this.pm, { x: a.x, y: a.y, z: a.z, yaw: Math.atan2(a.fx, a.fz), slope: a.grade, lean: 0, v: 0, dt, time: this.time, night });
    const b = this._bikeFrame(g.s, g.d, 0, this._g);
    poseBike(this.gm, { x: b.x, y: b.y, z: b.z, yaw: Math.atan2(b.fx, b.fz), slope: b.grade, lean: 0, v: 0, dt, time: this.time, night, gag: this.mode === 'countdown' || this.mode === 'grid' ? 'kick' : 'wave' });
    this._focus = this.pm.root.position;
  }

  _poseAll(dt) {
    const p = this.player, g = this.grandpa, night = !!this.env.w.night;
    const a = this._bikeFrame(p.s, p.d, p.psi, this._a);
    const blink = p.invuln > 0 && p.state === 'ride' && Math.floor(this.time * 12) % 2 === 0;
    this.pm.root.visible = !blink;
    poseBike(this.pm, { x: a.x, y: a.y, z: a.z, yaw: Math.atan2(a.fx, a.fz), slope: a.grade, lean: p.lean, v: p.v, brake: p.brakeIn, accel: p.accel, dt, time: this.time, boost: p.boostT > 0, night });
    if (p.state === 'crash') poseCrash(this.pm, p.crashT);
    const b = this._bikeFrame(g.s, g.d, 0, this._g);
    poseBike(this.gm, { x: b.x, y: b.y, z: b.z, yaw: Math.atan2(b.fx, b.fz), slope: b.grade, lean: g.lean, v: g.v, dt, time: this.time, night, gag: g.gag, brake: 0 });
    this._focus = this.pm.root.position;
  }

  _spark(a, speed, side = 0, hot = true) {
    const sx = a.nx * side, sz = a.nz * side;
    this.fxA.spawn(a.x + sx * 0.4, a.y + 0.12 + Math.random() * 0.3, a.z + sz * 0.4,
      -a.fx * speed * (0.3 + Math.random()) + (Math.random() - 0.5) * 4, 1 + Math.random() * 3.5, -a.fz * speed * (0.3 + Math.random()) + (Math.random() - 0.5) * 4,
      0.25 + Math.random() * 0.45, 0.09 + Math.random() * 0.1, 1, hot ? 0.72 : 0.9, hot ? 0.25 : 0.6, 1, 12);
  }

  _effects(dt) {
    const p = this.player, g = this.grandpa;
    this.scraping = Math.max(0, (this.scraping || 0) - dt);
    if (this.scraping > 0) for (let k = 0; k < 3; k++) this._spark(this._a, p.v * 0.5, Math.sign(p.d));
    // 할배 센터스탠드 불꽃
    if (Math.abs(g.lean) > 0.86 && g.v > 8) {
      const b = this._g;
      for (let k = 0; k < 2; k++) this._spark(b, g.v * 0.45, Math.sign(g.lean) * 0.8);
    }
    if (p.state === 'crash' && p.v > 2 && Math.random() < 0.7) {
      const a = this._a;
      this.fxD.spawn(a.x, a.y + 0.3, a.z, (Math.random() - 0.5) * 2, 1 + Math.random(), (Math.random() - 0.5) * 2, 0.9, 0.5, 0.6, 0.58, 0.52, 0.5, -0.5, 1.6);
    }
    if (p.boostT > 0) {
      const a = this._a;
      this.fxA.spawn(a.x - a.fx * 1.3, a.y + 0.55, a.z - a.fz * 1.3, -a.fx * 6 + (Math.random() - 0.5), Math.random(), -a.fz * 6 + (Math.random() - 0.5), 0.25, 0.3, 0.3, 0.7, 1, 0.9, 0, 0.5);
    }
    this.shake = Math.max(0, this.shake - dt * 2.2);
  }

  _chaseCam(dt, grid) {
    const p = this.player, t = this.track, a = this._a;
    if (this.camera.view) this.camera.clearViewOffset();
    const la = clamp(p.v * 0.75, 7, 44);
    const b = t.at(Math.min(p.s + la, t.length - 1), p.d * 0.4, this._b);
    let dx = b.x - a.x, dz = b.z - a.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    let tx = (a.fx ?? a.tx) * 0.5 + dx * 0.5, tz = (a.fz ?? a.tz) * 0.5 + dz * 0.5;
    const k = 1 - Math.exp(-dt * 5.5);
    this.camF.x += (tx - this.camF.x) * k; this.camF.z += (tz - this.camF.z) * k;
    const fl = Math.hypot(this.camF.x, this.camF.z) || 1; this.camF.x /= fl; this.camF.z /= fl;
    const boost = p.boostT > 0 ? 1 : 0;
    let dist = 5.3 + p.v * 0.02 + boost * 0.8, hgt = 2.15;
    if (grid) { dist = 6.4; hgt = 2.5; }
    let cx = a.x - this.camF.x * dist, cz = a.z - this.camF.z * dist, cy = a.y + hgt;
    const ty = this.terrain.heightAt(cx, cz) + 1.0;
    if (cy < ty) cy = ty;
    const sh = this.shake * 0.35;
    this.camera.position.set(cx + (Math.random() - 0.5) * sh, cy + (Math.random() - 0.5) * sh, cz + (Math.random() - 0.5) * sh);
    this.camera.lookAt(a.x + this.camF.x * (9 + p.v * 0.3), a.y + 1.0 + (b.y - a.y) * 0.55, a.z + this.camF.z * (9 + p.v * 0.3));
    this.camera.rotateZ(p.lean * 0.16);
    const fov = this._fov(60 + clamp(p.v / 62, 0, 1) * 15 + boost * 6);
    if (Math.abs(fov - this.camera.fov) > 0.05) { this.camera.fov = lerp(this.camera.fov, fov, 0.1); this.camera.updateProjectionMatrix(); }
  }

  _orbitCam(close) {
    // 나무에 가리지 않도록 카메라는 항상 도로 위에 둔다
    const p = this.player, t = this.track, a = this._a, o = this._b;
    // 차고에서는 오른쪽 패널에 가리지 않게 화면 중심을 왼쪽으로 민다
    const w = this.renderer.domElement.width, h = this.renderer.domElement.height;
    if (close && innerWidth > 760) this.camera.setViewOffset(w, h, w * 0.2, 0, w, h); else if (this.camera.view) this.camera.clearViewOffset();
    if (close) {
      const th = 0.55 + 0.85 * Math.sin(this.orbit * 0.8), r = 4.4;
      t.at(p.s + r * Math.sin(th), p.d + r * Math.cos(th), o);
      this.camera.position.set(o.x, o.y + 1.25, o.z);
      this.camera.lookAt(a.x, a.y + 0.72, a.z);
    } else {
      t.at(p.s + 9.5 + Math.sin(this.orbit * 0.9) * 1.5, 2.4 * Math.sin(this.orbit * 0.6), o);
      this.camera.position.set(o.x, o.y + 1.45 + 0.3 * Math.sin(this.orbit * 0.5), o.z);
      this.camera.lookAt((a.x + this._g.x) / 2, a.y + 0.95, (a.z + this._g.z) / 2);
    }
    const fov = this._fov(close ? 46 : 50);
    if (Math.abs(this.camera.fov - fov) > 0.1) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
  }

  _hudState() {
    const p = this.player, g = this.grandpa, st = this.stage, h = this.hud;
    h.speed = p.v * 3.6; h.time = p.finished ? this.pFinish : this.raceT;
    h.gapM = p.s - g.s; // + 면 내가 앞
    h.gapS = h.gapM / Math.max(12, (p.v + g.v) / 2);
    h.pp = clamp((p.s - st.s0) / (st.s1 - st.s0), 0, 1); h.pg = clamp((g.s - st.s0) / (st.s1 - st.s0), 0, 1);
    h.nitro = p.nitroLeft; h.boost = p.boostT > 0; h.draft = p.draft > 0.25; h.over = p.over > 0.3 && p.v > 10; h.wake = g.mode === 'wake'; h.wait = g.mode === 'wait';
    // 다음 코너 안내
    h.corner = null;
    for (let i = this.cornerIdx; i < Math.min(this.corners.length, this.cornerIdx + 3); i++) {
      const c = this.corners[i], d = c.s0 - p.s;
      if (d > Math.max(45, p.v * 3.2)) break;
      if (c.s1 < p.s || c.rMin > 62) continue;
      h.corner = { dir: c.dir, r: c.rMin, d: Math.max(0, d), turn: c.turn };
      break;
    }
    h.warn = null;
    if (this.obst) for (const ob of this.obst.list) {
      const d = ob.s - p.s;
      if (d > 5 && d < 110 && !(ob.kind === 'deer' && ob.phase === 0) && ob.phase !== 4) { h.warn = { label: ob.label, d }; break; }
    }
  }

  render() { if (this.world) this.renderer.render(this.scene, this.camera); }
}
