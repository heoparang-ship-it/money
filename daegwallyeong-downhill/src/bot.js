// 자동 주행(봇). 밸런스 시뮬레이션, 자동 테스트, 타이틀 화면 데모에 쓴다.
import { clamp, lerp } from './geo.js';
import { DS, solveSpeed } from './track.js';

const G = 9.81;

export class Bot {
  constructor(track, reference, params, opts = {}) {
    this.track = track; this.ref = reference; this.p = params;
    this.skill = opts.skill ?? 0.93;
    this.grip = opts.grip ?? 1;
    this.assist = opts.assist ?? 0.5;
    const p2 = { ...params, mu: params.mu * this.grip };
    this.prof = solveSpeed(track, reference.line, p2, { vStart: 0 });
    this.leanMax = Math.min(1.03, Math.atan(p2.mu));
  }
  _f(s) { return clamp((s - this.ref.iStart * DS) / DS, 0, this.ref.line.D.length - 1.001); }
  _s(arr, f) { const i = f | 0; return lerp(arr[i], arr[i + 1], f - i); }

  control(bike, out = {}) {
    const v = bike.v, La = 5 + v * 0.42;
    const dT = this._s(this.ref.line.D, this._f(bike.s + La));
    const e = dT - bike.d - La * Math.sin(bike.psi);
    const kDes = this.track.curvatureAt(bike.s + La * 0.5) + (2 * e) / (La * La);
    const leanDes = Math.atan((v * v * kDes) / G);
    const tr = this.track.at(bike.s, 0, (this._t ||= {}));
    const leanRoad = Math.atan((v * v * tr.k) / Math.max(0.4, 1 - bike.d * tr.k) / G);
    out.steer = clamp((leanDes - this.assist * leanRoad) / this.leanMax, -1, 1);
    // 앞쪽 0.15초·0.6초 지점 목표 속도 중 낮은 쪽을 따른다
    const vT = Math.min(this._s(this.prof.V, this._f(bike.s + v * 0.15)), this._s(this.prof.V, this._f(bike.s + v * 0.5)) + 1.5) * this.skill;
    out.brake = v > vT + 0.6 ? clamp((v - vT) / 3.5, 0.2, 1) : 0;
    out.throttle = v < vT ? 1 : 0;
    out.boost = false;
    return out;
  }
}
