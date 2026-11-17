// 플레이어 바이크 물리 (프레네 좌표: s = 진행 거리, d = 좌우 위치).
// 핵심: 기울기(lean)가 선회율을 만든다  ω = g·tan(lean)/v.  접지 한계는 마찰원으로 제한한다.
import { clamp } from './geo.js';
import { dragCoef } from './track.js';

const G = 9.81;

export class PlayerBike {
  constructor(track, params, opts = {}) {
    this.track = track;
    this.p = params;
    this.cd = dragCoef(params);
    this.assist = opts.assist ?? 0.5;
    this.s = 0; this.d = 0; this.v = 0; this.psi = 0; this.lean = 0;
    this.state = 'ride';
    this.crashT = 0; this.invuln = 0; this.touching = false;
    this.nitroLeft = params.nitro || 0; this.boostT = 0;
    this.brakeIn = 0; this.accel = 0; this.over = 0; this.draft = 0;
    this.events = [];
    this.stats = { crashes: 0, scrapes: 0, topSpeed: 0, boosts: 0 };
    this._t = {};
  }

  place(s, d) { this.s = s; this.d = d; this.v = 0; this.psi = 0; this.lean = 0; this.state = 'ride'; }

  crash(reason) {
    if (this.state === 'crash' || this.invuln > 0) return;
    this.state = 'crash'; this.crashT = 0; this.stats.crashes++; this.boostT = 0;
    this.events.push({ type: 'crash', reason, v: this.v });
  }

  /**
   * inp: { steer -1..1 (왼쪽 +), brake 0..1, throttle 0..1, boost(bool, 이번 프레임 눌림) }
   * ctx: { grip, draft 0..1, locked(출발 전) }
   */
  update(dt, inp, ctx) {
    const tr = this.track.at(this.s, 0, this._t), p = this.p;
    if (this.invuln > 0) this.invuln -= dt;
    if (this.state === 'crash') {
      this.crashT += dt;
      this.v = Math.max(0, this.v - 13 * dt);
      this.psi *= 1 - 3 * dt;
      this.s += this.v * dt;
      this.d = clamp(this.d + this.v * Math.sin(this.psi) * dt, -tr.hw, tr.hw);
      this.accel = -1; this.brakeIn = 1;
      if (this.crashT > 1.7) {
        this.state = 'ride'; this.lean = 0; this.psi = 0; this.invuln = 2.2;
        this.d = clamp(this.d, -(tr.hw - 1.3), tr.hw - 1.3);
        this.v = Math.max(this.v, 6);
        this.events.push({ type: 'respawn' });
      }
      return;
    }
    const mu = p.mu * (ctx.grip ?? 1), muG = mu * G, v = this.v;
    let throttle = ctx.locked ? 0 : inp.throttle;
    const brake = ctx.locked ? 0 : inp.brake;
    if (brake > 0.05) throttle = 0;
    if (inp.boost && this.nitroLeft > 0 && this.boostT <= 0 && !ctx.locked) {
      this.nitroLeft--; this.boostT = 2.6; this.stats.boosts++;
      this.events.push({ type: 'nitro' });
    }
    const boosting = this.boostT > 0;
    if (boosting) this.boostT -= dt;

    // 제동과 선회는 같은 타이어를 나눠 쓴다 (마찰원)
    const brakeA = brake * Math.min(p.brake, muG * 1.02);
    const latAvail = Math.sqrt(Math.max(0.05 * muG * muG, muG * muG - 0.5 * brakeA * brakeA));
    const leanMax = Math.min(1.03, Math.atan(mu));
    const leanCap = Math.min(leanMax, Math.atan(latAvail / G));
    const kPath = tr.k / Math.max(0.4, 1 - this.d * tr.k);
    const leanRoad = Math.atan((v * v * kPath) / G);
    let target = inp.steer * leanMax + this.assist * leanRoad;
    if (Math.abs(inp.steer) < 0.06) target += clamp(-this.psi * 2.2, -0.3, 0.3) * Math.min(1, this.assist * 2); // 손을 떼면 도로 방향으로 정렬
    this.over = clamp((Math.abs(leanRoad) - leanCap) / 0.25, 0, 1); // 이 속도로는 못 도는 정도
    target = clamp(target, -leanCap, leanCap);
    const rate = p.leanRate / (1 + (v / 80) * (v / 80));
    this.lean += clamp((target - this.lean) * 10, -rate, rate) * dt;

    const omega = (G * Math.tan(this.lean)) / Math.max(v, 4);
    const sDot = (v * Math.cos(this.psi)) / Math.max(0.3, 1 - this.d * tr.k);
    this.s += sDot * dt;
    this.d += v * Math.sin(this.psi) * dt;
    this.psi = clamp(this.psi + (omega - tr.k * sDot) * dt, -1.1, 1.1);

    const used = Math.min(1, Math.abs(v * omega) / muG);
    const fr = Math.sqrt(1 - used * used);
    let drive = throttle * Math.min(p.a0, p.pw / Math.max(v, 1)) * (0.2 + 0.8 * fr);
    if (boosting) drive = drive * 1.45 + 3.2;
    this.draft = ctx.draft || 0;
    const cd = this.cd * (1 - 0.4 * this.draft) * (boosting ? 0.62 : 1);
    const engineBrake = throttle < 0.05 && brake < 0.05 ? 0.9 : 0;
    const a = drive - brakeA - engineBrake - cd * v * v - 0.12 - G * tr.grade;
    this.v = Math.max(0, v + a * dt);
    this.accel = clamp(a / 8, -1, 1); this.brakeIn = brake;
    if (this.v > this.stats.topSpeed) this.stats.topSpeed = this.v;

    // 가드레일·옹벽
    const lim = tr.hw + 0.12;
    if (Math.abs(this.d) > lim) {
      const side = Math.sign(this.d);
      const vn = this.v * Math.sin(this.psi) * side;
      this.d = side * lim;
      if (this.invuln <= 0 && (vn > 7.5 || (vn > 3.8 && this.v > 34))) {
        this.crash('rail');
      } else {
        if (!this.touching) {
          this.v = Math.max(0, this.v - 0.8 - 0.9 * Math.max(0, vn));
          this.stats.scrapes++;
          this.events.push({ type: 'scrapeStart', side, vn });
        }
        this.touching = true;
        this.v = Math.max(0, this.v - 5.5 * dt);
        if (side * this.psi > -0.015) this.psi = -side * 0.02;
        this.lean *= 1 - 4 * dt;
        this.events.push({ type: 'scrape', side });
      }
    } else if (Math.abs(this.d) < lim - 0.15) this.touching = false;
  }
}
