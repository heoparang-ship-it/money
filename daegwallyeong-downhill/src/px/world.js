// 탑뷰 도트 월드. 실제 지도(도로·고도·토지피복·건물·하천)를 128 px 청크로 미리 그려 두고 스크롤한다.
// 화면 방향은 스테이지마다 고정: 출발 → 도착이 화면 위쪽을 향하게 돌린다 (도트가 뭉개지지 않도록 회전은 한 번만).
import { DS } from '../track.js';
import { clamp, mulberry32, vnoise } from '../geo.js';
import { buildPalette, BAYER } from './palette.js';
import { makeTreeSprites, makePropSprites } from './sprites.js';
import { mercPx } from '../google.js';

import { MPP, CH } from './const.js';
export { MPP, CH };
const G = 8; // 성긴 격자 간격 (px)
const NN = CH / G + 3;

/** 도로 양옆 상태를 코스 전체에 대해 한 번 계산한다. side 0 = 왼쪽(+d), 1 = 오른쪽. */
export function analyzeRoadsides2D(data) {
  const { track, dem, features } = data;
  const n = track.n, o = {}, q = {};
  const wall = [new Uint8Array(n), new Uint8Array(n)], gap = [new Uint8Array(n), new Uint8Array(n)], warn = new Uint8Array(n);
  const raw = [new Uint8Array(n), new Uint8Array(n)];
  for (let i = 0; i < n; i++) {
    track.at(i * DS, 0, o);
    for (let sd = 0; sd < 2; sd++) {
      const side = sd === 0 ? 1 : -1;
      const rise = dem.height(o.x + o.nx * side * 14, o.z + o.nz * side * 14) - o.y;
      raw[sd][i] = rise > 2.5 && !track.BR[i] ? 1 : 0;
    }
  }
  for (let sd = 0; sd < 2; sd++) for (let i = 0; i < n; i++) {
    let c = 0;
    for (let k = -4; k <= 4; k++) c += raw[sd][clamp(i + k, 0, n - 1)];
    wall[sd][i] = c >= 5 ? 1 : 0;
  }
  const junctions = [];
  for (const r of features.roads || []) {
    const p = r.p, m = p.length / 2;
    for (const [a, b] of [[0, 1], [m - 1, m - 2]]) {
      track.nearest(p[a * 2], -p[a * 2 + 1], q);
      if (q.dist < 3.5 && m >= 2) {
        const i = q.i;
        track.at(q.s, 0, o);
        const side = (p[b * 2] - o.x) * o.nx + (-p[b * 2 + 1] - o.z) * o.nz >= 0 ? 1 : -1;
        const sd = side > 0 ? 0 : 1, half = Math.ceil((r.w / 2 + 2.5) / DS);
        for (let k = -half; k <= half; k++) { const j = clamp(i + k, 0, n - 1); gap[sd][j] = 1; wall[sd][j] = 0; }
        junctions.push({ i, side, w: r.w });
      }
    }
  }
  // 급코너 앞 노면 화살표 구간
  for (const c of track.corners) if (c.rMin < 30) for (let i = Math.max(0, c.i0 - 26); i < c.i0 - 5; i++) warn[i] = c.dir > 0 ? 1 : 2;
  return { wall, gap, junctions, warn };
}

export class PxWorld {
  constructor(data, stage, weather, season) {
    this.data = data; this.track = data.track; this.dem = data.dem; this.lc = data.landcover; this.f = data.features;
    this.stage = stage;
    const t = this.track;
    let dx = t.X[stage.i1] - t.X[stage.i0], dz = t.Z[stage.i1] - t.Z[stage.i0];
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    this.c = -dz; this.s = -dx; // 회전: 진행 방향이 화면 위(−y)
    this.pal = buildPalette(weather, season);
    this.rs = data.roadside2d || (data.roadside2d = analyzeRoadsides2D(data));
    this.trees = makeTreeSprites(this.pal);
    this.props = makePropSprites(this.pal);
    this.chunks = new Map(); this.cap = 420;
    this.sc = document.createElement('canvas'); this.sc.width = CH; this.sc.height = CH;
    this.sctx = this.sc.getContext('2d', { willReadFrequently: true });
    this._q = {}; this._o = {};
    this._prepFeatures();
    this._prepProps();
    this.genCount = 0; this.sat = null;
  }

  /** 구글 위성사진 모자이크({ canvas, z, px0, py0 })를 바닥으로 쓴다. 청크를 만들 때 도트로 바꾼다 */
  setSatellite(m) { this.sat = m; this.chunks.clear(); }

  toPx(x, z, out) { out.x = (x * this.c - z * this.s) / MPP; out.y = (x * this.s + z * this.c) / MPP; return out; }
  toWorld(px, py, out) { out.x = (px * this.c + py * this.s) * MPP; out.z = (-px * this.s + py * this.c) * MPP; return out; }
  /** 도로 좌표 (s, d) → 화면 px */
  trackPx(s, d, out) { const a = this.track.at(s, d, this._o); return this.toPx(a.x, a.z, out); }
  /** 월드 방향 벡터 → 화면 회전각 (위쪽 = 0, 시계 방향 +) */
  angleOf(fx, fz) { return Math.atan2(fx * this.c - fz * this.s, -(fx * this.s + fz * this.c)); }

  // ---------------------------------------------------------------- 피처 준비
  _bin(map, x0, y0, x1, y1, item) {
    for (let cy = Math.floor(y0 / CH); cy <= Math.floor(y1 / CH); cy++) for (let cx = Math.floor(x0 / CH); cx <= Math.floor(x1 / CH); cx++) {
      const k = cx + ',' + cy;
      let a = map.get(k); if (!a) map.set(k, (a = [])); a.push(item);
    }
  }
  _poly(p) {
    const out = new Float32Array(p.length), o = {};
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (let k = 0; k < p.length; k += 2) {
      this.toPx(p[k], -p[k + 1], o);
      out[k] = o.x; out[k + 1] = o.y;
      x0 = Math.min(x0, o.x); x1 = Math.max(x1, o.x); y0 = Math.min(y0, o.y); y1 = Math.max(y1, o.y);
    }
    return { p: out, x0, y0, x1, y1 };
  }
  _prepFeatures() {
    const f = this.f, bins = (this.bins = new Map()), pal = this.pal;
    // 나무가 서면 안 되는 곳 (4 m 격자)
    const lc = this.lc, OC = 4;
    const ox0 = lc.x0, oz0 = -(lc.y0 + lc.ny * lc.step), onx = Math.ceil((lc.nx * lc.step) / OC), onz = Math.ceil((lc.ny * lc.step) / OC);
    const occ = new Uint8Array(onx * onz);
    const mark = (x, z, r) => {
      const i0 = Math.floor((x - r - ox0) / OC), i1 = Math.floor((x + r - ox0) / OC), j0 = Math.floor((z - r - oz0) / OC), j1 = Math.floor((z + r - oz0) / OC);
      for (let j = Math.max(0, j0); j <= Math.min(onz - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(onx - 1, i1); i++) occ[j * onx + i] = 1;
    };
    const markLine = (p, r) => { for (let k = 0; k < p.length - 2; k += 2) { const n = Math.max(1, Math.ceil(Math.hypot(p[k + 2] - p[k], p[k + 3] - p[k + 1]) / 3)); for (let j = 0; j <= n; j++) mark(p[k] + ((p[k + 2] - p[k]) * j) / n, -(p[k + 1] + ((p[k + 3] - p[k + 1]) * j) / n), r); } };
    this.occ = (x, z) => { const i = Math.floor((x - ox0) / OC), j = Math.floor((z - oz0) / OC); return i < 0 || j < 0 || i >= onx || j >= onz ? 0 : occ[j * onx + i]; };
    for (const r of f.roads) {
      const g = this._poly(r.p), w = r.w / MPP;
      this._bin(bins, g.x0 - w, g.y0 - w, g.x1 + w, g.y1 + w, { t: 'road', g, w, col: r.c === 'track' ? pal.dirt : pal.sideRoad, z: 2 });
      markLine(r.p, r.w / 2 + 2.5);
    }
    for (const s of f.streams) {
      const g = this._poly(s.p), w = (s.k === 'river' ? 14 : 1.6) / MPP;
      this._bin(bins, g.x0 - w, g.y0 - w, g.x1 + w, g.y1 + w, { t: 'line', g, w, col: pal.stream, z: 1 });
      markLine(s.p, s.k === 'river' ? 9 : 2.5);
    }
    for (const w of f.waterPolys) { const g = this._poly(w.p); this._bin(bins, g.x0, g.y0, g.x1, g.y1, { t: 'fill', g, col: pal.water, z: 0 }); }
    for (const pk of f.parking) {
      const g = this._poly(pk.p); this._bin(bins, g.x0, g.y0, g.x1, g.y1, { t: 'fill', g, col: pal.parking, z: 2 });
      for (let k = 0; k < pk.p.length; k += 2) mark(pk.p[k], -pk.p[k + 1], 6);
    }
    const q = {};
    f.buildings.forEach((b, bi) => {
      const g = this._poly(b.p);
      let cxw = 0, czw = 0, area = 0;
      const m = b.p.length / 2;
      for (let k = 0; k < m; k++) { const k2 = (k + 1) % m; cxw += b.p[k * 2]; czw -= b.p[k * 2 + 1]; area += b.p[k * 2] * b.p[k2 * 2 + 1] - b.p[k2 * 2] * b.p[k * 2 + 1]; }
      cxw /= m; czw /= m; area = Math.abs(area) / 2;
      this.track.nearest(cxw, czw, q);
      if (area < 14 || q.dist < q.hw + 4) return;
      const r = mulberry32(bi * 31 + 5);
      const hpx = Math.round(((area > 260 || r() < 0.25 ? 6.4 : 3.2) + 1) / MPP * 0.8);
      const item = { t: 'bld', g, hpx, wall: pal.walls[(r() * pal.walls.length) | 0], roof: pal.roofs[(r() * pal.roofs.length) | 0], z: 5, sortY: g.y1 };
      this._bin(bins, g.x0 - 1, g.y0 - hpx - 2, g.x1 + 1, g.y1 + 1, item);
      for (let k = 0; k < b.p.length; k += 2) mark(b.p[k], -b.p[k + 1], 3);
      mark(cxw, czw, Math.sqrt(area) * 0.6 + 2);
    });
  }

  /** 청크에 구워 넣는 소품: 콘, 갈매기표지, 버스정류장, 표지석, 응원단, 풍력발전기 기둥 */
  _prepProps() {
    const t = this.track, f = this.f, st = this.stage, rs = this.rs, P = this.props, list = (this.propBins = new Map()), o = {}, q = {};
    const add = (x, z, spr) => { this.toPx(x, z, o); const it = { x: Math.round(o.x), y: Math.round(o.y), spr }; this._bin(list, it.x - spr.ax - 2, it.y - spr.ay - 2, it.x - spr.ax + spr.c.width + 2, it.y - spr.ay + spr.c.height + 2, it); return it; };
    const at = (i, d) => t.at(clamp(i, 0, t.n - 1) * DS, d, this._o);
    for (const j of rs.junctions) { const half = Math.ceil((j.w / 2 + 1.5) / DS); for (let k = -half; k <= half; k += 1) { const a = at(j.i + k, j.side * (t.HW[clamp(j.i + k, 0, t.n - 1)] + 1.1)); add(a.x, a.z, P.cone); } }
    for (const c of t.corners) {
      if (c.rMin > 34) continue;
      const side = -c.dir, kTh = 0.55 / c.rMin;
      let last = -99;
      for (let i = c.i0; i <= c.i1; i++) {
        if (Math.abs(t.K[i]) < kTh || i - last < 5) continue;
        last = i;
        if (rs.gap[side > 0 ? 0 : 1][i]) continue;
        const a = at(i, side * (t.HW[i] + 2.4));
        add(a.x, a.z, c.dir > 0 ? P.chevL : P.chevR);
      }
    }
    for (const b of f.busStops) { t.nearest(b.p[0], -b.p[1], q); if (q.dist < 30) { const i = Math.round(q.s / DS), a = at(i, q.side * (t.HW[clamp(i, 0, t.n - 1)] + 4.2)); add(a.x, a.z, P.busStop); } }
    for (const v of f.viewpoints) if (v.s < 200) add(v.p[0], -v.p[1], P.stele);
    for (const p of f.pois) {
      if (p.name.includes('기념비')) add(p.p[0], -p.p[1], P.tower);
      else if (p.name.includes('사친시비')) { t.nearest(p.p[0], -p.p[1], q); const a = t.at(q.s, q.side * (q.hw + 5), this._o); add(a.x, a.z, P.stele); }
    }
    this.turbines = f.turbines.map((tb) => { const it = add(tb[0], -tb[1], P.turbine); return { x: it.x, y: it.y - P.turbine.top, ph: (tb[0] * 0.01) % 6.28 }; });
    for (const tw of f.towers) add(tw[0], -tw[1], P.pylon);
    // 도착점 응원단
    const rn = mulberry32(st.id * 13 + 1);
    for (let k = 0; k < 14; k++) { const side = k % 2 ? 1 : -1, i = st.i1 + 2 + ((k * 1.2) | 0), a = at(i, side * (t.HW[clamp(i, 0, t.n - 1)] + 3 + rn() * 3)); add(a.x, a.z, P.fans[(rn() * P.fans.length) | 0]); }
    // 출발·도착 게이트 (기둥은 굽고, 현수막은 주행 중에 바이크 위로 그린다)
    this.gates = [st.i0, st.i1].map((i, k) => {
      const hw = t.HW[i] + 1.6, L = this.toPx(at(i, hw).x, this._o.z, {}), R = this.toPx(at(i, -hw).x, this._o.z, {});
      add(at(i, hw).x, this._o.z, P.post); add(at(i, -hw).x, this._o.z, P.post);
      return { ax: L.x, ay: L.y, bx: R.x, by: R.y, finish: k === 1 };
    });
  }

  // ---------------------------------------------------------------- 청크
  chunk(cx, cy) {
    const k = cx + ',' + cy;
    let c = this.chunks.get(k);
    if (c) { this.chunks.delete(k); this.chunks.set(k, c); return c; }
    return null;
  }
  ensure(cx, cy) {
    const k = cx + ',' + cy;
    if (this.chunks.has(k)) return false;
    this.chunks.set(k, this._gen(cx, cy));
    if (this.chunks.size > this.cap) this.chunks.delete(this.chunks.keys().next().value);
    this.genCount++;
    return true;
  }
  /** 화면 영역(+여유)에 필요한 청크 중 없는 것을 budget개까지 만든다. 반환: 아직 남은 개수 */
  ensureRect(x0, y0, x1, y1, budget) {
    let left = 0;
    for (let cy = Math.floor(y0 / CH); cy <= Math.floor(y1 / CH); cy++) for (let cx = Math.floor(x0 / CH); cx <= Math.floor(x1 / CH); cx++) {
      if (this.chunks.has(cx + ',' + cy)) continue;
      if (budget > 0) { this.ensure(cx, cy); budget--; } else left++;
    }
    return left;
  }

  _gen(cx, cy) {
    const x0 = cx * CH, y0 = cy * CH, c = this.c, s = this.s, t = this.track, dem = this.dem, pal = this.pal, rs = this.rs, st = this.stage;
    const cv = document.createElement('canvas'); cv.width = CH; cv.height = CH;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(CH, CH), D = img.data;
    // --- 성긴 격자: 고도, 가장 가까운 도로
    const hN = new Float32Array(NN * NN), dN = new Float32Array(NN * NN), sN = new Float32Array(NN * NN), wN = new Float32Array(NN * NN), iN = new Int32Array(NN * NN), shN = new Float32Array(NN * NN);
    const q = this._q;
    let anyRoad = false;
    for (let j = 0; j < NN; j++) for (let i = 0; i < NN; i++) {
      const px = x0 + (i - 1) * G, py = y0 + (j - 1) * G, wx = (px * c + py * s) * MPP, wz = (-px * s + py * c) * MPP, o = j * NN + i;
      hN[o] = dem.height(wx, wz);
      t.nearest(wx, wz, q);
      if (q.dist === Infinity) { iN[o] = -1; dN[o] = 1e4; } else { iN[o] = q.i; dN[o] = q.dist * q.side; sN[o] = q.s; wN[o] = q.hw; anyRoad = true; }
    }
    const kSh = 0.95 / (2 * G * MPP * 1.414);
    for (let j = 1; j < NN - 1; j++) for (let i = 1; i < NN - 1; i++) { const o = j * NN + i; shN[o] = clamp(0.5 + (hN[o + 1] - hN[o - 1] + hN[o + NN] - hN[o - NN]) * kSh, 0, 1); }
    // --- 지형
    const lc = this.lc, land = pal.land, sat = this.sat ? this._satPixels(x0, y0) : null, tint = pal.tint;
    for (let y = 0; y < CH; y++) {
      const gy = y / G + 1, j0 = gy | 0, fy = gy - j0;
      for (let x = 0; x < CH; x++) {
        const gx = x / G + 1, i0 = gx | 0, fx = gx - i0, o = j0 * NN + i0;
        const sh = (shN[o] * (1 - fx) + shN[o + 1] * fx) * (1 - fy) + (shN[o + NN] * (1 - fx) + shN[o + NN + 1] * fx) * fy;
        const px = x0 + x, py = y0 + y, wx = (px * c + py * s) * MPP, wz = (-px * s + py * c) * MPP;
        if (sat) {
          // 위성사진: 채도를 올리고 색 단계를 줄여(디더링) 도트 그림처럼 만든다
          const p = (y * CH + x) << 2, th = ((BAYER[(px & 3) + ((py & 3) << 2)] - 7.5) / 16) * 0.85;
          const r0 = sat[p], g0 = sat[p + 1], b0 = sat[p + 2], lum = (r0 * 3 + g0 * 6 + b0) / 10;
          for (let k = 0; k < 3; k++) {
            let v = lum + (sat[p + k] - lum) * 1.45; v = (v * 1.12 + 6) * (0.82 + sh * 0.36);
            v = Math.round((v / 255) * 5 + th) * 51;
            if (tint) v = v * tint.m[k] + tint.a[k];
            D[p + k] = v < 0 ? 0 : v > 255 ? 255 : v;
          }
          D[p + 3] = 255;
          continue;
        }
        const n1 = vnoise(wx * 0.045, wz * 0.045), n2 = vnoise(wx * 0.045 + 9.1, wz * 0.045 + 3.3);
        const cls = lc.at(wx + (n1 - 0.5) * 26, wz + (n2 - 0.5) * 26);
        const by = BAYER[(px & 3) + ((py & 3) << 2)];
        let lv = Math.floor(sh * 4.999 + (by - 7.5) / 16 * 0.62);
        // 숲 바닥 얼룩
        if (cls <= 1 && ((px * 7 + py * 13 + ((px * py) & 15)) & 31) === 0) lv--;
        const col = (land[cls] || land[1])[lv < 0 ? 0 : lv > 4 ? 4 : lv];
        const p = (y * CH + x) << 2;
        D[p] = col[0]; D[p + 1] = col[1]; D[p + 2] = col[2]; D[p + 3] = 255;
      }
    }
    // --- 벡터 레이어 (하천·샛길·주차장·건물): 캔버스로 그린 뒤 팔레트로 스냅해 도트로 만든다
    const items = this.bins.get(cx + ',' + cy);
    if (items && items.length && !sat) this._vectorLayer(items, x0, y0, D);
    // --- 주 도로
    if (anyRoad) this._roadPass(D, x0, y0, dN, sN, wN, iN);
    ctx.putImageData(img, 0, 0);
    // --- 나무와 소품 (아래에 있는 것이 위를 덮도록 y 순서)
    this._bake(ctx, cx, cy, x0, y0);
    return cv;
  }

  /** 이 청크 자리에 해당하는 위성사진을 화면 방향으로 돌려 뽑는다 (웹 메르카토르 → 청크 px, 청크 단위 아핀 근사) */
  _satPixels(x0, y0) {
    const m = this.sat, g = this.sctx, w = {}, pr = this.data.proj;
    const P = (px, py) => { this.toWorld(px, py, w); const ll = pr.toLonLat(w.x, w.z), mp = mercPx(ll[0], ll[1], m.z); return [mp[0] - m.px0, mp[1] - m.py0]; };
    const a = P(x0, y0), b = P(x0 + CH, y0), d = P(x0, y0 + CH);
    const m11 = (b[0] - a[0]) / CH, m21 = (b[1] - a[1]) / CH, m12 = (d[0] - a[0]) / CH, m22 = (d[1] - a[1]) / CH, det = m11 * m22 - m12 * m21;
    const i11 = m22 / det, i12 = -m12 / det, i21 = -m21 / det, i22 = m11 / det;
    g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#3a5a34'; g.fillRect(0, 0, CH, CH);
    g.setTransform(i11, i21, i12, i22, -(i11 * a[0] + i12 * a[1]), -(i21 * a[0] + i22 * a[1]));
    g.imageSmoothingEnabled = true;
    g.drawImage(m.canvas, 0, 0);
    g.setTransform(1, 0, 0, 1, 0, 0);
    return g.getImageData(0, 0, CH, CH).data;
  }

  _vectorLayer(items, x0, y0, D) {
    const g = this.sctx, pal = this.pal;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, CH, CH);
    g.setTransform(1, 0, 0, 1, -x0, -y0);
    g.lineJoin = g.lineCap = 'round';
    const colors = [];
    const use = (c) => { const k = pal.css(c); if (!colors.some((e) => e[3] === k)) colors.push([c[0], c[1], c[2], k]); return k; };
    const path = (p, close) => { g.beginPath(); for (let k = 0; k < p.length; k += 2) { if (k) g.lineTo(p[k], p[k + 1]); else g.moveTo(p[k], p[k + 1]); } if (close) g.closePath(); };
    const sorted = items.slice().sort((a, b) => a.z - b.z || (a.sortY || 0) - (b.sortY || 0));
    for (const it of sorted) {
      if (it.t === 'fill') { path(it.g.p, true); g.fillStyle = use(it.col); g.fill(); }
      else if (it.t === 'line' || it.t === 'road') { path(it.g.p, false); g.strokeStyle = use(it.col); g.lineWidth = it.w; g.stroke(); }
      else if (it.t === 'bld') {
        const p = it.g.p, m = p.length / 2, h = it.hpx;
        const wallDark = [it.wall[0] * 0.72, it.wall[1] * 0.7, it.wall[2] * 0.8].map(Math.round);
        // 아래(화면 쪽)를 향한 벽면
        for (let k = 0; k < m; k++) {
          const k2 = (k + 1) % m, ax = p[k * 2], ay = p[k * 2 + 1], bx = p[k2 * 2], by = p[k2 * 2 + 1];
          g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.lineTo(bx, by - h); g.lineTo(ax, ay - h); g.closePath();
          g.fillStyle = use(Math.abs(bx - ax) > Math.abs(by - ay) ? it.wall : wallDark); g.fill();
        }
        g.beginPath(); for (let k = 0; k < m; k++) { if (k) g.lineTo(p[k * 2], p[k * 2 + 1] - h); else g.moveTo(p[k * 2], p[k * 2 + 1] - h); } g.closePath();
        g.fillStyle = use(it.roof); g.fill();
        g.strokeStyle = use([it.roof[0] * 0.7, it.roof[1] * 0.7, it.roof[2] * 0.78].map(Math.round)); g.lineWidth = 1.4; g.stroke();
      }
    }
    const S = g.getImageData(0, 0, CH, CH).data;
    for (let p = 0; p < S.length; p += 4) {
      if (S[p + 3] < 128) continue;
      let best = 1e9, bc = colors[0];
      for (let k = 0; k < colors.length; k++) { const e = colors[k], d = (e[0] - S[p]) ** 2 + (e[1] - S[p + 1]) ** 2 + (e[2] - S[p + 2]) ** 2; if (d < best) { best = d; bc = e; } }
      D[p] = bc[0]; D[p + 1] = bc[1]; D[p + 2] = bc[2];
    }
  }

  _roadPass(D, x0, y0, dN, sN, wN, iN) {
    const c = this.c, s = this.s, t = this.track, pal = this.pal, rs = this.rs, st = this.stage, q = this._q;
    const A = pal.asphalt, s0 = st.i0 * DS, s1 = st.i1 * DS;
    for (let cyc = 0; cyc < CH / G; cyc++) for (let cxc = 0; cxc < CH / G; cxc++) {
      const o = (cyc + 1) * NN + cxc + 1, ia = iN[o], ib = iN[o + 1], ic = iN[o + NN], id = iN[o + NN + 1];
      if (ia < 0 && ib < 0 && ic < 0 && id < 0) continue;
      const mn = Math.min(ia, ib, ic, id), mx = Math.max(ia, ib, ic, id);
      const exact = mn < 0 || mx - mn > 40;
      if (!exact && Math.min(Math.abs(dN[o]), Math.abs(dN[o + 1]), Math.abs(dN[o + NN]), Math.abs(dN[o + NN + 1])) > 20) continue;
      for (let yy = 0; yy < G; yy++) for (let xx = 0; xx < G; xx++) {
        const x = cxc * G + xx, y = cyc * G + yy, px = x0 + x, py = y0 + y;
        let d, sa, hw, idx;
        if (exact) {
          t.nearest((px * c + py * s) * MPP, (-px * s + py * c) * MPP, q);
          if (q.dist > 14) continue;
          d = q.dist * q.side; sa = q.s; hw = q.hw; idx = q.i;
        } else {
          const fx = xx / G, fy = yy / G;
          d = (dN[o] * (1 - fx) + dN[o + 1] * fx) * (1 - fy) + (dN[o + NN] * (1 - fx) + dN[o + NN + 1] * fx) * fy;
          if (d > 14 || d < -14) continue;
          sa = (sN[o] * (1 - fx) + sN[o + 1] * fx) * (1 - fy) + (sN[o + NN] * (1 - fx) + sN[o + NN + 1] * fx) * fy;
          hw = (wN[o] * (1 - fx) + wN[o + 1] * fx) * (1 - fy) + (wN[o + NN] * (1 - fx) + wN[o + NN + 1] * fx) * fy;
          idx = clamp(Math.round(sa / DS), 0, t.n - 1);
        }
        const a = d < 0 ? -d : d, sd = d >= 0 ? 0 : 1, p = (y * CH + x) << 2;
        const hsh = ((px * 73856093) ^ (py * 19349663)) >>> 0;
        let col = null;
        if (a <= hw) {
          col = A[(hsh % 23) === 0 ? 1 : (hsh % 31) === 0 ? 2 : 0];
          if (a >= 0.13 && a < 0.44) col = pal.yellow;
          else if (a >= hw - 0.72 && a < hw - 0.4) col = pal.white;
          const e0 = sa - s0, e1 = sa - s1;
          if ((e0 > -1.25 && e0 < 1.25) || (e1 > -1.25 && e1 < 1.25)) {
            const v = Math.floor(((e0 > -1.25 && e0 < 1.25 ? e0 : e1) + 1.25) / 0.625), u = Math.floor((d + 40) / 0.625);
            col = (u + v) & 1 ? pal.white : pal.ink;
          } else if (rs.warn[idx] && a > 0.7 && a < hw - 1.1 && sd === 1) {
            // 급코너 앞 노면 화살표 (하행 차로)
            const m = (((sa * 0.5 + Math.abs(a - hw * 0.5) * 0.6) % 3) + 3) % 3;
            if (m < 0.42) col = pal.paint;
          }
        } else if (a <= hw + 0.95) {
          const k = t.K[idx] * (sd === 0 ? 1 : -1);
          if (k > 0.034) col = (Math.floor(sa / 1.25) & 1) ? pal.curbR : pal.curbW;
          else col = pal.gravel[hsh % 3 === 0 ? 1 : 0];
        } else if (a <= hw + 1.55) {
          if (rs.gap[sd][idx]) continue;
          if (t.BR[idx]) col = pal.parapet;
          else if (rs.wall[sd][idx]) col = pal.wall;
          else col = ((sa % 4) + 4) % 4 < 0.5 ? pal.railPost : pal.rail;
        } else if (a <= hw + 2.3) {
          if (rs.gap[sd][idx]) continue;
          if (t.BR[idx]) col = pal.gully;
          else if (rs.wall[sd][idx]) col = pal.wallDark;
          else { D[p] = D[p] * 0.72; D[p + 1] = D[p + 1] * 0.7; D[p + 2] = D[p + 2] * 0.8; continue; }
        } else if (a <= hw + 7) {
          const pr = 1 - (a - hw - 2.3) / 4.7;
          if (BAYER[(px & 3) + ((py & 3) << 2)] / 16 < pr * 0.9) col = t.BR[idx] ? pal.gully : rs.wall[sd][idx] ? pal.cut : pal.verge;
          else continue;
        } else continue;
        D[p] = col[0]; D[p + 1] = col[1]; D[p + 2] = col[2];
      }
    }
  }

  /** 청크 영역에 걸치는 나무·소품을 그린다 */
  _bake(ctx, cx, cy, x0, y0) {
    const list = [], t = this.track, lc = this.lc, q = this._q, w = {}, o = {};
    // 나무: 월드에 고정된 지터 격자에서 결정적으로 뽑는다
    const SP = 4.3, padX = 14, padTop = 6, padBot = 44;
    let wx0 = 1e9, wx1 = -1e9, wz0 = 1e9, wz1 = -1e9;
    for (const [px, py] of [[x0 - padX, y0 - padTop], [x0 + CH + padX, y0 - padTop], [x0 - padX, y0 + CH + padBot], [x0 + CH + padX, y0 + CH + padBot]]) {
      this.toWorld(px, py, w); wx0 = Math.min(wx0, w.x); wx1 = Math.max(wx1, w.x); wz0 = Math.min(wz0, w.z); wz1 = Math.max(wz1, w.z);
    }
    const upx = -this.s, upz = -this.c; // 화면 위쪽에 해당하는 월드 방향
    if (!this.sat) for (let gz = Math.floor(wz0 / SP); gz <= Math.floor(wz1 / SP); gz++) for (let gx = Math.floor(wx0 / SP); gx <= Math.floor(wx1 / SP); gx++) {
      const r = mulberry32((gx * 73856093) ^ (gz * 19349663));
      const x = (gx + r()) * SP, z = (gz + r()) * SP;
      this.toPx(x, z, o);
      const px = Math.round(o.x), py = Math.round(o.y);
      if (px < x0 - padX || px > x0 + CH + padX || py < y0 - padTop || py > y0 + CH + padBot) continue;
      const cls = lc.at(x, z);
      const dens = cls <= 1 ? 0.96 : cls === 2 ? 0.3 : cls === 4 ? 0.1 : cls === 3 ? 0.04 : cls === 6 ? 0 : 0.03;
      if (r() > dens || this.occ(x, z)) continue;
      const y = this.dem.height(x, z), tr = r();
      const kind = y > 520 ? (tr < 0.5 ? 'pine' : tr < 0.72 ? 'larch' : 'decid') : tr < 0.3 ? 'pine' : tr < 0.4 ? 'larch' : 'decid';
      const arr = this.trees[kind], spr = arr[(r() * arr.length) | 0];
      // 도로를 가리지 않게: 밑동과 수관(화면 위로 올라간 위치) 모두 도로에서 떨어져 있어야 한다
      t.nearest(x, z, q);
      if (q.dist < q.hw + 3.6) continue;
      t.nearest(x + upx * spr.hm, z + upz * spr.hm, q);
      if (q.dist < q.hw + spr.rm + 1.2) continue;
      list.push({ x: px, y: py, spr });
    }
    const props = this.propBins.get(cx + ',' + cy);
    if (props) for (const p of props) list.push(p);
    list.sort((a, b) => a.y - b.y);
    for (const it of list) if (it.spr.sh) ctx.drawImage(it.spr.sh, it.x - x0 - it.spr.shx, it.y - y0 - it.spr.shy);
    for (const it of list) ctx.drawImage(it.spr.c, it.x - x0 - it.spr.ax, it.y - y0 - it.spr.ay);
  }

  /** 타이어 자국 (청크 캔버스에 직접 남긴다) */
  skid(px, py, alpha = 0.3) {
    const cx = Math.floor(px / CH), cy = Math.floor(py / CH), cv = this.chunks.get(cx + ',' + cy);
    if (!cv) return;
    const g = cv.getContext('2d');
    g.fillStyle = `rgba(24,14,48,${alpha})`;
    g.fillRect(Math.round(px) - cx * CH, Math.round(py) - cy * CH, 1, 1);
  }
}
