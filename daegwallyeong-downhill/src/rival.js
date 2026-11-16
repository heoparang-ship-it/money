// 할배(씨티백) AI. 레이싱 라인을 레일처럼 따라가며, 속도는 물리 한계 프로파일 × 레벨별 페이스.
// 앞서면 기다려 주고(손 흔들기), 뒤처지면 각성한다. 마지막 구간은 봐주기 없이 실력대로.
import { clamp, lerp, smoothstep } from './geo.js';
import { DS, computeRacingLine, solveSpeed } from './track.js';
import { GRANDPA, refParams } from './config.js';

const G = 9.81;

/** 스테이지 기준 시간: 기준 바이크(레벨 권장 개조)의 이론 최속 주행 시간 */
export function stageReference(track, stage, grip = 1) {
  const iStart = Math.max(0, stage.i0 - 3), iEnd = Math.min(track.n - 1, stage.i1 + 150);
  const line = computeRacingLine(track, iStart, iEnd, 1.0);
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
    // 노면(비·안개)은 할배에게도 똑같이 적용된다
    this.prof = solveSpeed(track, this.line, { ...GRANDPA.params, mu: GRANDPA.params.mu * (reference.grip || 1) }, { vStart: 0, vEnd: 0.5 });
    // 목표 완주 시간 = 기준 시간 × k. 킥스타트 지연을 빼고 페이스 배율을 정한다.
    this.target = r.tRef * stage.k;
    this.pace = this.prof.T[r.fin] / Math.max(5, this.target - GRANDPA.kickDelay);
    this.s = this.iStart * DS; this.d = 1.6; this.v = 0; this.lean = 0;
    this.mode = 'normal'; this.factor = 1; this.gag = 'kick'; this.gagT = 0;
    this.finished = false; this.finishTime = 0;
    this.events = []; this.lastGapSign = 0; this.sayCool = 0; this.waitSaid = 0;
  }

  _idx(s) { return clamp((s - this.iStart * DS) / DS, 0, this.line.D.length - 1.001); }
  _sample(arr, f) { const i = f | 0; return lerp(arr[i], arr[i + 1], f - i); }

  update(dt, t, player, obstacles) {
    const st = this.stage, tr = this.track;
    this.sayCool -= dt;
    if (t < GRANDPA.kickDelay) { this.gag = 'kick'; return; }
    const f = this._idx(this.s);
    const gap = this.s - player.s; // + 면 할배가 앞
    const progress = (player.s - st.s0) / (st.s1 - st.s0);
    // --- 봐주기 / 각성 (거리에 따라 부드럽게)
    // 앞서면 속도를 늦춰 기다리고, 뒤처지면 바짝 따라붙는다. 마지막 구간(freeZone)은 실력대로.
    let fT = 1;
    const free = this.finished || progress > GRANDPA.freeZone || player.finished;
    if (!free) {
      if (gap > GRANDPA.waitResume && !st.boss) fT = 1 - (1 - GRANDPA.waitFactor) * smoothstep(GRANDPA.waitResume, GRANDPA.waitGap, gap);
      else if (gap < -14 && t > GRANDPA.kickDelay + 2.5) fT = 1 + (GRANDPA.wakeFactor - 1) * smoothstep(-14, -28, gap) + clamp((-gap - 30) * 0.0035, 0, 0.16);
    }
    this.factor += clamp(fT - this.factor, -0.5 * dt, 0.5 * dt);
    const prevMode = this.mode;
    this.mode = this.factor < 0.95 ? 'wait' : this.factor > 1.045 ? 'wake' : 'normal';
    if (this.mode !== prevMode) {
      if (this.mode === 'wait') this._say('wait');
      else if (this.mode === 'wake' && !this.wokeOnce) { this.wokeOnce = true; this._say('wake', true); this.events.push({ type: 'wake' }); }
    }
    if (this.mode === 'normal' && this.factor < 1.01) this.wokeOnce = false;

    let vT = this._sample(this.prof.V, f) * this.pace * this.factor;
    // 플레이어가 바로 앞을 막고 있으면 속도를 맞추고 옆으로 뺀다
    let dT = this._sample(this.line.D, f);
    const hw = tr.HW[Math.min(tr.n - 1, Math.round(this.s / DS))];
    const rel = player.s - this.s;
    if (rel > -3 && rel < 9 && player.state !== 'crash') {
      const side = player.d > dT ? -1 : 1; // 플레이어 반대쪽으로
      let cand = player.d + side * 1.7;
      if (Math.abs(cand) > hw - 0.5) cand = player.d - side * 1.7;
      if (Math.abs(dT - player.d) < 1.6) dT = cand;
      if (Math.abs(this.d - player.d) < 1.1 && rel > 0.5 && rel < 5) vT = Math.min(vT, player.v + 1.5);
    }
    if (obstacles) for (const ob of obstacles) {
      const r2 = ob.s - this.s;
      if (r2 > -4 && r2 < 28 && Math.abs(ob.d - dT) < ob.w + 1.2) dT = ob.d + (ob.d > 0 ? -1 : 1) * (ob.w + 1.5);
    }
    dT = clamp(dT, -(hw - 0.5), hw - 0.5);
    this.v += clamp(vT - this.v, -14 * dt, 9 * dt);
    this.s += (this.v * dt * DS) / Math.max(0.5, this._sample(this.line.LDS, f));
    this.d += clamp(dT - this.d, -4 * dt, 4 * dt);
    const k = this._sample(this.line.K, f);
    this.lean = lerp(this.lean, clamp(Math.atan((this.v * this.v * k) / G) * 1.05, -1.22, 1.22), 1 - Math.exp(-9 * dt));

    // --- 연출
    this.gagT -= dt;
    if (this.mode === 'wait') this.gag = (t % 6) < 3.5 ? 'wave' : 'phone';
    else if (Math.abs(k) < 0.004 && this.v > 22) this.gag = 'tuck';
    else if (gap > 2 && gap < 16 && this.gagT < -5) { this.gag = 'look'; this.gagT = 1.2; }
    else if (this.gagT <= 0) this.gag = 'ride';
    if (this.mode === 'wait' && this.sayCool < -9) this._say('wait');

    // 추월 판정
    const sign = gap > 1.5 ? 1 : gap < -1.5 ? -1 : 0;
    if (sign !== 0 && sign !== this.lastGapSign) {
      if (this.lastGapSign !== 0 || t > GRANDPA.kickDelay + 2) {
        if (sign > 0) { this._say('overtake', true); this.events.push({ type: 'overtake' }); }
        else if (this.lastGapSign > 0) { this._say('overtaken'); this.events.push({ type: 'overtaken' }); }
      }
      this.lastGapSign = sign;
    }
    if (!this.finished && this.s >= st.s1) { this.finished = true; this.finishTime = t; this.events.push({ type: 'finish' }); }
  }

  _say(kind, force = false) {
    if (this.sayCool > 0 && !force) return;
    this.sayCool = 4.5;
    this.events.push({ type: 'say', kind });
  }
  say(kind, force = false) { this._say(kind, force); }
}
