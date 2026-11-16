// 실제 코스(OSM 507개 정점) -> 주행용 중심선.
// 원본 정점을 모두 지나는 centripetal Catmull-Rom 곡선을 만들고, 꺾임만 살짝 다듬은 뒤 2 m 간격으로 샘플링한다.
// 코너를 지우거나 다시 그리지 않으며, 원본 폴리라인과의 편차를 stats에 기록한다.
import { clamp, lerp, wrapAngle } from './geo.js';

export const DS = 2; // 샘플 간격 (m)
const G = 9.81;

function catmullRomCentripetal(P, perMeter = 1) {
  const out = [];
  const n = P.length;
  const get = (i) => P[clamp(i, 0, n - 1)];
  for (let i = 0; i < n - 1; i++) {
    let p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
    if (i === 0) p0 = [2 * p1[0] - p2[0], 2 * p1[1] - p2[1]];
    if (i === n - 2) p3 = [2 * p2[0] - p1[0], 2 * p2[1] - p1[1]];
    const d = (a, b) => Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), 0.5) || 1e-3;
    const t0 = 0, t1 = t0 + d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3);
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const steps = Math.max(2, Math.ceil(len * perMeter));
    for (let k = 0; k < steps; k++) {
      const t = t1 + ((t2 - t1) * k) / steps;
      const L = (a, b, ta, tb) => [
        (a[0] * (tb - t) + b[0] * (t - ta)) / (tb - ta),
        (a[1] * (tb - t) + b[1] * (t - ta)) / (tb - ta),
      ];
      const A1 = L(p0, p1, t0, t1), A2 = L(p1, p2, t1, t2), A3 = L(p2, p3, t2, t3);
      const B1 = L(A1, A2, t0, t2), B2 = L(A2, A3, t1, t3);
      out.push(L(B1, B2, t1, t2));
    }
  }
  out.push(P[n - 1]);
  return out;
}

function resample(P, step) {
  const cum = [0];
  for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  const total = cum[cum.length - 1];
  const n = Math.floor(total / step) + 1;
  const out = new Array(n);
  let j = 0;
  for (let k = 0; k < n; k++) {
    const s = k * step;
    while (j < cum.length - 2 && cum[j + 1] < s) j++;
    const f = (s - cum[j]) / Math.max(1e-9, cum[j + 1] - cum[j]);
    out[k] = [lerp(P[j][0], P[j + 1][0], f), lerp(P[j][1], P[j + 1][1], f)];
  }
  return out;
}

function gaussSmooth(P, sigma) {
  const r = Math.ceil(sigma * 3);
  const w = [];
  for (let k = -r; k <= r; k++) w.push(Math.exp((-k * k) / (2 * sigma * sigma)));
  const n = P.length, out = new Array(n);
  for (let i = 0; i < n; i++) {
    // 끝점은 그대로 고정
    const rr = Math.min(r, i, n - 1 - i);
    let sx = 0, sz = 0, sw = 0;
    for (let k = -rr; k <= rr; k++) {
      const ww = w[k + r];
      sx += P[i + k][0] * ww; sz += P[i + k][1] * ww; sw += ww;
    }
    out[i] = [sx / sw, sz / sw];
  }
  return out;
}

function boxSmooth(a, r, passes = 1) {
  const n = a.length;
  let src = a;
  for (let p = 0; p < passes; p++) {
    const dst = new Float32Array(n);
    const pre = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + src[i];
    for (let i = 0; i < n; i++) {
      const rr = Math.min(r, i, n - 1 - i);
      dst[i] = (pre[i + rr + 1] - pre[i - rr]) / (2 * rr + 1);
    }
    src = dst;
  }
  return src;
}

function distToSegment(px, pz, a, b) {
  const vx = b[0] - a[0], vz = b[1] - a[1];
  const t = clamp(((px - a[0]) * vx + (pz - a[1]) * vz) / (vx * vx + vz * vz || 1e-9), 0, 1);
  return Math.hypot(px - a[0] - vx * t, pz - a[1] - vz * t);
}

export class Track {
  constructor(course, proj, dem, features) {
    const raw = course.points.map(([lon, lat]) => proj.toLocal(lon, lat));
    this.raw = raw;
    // 긴 직선 구간은 미리 잘게 나눠 스플라인이 현(弦) 밖으로 부풀지 않게 한다
    const ctrl = [raw[0]];
    for (let i = 1; i < raw.length; i++) {
      const a = raw[i - 1], b = raw[i], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len > 28) {
        const cuts = [9 / len];
        for (let d = 24; d < len - 20; d += 16) cuts.push(d / len);
        cuts.push(1 - 9 / len);
        for (const t of cuts) ctrl.push([lerp(a[0], b[0], t), lerp(a[1], b[1], t)]);
      }
      ctrl.push(b);
    }
    let P = catmullRomCentripetal(ctrl, 1.2);
    P = resample(P, 1);
    P = gaussSmooth(P, 2.6);
    P = resample(P, DS);
    const n = (this.n = P.length);
    this.length = (n - 1) * DS;
    const X = (this.X = new Float32Array(n)), Z = (this.Z = new Float32Array(n));
    for (let i = 0; i < n; i++) { X[i] = P[i][0]; Z[i] = P[i][1]; }

    // 원본 폴리라인 대비 편차 (검증용)
    let j = 0, maxDev = 0, sumDev = 0;
    for (let i = 0; i < n; i++) {
      let best = Infinity, bj = j;
      for (let k = Math.max(0, j - 2); k < Math.min(raw.length - 1, j + 6); k++) {
        const d = distToSegment(X[i], Z[i], raw[k], raw[k + 1]);
        if (d < best) { best = d; bj = k; }
      }
      j = bj; maxDev = Math.max(maxDev, best); sumDev += best;
    }
    this.stats = { rawPoints: raw.length, samples: n, length: this.length, maxDeviation: maxDev, meanDeviation: sumDev / n };

    // 접선·곡률
    const TX = (this.TX = new Float32Array(n)), TZ = (this.TZ = new Float32Array(n));
    const th = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
      const dx = X[b] - X[a], dz = Z[b] - Z[a], l = Math.hypot(dx, dz) || 1;
      TX[i] = dx / l; TZ[i] = dz / l;
    }
    for (let i = 0; i < n - 1; i++) th[i] = Math.atan2(-(Z[i + 1] - Z[i]), X[i + 1] - X[i]);
    th[n - 1] = th[n - 2];
    let K = new Float32Array(n);
    for (let i = 1; i < n; i++) K[i] = wrapAngle(th[i] - th[i - 1]) / DS;
    K[0] = K[1];
    K = boxSmooth(K, 2, 2);
    this.K = K;
    const KS = (this.KS = boxSmooth(K, 6, 2)); // 폭·뱅크용으로 더 완만하게

    // 실제 고도 -> 도로 종단 (DEM 잡음 제거를 위해 길이 방향으로만 평활화)
    const rawY = new Float32Array(n);
    for (let i = 0; i < n; i++) rawY[i] = dem.height(X[i], Z[i]);
    this.rawY = rawY;
    let Y = boxSmooth(rawY, 42, 3);
    this.Y = Y;
    const Gr = (this.G = new Float32Array(n));
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 2), b = Math.min(n - 1, i + 2);
      Gr[i] = (Y[b] - Y[a]) / ((b - a) * DS);
    }
    let maxGrade = 0;
    for (let i = 0; i < n; i++) maxGrade = Math.max(maxGrade, Math.abs(Gr[i]));
    this.stats.maxGrade = maxGrade;
    this.stats.elevStart = Y[0]; this.stats.elevEnd = Y[n - 1];

    // 노폭(반폭)과 편경사
    let HW = new Float32Array(n), BANK = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const k = Math.abs(KS[i]);
      HW[i] = 3.8 + clamp((k - 0.012) * 45, 0, 1.4);
      BANK[i] = clamp(KS[i] * 1.6, -0.065, 0.065);
    }
    this.HW = boxSmooth(HW, 8, 2);
    this.BANK = boxSmooth(BANK, 8, 2);

    // 교량 구간
    this.bridges = (features?.bridges || []).map((b) => ({ s0: b.s0 - 4, s1: b.s1 + 4, name: b.name }));
    this.BR = new Uint8Array(n);
    for (const b of this.bridges) for (let i = Math.max(0, Math.floor(b.s0 / DS)); i <= Math.min(n - 1, Math.ceil(b.s1 / DS)); i++) this.BR[i] = 1;

    this._buildHash();
    this.corners = this._findCorners();
  }

  /** 코너 목록: 같은 방향으로 R < 75 m 인 연속 구간. dir: +1 왼쪽, -1 오른쪽. */
  _findCorners() {
    const out = [], K = this.K, TH = 1 / 75;
    let cur = null;
    for (let i = 0; i < this.n; i++) {
      const k = K[i], on = Math.abs(k) > TH;
      if (on && cur && Math.sign(k) === cur.dir) {
        cur.i1 = i; cur.turn += Math.abs(k) * DS;
        if (Math.abs(k) > cur.kMax) { cur.kMax = Math.abs(k); cur.iApex = i; }
      } else {
        if (cur) { out.push(cur); cur = null; }
        if (on) cur = { i0: i, i1: i, iApex: i, dir: Math.sign(k), kMax: Math.abs(k), turn: Math.abs(k) * DS };
      }
    }
    if (cur) out.push(cur);
    return out.filter((c) => c.turn > 0.22).map((c) => ({
      i0: c.i0, i1: c.i1, iApex: c.iApex, s0: c.i0 * DS, s1: c.i1 * DS, sApex: c.iApex * DS,
      dir: c.dir, rMin: 1 / c.kMax, turn: c.turn,
    }));
  }

  _buildHash() {
    const C = (this.cell = 32);
    const map = (this.hash = new Map());
    for (let i = 0; i < this.n; i++) {
      const key = (Math.floor(this.X[i] / C) + 2048) * 4096 + (Math.floor(this.Z[i] / C) + 2048);
      let a = map.get(key);
      if (!a) map.set(key, (a = []));
      a.push(i);
    }
  }

  /** 가장 가까운 중심선 지점. 32 m 안에 도로가 없으면 dist = Infinity. */
  nearest(x, z, out = {}) {
    const C = this.cell, cx = Math.floor(x / C) + 2048, cz = Math.floor(z / C) + 2048;
    const X = this.X, Z = this.Z;
    let best = 1e18, bi = -1;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const arr = this.hash.get((cx + a) * 4096 + (cz + b));
      if (!arr) continue;
      for (let k = 0; k < arr.length; k++) {
        const i = arr[k], dx = X[i] - x, dz = Z[i] - z, d2 = dx * dx + dz * dz;
        if (d2 < best) { best = d2; bi = i; }
      }
    }
    if (bi < 0) { out.dist = Infinity; out.i = -1; return out; }
    // 인접 선분에 투영해 정확한 수선의 발을 구한다
    let bestD = Infinity, bs = bi * DS, bside = 0;
    for (let k = Math.max(0, bi - 1); k <= Math.min(this.n - 2, bi); k++) {
      const vx = X[k + 1] - X[k], vz = Z[k + 1] - Z[k];
      const t = clamp(((x - X[k]) * vx + (z - Z[k]) * vz) / (vx * vx + vz * vz), 0, 1);
      const ex = x - X[k] - vx * t, ez = z - Z[k] - vz * t, d = Math.hypot(ex, ez);
      if (d < bestD) { bestD = d; bs = (k + t) * DS; bside = ex * vz - ez * vx; } // 왼쪽(+) / 오른쪽(-)
    }
    out.dist = bestD; out.s = bs; out.i = bi; out.side = bside >= 0 ? 1 : -1;
    const f = bs / DS, i0 = Math.min(this.n - 2, f | 0), u = f - i0;
    out.y = lerp(this.Y[i0], this.Y[i0 + 1], u);
    out.hw = lerp(this.HW[i0], this.HW[i0 + 1], u);
    out.bank = lerp(this.BANK[i0], this.BANK[i0 + 1], u);
    out.bridge = this.BR[bi];
    return out;
  }

  /** 프레네 좌표 (s, d) -> 월드 좌표와 방향. d는 진행방향 왼쪽이 +. */
  at(s, d = 0, out = {}) {
    const f = clamp(s / DS, 0, this.n - 1.0001), i = f | 0, u = f - i;
    const tx = lerp(this.TX[i], this.TX[i + 1], u), tz = lerp(this.TZ[i], this.TZ[i + 1], u), l = Math.hypot(tx, tz) || 1;
    out.tx = tx / l; out.tz = tz / l;
    out.nx = out.tz; out.nz = -out.tx; // 왼쪽 법선
    out.bank = lerp(this.BANK[i], this.BANK[i + 1], u);
    out.hw = lerp(this.HW[i], this.HW[i + 1], u);
    out.k = lerp(this.K[i], this.K[i + 1], u);
    out.grade = lerp(this.G[i], this.G[i + 1], u);
    out.x = lerp(this.X[i], this.X[i + 1], u) + d * out.nx;
    out.z = lerp(this.Z[i], this.Z[i + 1], u) + d * out.nz;
    out.y = lerp(this.Y[i], this.Y[i + 1], u) - d * out.bank;
    return out;
  }

  curvatureAt(s) {
    const f = clamp(s / DS, 0, this.n - 1.0001), i = f | 0;
    return lerp(this.K[i], this.K[i + 1], f - i);
  }
}

// ---------------------------------------------------------------------------
// 레이싱 라인 (K1999 방식: 이웃 곡률의 평균에 맞춰 각 점을 좌우로 옮긴다)
// ---------------------------------------------------------------------------
export function computeRacingLine(track, i0, i1, margin = 0.9) {
  const STEP = 2; // 샘플 2개(4 m)마다 노드
  const idx = [];
  for (let i = i0; i <= i1; i += STEP) idx.push(i);
  const m = idx.length;
  const cx = new Float64Array(m), cz = new Float64Array(m), nx = new Float64Array(m), nz = new Float64Array(m), w = new Float64Array(m);
  for (let k = 0; k < m; k++) {
    const i = idx[k];
    cx[k] = track.X[i]; cz[k] = track.Z[i];
    nx[k] = track.TZ[i]; nz[k] = -track.TX[i];
    w[k] = Math.max(0.3, track.HW[i] - margin);
  }
  const d = new Float64Array(m), px = new Float64Array(m), pz = new Float64Array(m);
  const upd = (k) => { px[k] = cx[k] + d[k] * nx[k]; pz[k] = cz[k] + d[k] * nz[k]; };
  for (let k = 0; k < m; k++) upd(k);
  const curv = (ax, az, bx, bz, qx, qz) => {
    const x1 = qx - bx, z1 = qz - bz, x2 = ax - bx, z2 = az - bz, x3 = qx - ax, z3 = qz - az;
    const det = x1 * z2 - x2 * z1;
    const nnn = Math.sqrt((x1 * x1 + z1 * z1) * (x2 * x2 + z2 * z2) * (x3 * x3 + z3 * z3));
    return nnn > 1e-9 ? (2 * det) / nnn : 0;
  };
  const adjust = (pv, k, nxt, target) => {
    // 1) prev-next 직선 위로
    const ex = px[nxt] - px[pv], ez = pz[nxt] - pz[pv];
    const den = nx[k] * ez - nz[k] * ex;
    if (Math.abs(den) < 1e-9) return;
    let dd = -((cx[k] - px[pv]) * ez - (cz[k] - pz[pv]) * ex) / den;
    dd = clamp(dd, -w[k] * 1.3, w[k] * 1.3);
    // 2) 목표 곡률이 되도록 뉴턴 한 스텝
    const e = 0.02;
    const c0 = curv(px[pv], pz[pv], cx[k] + dd * nx[k], cz[k] + dd * nz[k], px[nxt], pz[nxt]);
    const c1 = curv(px[pv], pz[pv], cx[k] + (dd + e) * nx[k], cz[k] + (dd + e) * nz[k], px[nxt], pz[nxt]);
    const dc = (c1 - c0) / e;
    if (Math.abs(dc) > 1e-9) dd += (target - c0) / dc;
    d[k] = clamp(dd, -w[k], w[k]);
    upd(k);
  };
  for (let step = 16; step >= 1; step >>= 1) {
    const iters = Math.round(60 * Math.sqrt(step));
    for (let it = 0; it < iters; it++) {
      for (let k = step; k < m - step; k += step) {
        const pv = k - step, nxt = k + step, ppv = Math.max(0, pv - step), nnx = Math.min(m - 1, nxt + step);
        const r0 = pv > 0 ? curv(px[ppv], pz[ppv], px[pv], pz[pv], px[k], pz[k]) : 0;
        const r1 = nxt < m - 1 ? curv(px[k], pz[k], px[nxt], pz[nxt], px[nnx], pz[nnx]) : 0;
        const lp = Math.hypot(px[k] - px[pv], pz[k] - pz[pv]), ln = Math.hypot(px[k] - px[nxt], pz[k] - pz[nxt]);
        adjust(pv, k, nxt, (ln * r0 + lp * r1) / (lp + ln));
      }
    }
    // 중간 노드 보간
    if (step > 1) {
      const h = step >> 1;
      for (let k = h; k < m - h; k += step) {
        const a = k - h, b = Math.min(m - 1, k + h);
        d[k] = clamp((d[a] + d[b]) / 2, -w[k], w[k]); upd(k);
      }
    }
  }
  // 샘플 해상도로 되돌리고 라인 곡률·구간 길이 계산
  const N = i1 - i0 + 1;
  const D = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const f = Math.min(m - 1.0001, i / STEP), k = f | 0;
    D[i] = lerp(d[k], d[k + 1], f - k);
  }
  const Ds = boxSmooth(D, 2, 2);
  const LX = new Float32Array(N), LZ = new Float32Array(N), LK = new Float32Array(N), LDS = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const g = i0 + i;
    LX[i] = track.X[g] + Ds[i] * track.TZ[g]; LZ[i] = track.Z[g] - Ds[i] * track.TX[g];
  }
  for (let i = 0; i < N; i++) {
    const a = Math.max(0, i - 2), b = Math.min(N - 1, i + 2);
    LK[i] = a === i || b === i ? 0 : curv(LX[a], LZ[a], LX[i], LZ[i], LX[b], LZ[b]);
    LDS[i] = i < N - 1 ? Math.hypot(LX[i + 1] - LX[i], LZ[i + 1] - LZ[i]) : DS;
  }
  // curv()의 부호를 트랙 곡률 부호(왼쪽 +)에 맞춘다
  let sgn = 0;
  for (let i = 0; i < N; i++) sgn += LK[i] * track.K[i0 + i];
  if (sgn < 0) for (let i = 0; i < N; i++) LK[i] = -LK[i];
  return { i0, i1, D: Ds, K: boxSmooth(LK, 2, 1), LDS };
}

// ---------------------------------------------------------------------------
// 속도 프로파일 (마찰원 + 엔진/제동 한계 + 실제 경사)
// params: { mu, vTop, a0, pw, brake }  (SI 단위)
// ---------------------------------------------------------------------------
export function dragCoef(p) {
  return Math.max(0, Math.min(p.a0, p.pw / p.vTop) - 0.12) / (p.vTop * p.vTop);
}

export function solveSpeed(track, line, p, opts = {}) {
  const N = line.D.length, i0 = line.i0;
  const V = new Float32Array(N);
  const cd = dragCoef(p), muG = p.mu * G;
  const vStart = opts.vStart ?? 0, vEndCap = opts.vEnd ?? 999;
  for (let i = 0; i < N; i++) {
    const k = Math.max(1e-4, Math.abs(line.K[i]));
    V[i] = Math.min(p.vTop * 1.35, Math.sqrt(muG / k));
  }
  V[N - 1] = Math.min(V[N - 1], vEndCap);
  // 뒤에서 앞으로: 제동 한계
  for (let i = N - 2; i >= 0; i--) {
    const v = V[i + 1], lat = v * v * Math.abs(line.K[i + 1]);
    const fr = Math.sqrt(Math.max(0, 1 - (lat / muG) * (lat / muG)));
    const dec = Math.min(p.brake, muG) * fr + cd * v * v + 0.12 + G * track.G[i0 + i]; // 내리막(grade<0)은 감속을 깎는다
    const vmax = Math.sqrt(v * v + 2 * Math.max(0.5, dec) * line.LDS[i]);
    if (V[i] > vmax) V[i] = vmax;
  }
  // 앞에서 뒤로: 가속 한계
  V[0] = Math.min(V[0], Math.max(vStart, 0.5));
  for (let i = 0; i < N - 1; i++) {
    const v = Math.max(0.5, V[i]), lat = v * v * Math.abs(line.K[i]);
    const fr = Math.sqrt(Math.max(0, 1 - (lat / muG) * (lat / muG)));
    const acc = Math.min(p.a0, p.pw / v) * fr - cd * v * v - 0.12 - G * track.G[i0 + i];
    const vmax = Math.sqrt(Math.max(0.25, v * v + 2 * acc * line.LDS[i]));
    if (V[i + 1] > vmax) V[i + 1] = vmax;
  }
  const T = new Float32Array(N);
  for (let i = 1; i < N; i++) T[i] = T[i - 1] + line.LDS[i - 1] / Math.max(0.5, (V[i] + V[i - 1]) / 2);
  return { V, T, time: T[N - 1] };
}
