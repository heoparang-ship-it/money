// 할배(씨티백) AI. 레이싱 라인을 레일처럼 따라가며, 속도는 물리 한계 프로파일 × 레벨별 페이스.
// 앞서면 딴짓하며 기다리고(lazy), 뒤처지면 핸디캡을 하나 풀고 따라붙는다(effort). 마지막 구간은 실력대로.
// 핸디캡(커피·철가방·계란탑·강아지 운전…)은 연출이다. 실제 속도는 핸디캡과 무관하다.
import { clamp, lerp, smoothstep } from './geo.js';
import { DS, computeRacingLine, solveSpeed } from './track.js';
import { GRANDPA, refParams } from './config.js';
import { MEDLEY } from './talk.js';

const G = 9.81;

/** 스테이지 기준 시간: 기준 바이크(레벨 권장 개조)의 이론 최속 주행 시간 */
export function stageReference(track, stage, grip = 1) {
  const iStart = Math.max(0, stage.i0 - 3), iEnd = Math.min(track.n - 1, stage.i1 + 150);
  const line = computeRacingLine(track, iStart, iEnd, 1.5);
  const fin = stage.i1 - iStart;
  const rp = refParams(stage.ref);
  rp.mu *= grip; // 비·안개 등 노면 상태는 기준 시간에도 반영한다
  const ref = solveSpeed(track, line, rp, { vStart: 0 });
  return { line, iStart, iEnd, fin, tRef: ref.T[fin], refProfile: ref, grip };
}

export class Grandpa {
  constructor(track, stage, reference) {
    this.track = track; this.stage = stage;
    const r = (this.ref = reference);
    this.line = r.line; this.iStart = r.iStart;
    this.prof = solveSpeed(track, this.line, { ...GRANDPA.params, mu: GRANDPA.params.mu * (reference.grip || 1) }, { vStart: 0, vEnd: 0.5 });
    this.target = r.tRef * stage.k;
    this.pace = this.prof.T[r.fin] / Math.max(5, this.target - GRANDPA.kickDelay);
    this.s = this.iStart * DS; this.d = 2.4; this.v = 0; this.lean = 0;
    this.mode = 'normal'; this.factor = 1; this.effort = false; this.lazy = false; this.kicking = true;
    this.handicap = stage.handicap === 'medley' ? MEDLEY[0] : stage.handicap || 'coffee';
    this.effortTime = 0; this.finished = false; this.finishTime = 0;
    this.events = []; this.lastGapSign = 0;
  }

  _idx(s) { return clamp((s - this.iStart * DS) / DS, 0, this.line.D.length - 1.001); }
  _sample(arr, f) { const i = f | 0; return lerp(arr[i], arr[i + 1], f - i); }

  update(dt, t, player, obstacles) {
    const st = this.stage, tr = this.track;
    if (t < GRANDPA.kickDelay) { this.kicking = true; return; }
    this.kicking = false;
    const f = this._idx(this.s);
    const gap = this.s - player.s; // + 면 할배가 앞
    const progress = (player.s - st.s0) / (st.s1 - st.s0);
    // --- 봐주기 / 따라붙기 (거리에 따라 부드럽게)
    let fT = 1;
    const free = this.finished || progress > GRANDPA.freeZone || player.finished;
    if (!free) {
      if (gap > GRANDPA.waitResume && !st.boss) fT = 1 - (1 - GRANDPA.waitFactor) * smoothstep(GRANDPA.waitResume, GRANDPA.waitGap, gap);
      else if (gap < -14 && t > GRANDPA.kickDelay + 2.5) fT = 1 + (GRANDPA.wakeFactor - 1) * smoothstep(-14, -28, gap) + clamp((-gap - 30) * 0.0035, 0, 0.16);
    }
    this.factor += clamp(fT - this.factor, -0.5 * dt, 0.5 * dt);
    this.mode = this.factor < 0.95 ? 'wait' : this.factor > 1.045 ? 'wake' : 'normal';
    // 출발 직후(킥스타터 밟느라 늦는 동안)에는 조용히 따라붙기만 한다
    const eff = this.factor > 1.045 && t > 9, lz = this.factor < 0.95;
    if (eff !== this.effort) { this.effort = eff; if (eff) this.events.push({ type: 'effort' }); }
    if (lz !== this.lazy) { this.lazy = lz; if (lz) this.events.push({ type: 'lazy' }); }
    if (eff) this.effortTime += dt;
    // --- 풀코스: 구간마다 핸디캡을 바꾸다가 마지막에 처음으로 핸들을 잡는다
    if (st.handicap === 'medley') {
      const pr = (this.s - st.s0) / (st.s1 - st.s0);
      const want = pr > GRANDPA.freeZone ? 'serious' : MEDLEY[clamp(Math.floor((pr / GRANDPA.freeZone) * MEDLEY.length), 0, MEDLEY.length - 1)];
      if (want !== this.handicap) { this.handicap = want; this.events.push({ type: want === 'serious' ? 'serious' : 'medley', handicap: want }); }
    }

    let vT = this._sample(this.prof.V, f) * this.pace * this.factor;
    let dT = this._sample(this.line.D, f);
    const hw = tr.HW[Math.min(tr.n - 1, Math.round(this.s / DS))];
    const rel = player.s - this.s;
    // 도트 화면에서는 캐릭터가 크게 그려지므로 넉넉하게 비켜 간다
    if (rel > -5 && rel < 14 && player.state !== 'crash') {
      const side = player.d > dT ? -1 : 1;
      let cand = player.d + side * 2.7;
      if (Math.abs(cand) > hw - 1.1) cand = player.d - side * 2.7;
      if (Math.abs(dT - player.d) < 2.5) dT = cand;
      if (Math.abs(this.d - player.d) < 1.9 && rel > 1 && rel < 7) vT = Math.min(vT, player.v + 1.5);
    }
    if (obstacles) for (const ob of obstacles) {
      const r2 = ob.s - this.s;
      if (r2 > -5 && r2 < 34 && Math.abs(ob.d - dT) < ob.w + 1.9) dT = ob.d + (ob.d > 0 ? -1 : 1) * (ob.w + 2.3);
    }
    dT = clamp(dT, -(hw - 1.1), hw - 1.1);
    this.v += clamp(vT - this.v, -14 * dt, 9 * dt);
    this.s += (this.v * dt * DS) / Math.max(0.5, this._sample(this.line.LDS, f));
    this.d += clamp(dT - this.d, -4.5 * dt, 4.5 * dt);
    const k = this._sample(this.line.K, f);
    this.lean = lerp(this.lean, clamp(Math.atan((this.v * this.v * k) / G) * 1.05, -1.22, 1.22), 1 - Math.exp(-9 * dt));

    // 추월 판정
    const sign = gap > 2.5 ? 1 : gap < -2.5 ? -1 : 0;
    if (sign !== 0 && sign !== this.lastGapSign) {
      if (sign > 0 && (this.lastGapSign !== 0 || t > GRANDPA.kickDelay + 2)) this.events.push({ type: 'overtake' });
      else if (sign < 0 && this.lastGapSign > 0) this.events.push({ type: 'overtaken' });
      this.lastGapSign = sign;
    }
    if (!this.finished && this.s >= st.s1) { this.finished = true; this.finishTime = t; this.events.push({ type: 'finish' }); }
  }
}
