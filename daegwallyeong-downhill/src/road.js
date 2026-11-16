// 도로: 아스팔트 띠, 갓길, 가드레일, 옹벽·절토면, 교량 난간, 갈매기표지, 노면 표시.
import * as THREE from 'three';
import { DS } from './track.js';
import { GeoBuf } from './geobuf.js';
import { clamp, vnoise } from './geo.js';

const CHUNK = 128; // 샘플 수 (256 m)

/** 도로 양옆 상태(옹벽 높이 등)를 코스 전체에 대해 한 번 계산한다. side 0 = 왼쪽(+d), 1 = 오른쪽(-d). */
export function analyzeRoadsides(world) {
  const { track, dem, terrain, features } = world;
  const n = track.n;
  const wallH = [new Float32Array(n), new Float32Array(n)];
  const lidExt = [new Float32Array(n), new Float32Array(n)];
  const gap = [new Uint8Array(n), new Uint8Array(n)];
  const o = {}, q = {};
  for (let i = 0; i < n; i++) {
    track.at(i * DS, 0, o);
    for (let sd = 0; sd < 2; sd++) {
      const side = sd === 0 ? 1 : -1;
      const rise = dem.height(o.x + o.nx * side * 14, o.z + o.nz * side * 14) - o.y;
      let h = rise > 2.5 ? clamp(rise * 0.3, 0.9, 3.0) : 0;
      let ext = 9;
      const k = track.K[i] * side;
      if (k > 0) ext = Math.min(ext, 0.7 / k - o.hw - 1);
      if (h > 0) {
        if (ext < 2.5 || track.BR[i]) h = 0;
        else {
          const ox = o.x + o.nx * side * (o.hw + 0.9 + ext), oz = o.z + o.nz * side * (o.hw + 0.9 + ext);
          track.nearest(ox, oz, q);
          if (Math.abs(q.i - i) > 40 && q.dist < q.hw + 5) h = 0; // 다른 굽이가 바로 옆
          else {
            h = Math.min(h, terrain.heightAt(ox, oz) - o.y - 0.1);
            if (h < 0.7) h = 0;
          }
        }
      }
      wallH[sd][i] = h; lidExt[sd][i] = Math.max(0, ext);
    }
  }
  // 짧게 끊기는 옹벽 정리 + 끝단 낮추기
  for (let sd = 0; sd < 2; sd++) {
    const src = wallH[sd], on = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      let c = 0;
      for (let k = -3; k <= 3; k++) if (src[clamp(i + k, 0, n - 1)] > 0) c++;
      on[i] = c >= 4 ? 1 : 0;
    }
    const sm = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      if (!on[i]) continue;
      let s = 0, c = 0;
      for (let k = -4; k <= 4; k++) { const v = src[clamp(i + k, 0, n - 1)]; if (v > 0) { s += v; c++; } }
      sm[i] = c ? s / c : 0.9;
    }
    for (let i = 0; i < n; i++) {
      if (!on[i]) { src[i] = 0; continue; }
      let e = 4;
      for (let k = 1; k <= 3; k++) if (!on[clamp(i - k, 0, n - 1)] || !on[clamp(i + k, 0, n - 1)]) { e = k; break; }
      src[i] = Math.max(0.35, sm[i] * (e === 4 ? 1 : 0.3 + 0.2 * e));
    }
  }
  // 샛길 합류부: 가드레일을 비운다
  const junctions = [];
  for (const r of features.roads || []) {
    const p = r.p, m = p.length / 2;
    for (const [a, b] of [[0, 1], [m - 1, m - 2]]) {
      const x = p[a * 2], z = -p[a * 2 + 1];
      track.nearest(x, z, q);
      if (q.dist < 3.5 && m >= 2) {
        const i = q.i, s = q.s;
        track.nearest(p[b * 2], -p[b * 2 + 1], q);
        // 두 번째 점이 어느 쪽에 있는지로 방향 판정
        track.at(s, 0, o);
        const side = (p[b * 2] - o.x) * o.nx + (-p[b * 2 + 1] - o.z) * o.nz >= 0 ? 1 : -1;
        const sd = side > 0 ? 0 : 1, half = Math.ceil((r.w / 2 + 2.5) / DS);
        for (let k = -half; k <= half; k++) { const j = clamp(i + k, 0, n - 1); gap[sd][j] = 1; wallH[sd][j] = 0; }
        junctions.push({ s, i, side, w: r.w });
      }
    }
  }
  return { wallH, lidExt, gap, junctions };
}

export function buildRoad(world, stage, env) {
  const { track, terrain } = world;
  const rs = world.roadside;
  const pal = env.palette;
  const group = new THREE.Group();
  group.name = 'road';
  const matRoad = new THREE.MeshLambertMaterial({ map: env.tex.asphalt, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const matFurn = new THREE.MeshLambertMaterial({ map: env.tex.grain, vertexColors: true, side: THREE.DoubleSide });
  const matSign = new THREE.MeshLambertMaterial({ map: env.tex.signs.texture, alphaTest: 0.5, side: THREE.DoubleSide });
  const matDecal = new THREE.MeshLambertMaterial({ map: env.tex.decals.texture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
  const matGlow = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, toneMapped: false });
  const matFlat = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 });

  const n = track.n;
  const o = {};
  // 샘플별 프레임 캐시
  const F = { x: track.X, z: track.Z, y: track.Y, nx: track.TZ, nzNeg: track.TX, bank: track.BANK, hw: track.HW };
  const P = (i, d, dy, out) => {
    out[0] = F.x[i] + d * F.nx[i]; out[1] = F.y[i] - d * F.bank[i] + dy; out[2] = F.z[i] - d * F.nzNeg[i];
    return out;
  };
  const t3 = [0, 0, 0];
  const CONC = [0.62, 0.62, 0.6], RAIL = [0.74, 0.76, 0.78], POST = [0.5, 0.52, 0.54], GRAVEL = pal.gravel, SOIL = pal.verge;

  const signBuf = new GeoBuf(), decalBuf = new GeoBuf(), glowBuf = new GeoBuf(), flatBuf = new GeoBuf();

  for (let c0 = 0; c0 < n - 1; c0 += CHUNK) {
    const c1 = Math.min(n - 1, c0 + CHUNK);
    const inStage = c1 >= stage.i0 - 150 && c0 <= stage.i1 + 150;
    const road = new GeoBuf(), furn = new GeoBuf();
    const L = [], R = [];
    for (let i = c0; i <= c1; i++) {
      const hw = F.hw[i], s = i * DS;
      const shade = 0.86 + 0.2 * vnoise(s * 0.045, 3.3) + 0.06 * vnoise(s * 0.6, 9.1);
      P(i, hw, 0, t3); L.push(road.v(t3[0], t3[1], t3[2], 0, 1, 0, shade, shade, shade, 0, s / 12));
      P(i, -hw, 0, t3); R.push(road.v(t3[0], t3[1], t3[2], 0, 1, 0, shade, shade, shade, 1, s / 12));
    }
    road.strip(L, R);
    const mr = new THREE.Mesh(road.toGeometry(), matRoad);
    mr.receiveShadow = true; mr.matrixAutoUpdate = false;
    group.add(mr);

    for (let sd = 0; sd < 2; sd++) {
      const side = sd === 0 ? 1 : -1;
      const wall = rs.wallH[sd], gap = rs.gap[sd];
      // 줄(row) 인덱스 저장소
      const rows = {};
      const row = (name) => (rows[name] ||= []);
      let prevType = -1;
      const flush = () => {
        // 왼쪽(sd 0)은 줄 순서를 뒤집어야 면이 도로 쪽·위쪽을 향한다 (양면 재질도 감긴 방향으로 법선을 정한다)
        const S = (a, b) => {
          if (!rows[a] || !rows[b] || rows[a].length < 2 || rows[a].length !== rows[b].length) return;
          if (sd === 0) furn.strip(rows[b], rows[a]); else furn.strip(rows[a], rows[b]);
        };
        S('sh0', 'sh1'); S('sh1', 'emb');
        S('w0', 'w1'); S('w1', 'w2'); S('w2', 'lid');
        S('g0', 'g1'); S('g1', 'g2'); S('g2', 'g3'); S('g3', 'g4');
        S('p0', 'p1'); S('p1', 'p2'); S('p2', 'p3'); S('p3', 'p4');
        for (const k in rows) rows[k].length = 0;
      };
      for (let i = c0; i <= c1; i++) {
        const hw = F.hw[i], s = i * DS;
        const type = gap[i] ? 0 : track.BR[i] ? 3 : wall[i] > 0 ? 2 : 1;
        if (type !== prevType && prevType !== -1) {
          // 타입이 바뀌면 띠를 끊되, 이어 보이도록 현재 샘플을 양쪽에 모두 넣는다
          addSample(i, prevType, hw, s, side, sd, true);
          flush();
        }
        addSample(i, type, hw, s, side, sd, false);
        prevType = type;
      }
      flush();

      function addSample(i, type, hw, s, side, sd, closing) {
        const nxs = F.nx[i] * side, nzs = -F.nzNeg[i] * side; // 바깥 방향
        const jit = 0.9 + 0.2 * vnoise(s * 0.3, sd * 7.7);
        // 갓길
        P(i, side * hw, 0.0, t3); row('sh0').push(furn.v(t3[0], t3[1], t3[2], 0, 1, 0, GRAVEL[0] * jit, GRAVEL[1] * jit, GRAVEL[2] * jit, s / 3, 0));
        P(i, side * (hw + 0.5), -0.05, t3); row('sh1').push(furn.v(t3[0], t3[1], t3[2], 0, 1, 0, GRAVEL[0] * jit * 0.92, GRAVEL[1] * jit * 0.92, GRAVEL[2] * jit * 0.92, s / 3, 0.3));
        if (type === 2) {
          const h = wall[i], d0 = hw + 0.55;
          const cj = 0.88 + 0.2 * vnoise(s * 0.21, 5 + sd);
          P(i, side * d0, -0.35, t3); row('w0').push(furn.v(t3[0], t3[1], t3[2], -nxs, 0.15, -nzs, CONC[0] * cj * 0.82, CONC[1] * cj * 0.82, CONC[2] * cj * 0.8, s / 2.5, 0));
          P(i, side * d0, h, t3); row('w1').push(furn.v(t3[0], t3[1], t3[2], -nxs, 0.15, -nzs, CONC[0] * cj, CONC[1] * cj, CONC[2] * cj, s / 2.5, h / 2.5));
          P(i, side * (d0 + 0.35), h, t3); row('w2').push(furn.v(t3[0], t3[1], t3[2], 0, 1, 0, CONC[0] * cj * 1.06, CONC[1] * cj * 1.06, CONC[2] * cj * 1.06, s / 2.5, h / 2.5 + 0.15));
          const ext = rs.lidExt[sd][i];
          P(i, side * (d0 + 0.35 + ext), 0, t3);
          const ty = terrain.heightAt(t3[0], t3[2]) - 0.4;
          const sj = 0.8 + 0.4 * vnoise(s * 0.13, 11 + sd);
          row('lid').push(furn.v(t3[0], ty, t3[2], -nxs * 0.5, 0.86, -nzs * 0.5, SOIL[0] * sj, SOIL[1] * sj, SOIL[2] * sj, s / 3, 3));
        } else {
          P(i, side * (hw + 1.9), -0.8, t3); row('emb').push(furn.v(t3[0], t3[1], t3[2], nxs * 0.5, 0.86, nzs * 0.5, SOIL[0] * jit, SOIL[1] * jit, SOIL[2] * jit, s / 3, 1));
        }
        if (type === 1) {
          const d0 = hw + 0.42;
          const prof = [[0, 0.42, 0.92], [0.05, 0.5, 0.78], [0, 0.58, 1.0], [0.05, 0.66, 0.78], [0, 0.74, 0.95]];
          for (let k = 0; k < 5; k++) {
            P(i, side * (d0 + prof[k][0]), prof[k][1], t3);
            const sh = prof[k][2];
            row('g' + k).push(furn.v(t3[0], t3[1], t3[2], -nxs, 0.1, -nzs, RAIL[0] * sh, RAIL[1] * sh, RAIL[2] * sh, s / 2, k / 4));
          }
          if (!closing && i % 2 === 0) {
            P(i, side * (d0 + 0.13), 0.33, t3);
            furn.box(t3[0], t3[1], t3[2], 0.09, 0.86, 0.09, POST, Math.atan2(F.nzNeg[i], F.nx[i]) + Math.PI / 2);
          }
          if (!closing && i % 10 === 0 && inStage) {
            // 반사체: 왼쪽 황색, 오른쪽 백색
            P(i, side * (d0 - 0.02), 0.6, t3);
            const col = sd === 0 ? [1.0, 0.72, 0.1] : [0.95, 0.95, 0.95];
            quadFacing(glowBuf, t3, [-nxs, 0, -nzs], 0.06, 0.045, col);
          }
        } else if (type === 3) {
          const d0 = hw + 0.3;
          const cj = 0.9 + 0.15 * vnoise(s * 0.4, 2);
          const pts = [[d0, -1.5, 0.7], [d0, 0.95, 1.0], [d0 + 0.3, 0.95, 1.08], [d0 + 0.3, -1.5, 0.75], [d0, -1.5, 0.7]];
          for (let k = 0; k < 5; k++) {
            P(i, side * pts[k][0], pts[k][1], t3);
            const sh = pts[k][2] * cj;
            row('p' + k).push(furn.v(t3[0], t3[1], t3[2], k < 2 ? -nxs : k === 2 ? 0 : nxs, k === 2 ? 1 : 0, k < 2 ? -nzs : k === 2 ? 0 : nzs, CONC[0] * sh, CONC[1] * sh, CONC[2] * sh, s / 2.5, pts[k][1] / 2.5));
          }
        }
      }
    }
    // 교각
    for (let i = c0; i < c1; i++) {
      if (track.BR[i] && i % 6 === 0) {
        P(i, 0, -6, t3);
        furn.box(t3[0], t3[1], t3[2], 1.2, 10, 1.2, [CONC[0] * 0.85, CONC[1] * 0.85, CONC[2] * 0.85], Math.atan2(F.nzNeg[i], F.nx[i]));
        P(i, 0, -0.6, t3);
        furn.box(t3[0], t3[1], t3[2], 2 * F.hw[i] + 0.4, 0.7, 2.4, [CONC[0] * 0.8, CONC[1] * 0.8, CONC[2] * 0.8], Math.atan2(F.nzNeg[i], F.nx[i]));
      }
    }
    if (!furn.empty) {
      const mf = new THREE.Mesh(furn.toGeometry(), matFurn);
      mf.castShadow = inStage; mf.receiveShadow = true; mf.matrixAutoUpdate = false;
      group.add(mf);
    }
  }

  // --- 코너 표지: 갈매기표지, 예고 표지, 노면 글자
  const cells = env.tex.signs.cells;
  for (const c of track.corners) {
    if (c.i1 < stage.i0 - 200 || c.i0 > stage.i1 + 200) continue;
    if (c.rMin < 34) {
      const side = -c.dir, kTh = 0.55 / c.rMin;
      let last = -99;
      for (let i = c.i0; i <= c.i1; i++) {
        if (Math.abs(track.K[i]) < kTh || i - last < 4) continue;
        last = i;
        const sd = side > 0 ? 0 : 1;
        if (rs.gap[sd][i]) continue;
        const base = rs.wallH[sd][i] > 0 ? rs.wallH[sd][i] + 0.25 : 1.0;
        P(i, side * (F.hw[i] + (rs.wallH[sd][i] > 0 ? 0.75 : 0.62)), base + 0.36, t3);
        // 다가오는 운전자를 향해 세운다 (진행 반대 방향을 바라봄)
        signQuad(signBuf, t3, i, 0.62, 0.62, c.dir > 0 ? cells.chevL : cells.chevR, 0.35 * side);
      }
    }
    if (c.rMin < 26 && c.i0 > 30) {
      const i = Math.max(0, c.i0 - 28), hw = F.hw[i];
      P(i, -(hw + 1.25), 2.0, t3);
      signQuad(signBuf, t3, i, 0.8, 0.8, c.dir > 0 ? cells.curveL : cells.curveR, 0);
      P(i, -(hw + 1.25), 0.8, t3);
      flatPost(t3, i);
      // 노면 글자 (하행 차로)
      const j = Math.max(1, c.i0 - 20);
      roadDecal(j, 4, -F.hw[j] * 0.5, 2.3, c.rMin < 19 ? 1 : 0);
    }
  }
  // 낙석주의·야생동물 표지 (옹벽이 높은 곳, 400 m마다)
  for (let i = Math.max(40, stage.i0 - 100); i < Math.min(n - 10, stage.i1 + 100); i += 200) {
    const hw = F.hw[i];
    P(i, -(hw + 1.25), 2.0, t3);
    signQuad(signBuf, t3, i, 0.8, 0.8, rs.wallH[0][i] > 1.5 || rs.wallH[1][i] > 1.5 ? cells.rocks : (i / 200) % 2 ? cells.deer : cells.s40, 0);
    P(i, -(hw + 1.25), 0.8, t3);
    flatPost(t3, i);
  }

  function signQuad(buf, c, i, w, h, uv, yawBias) {
    // 운전자 기준 왼쪽 = +N. 표지 앞면이 진행 반대 방향을 보도록.
    let rx = F.nx[i], rz = -F.nzNeg[i];
    if (yawBias) { const tx = track.TX[i], tz = track.TZ[i]; rx += tx * yawBias; rz += tz * yawBias; const l = Math.hypot(rx, rz); rx /= l; rz /= l; }
    const nx = -track.TX[i], nz = -track.TZ[i];
    const a = buf.v(c[0] + rx * w / 2, c[1] - h / 2, c[2] + rz * w / 2, nx, 0, nz, 1, 1, 1, uv[0], uv[1]);
    const b = buf.v(c[0] - rx * w / 2, c[1] - h / 2, c[2] - rz * w / 2, nx, 0, nz, 1, 1, 1, uv[2], uv[1]);
    const d = buf.v(c[0] - rx * w / 2, c[1] + h / 2, c[2] - rz * w / 2, nx, 0, nz, 1, 1, 1, uv[2], uv[3]);
    const e = buf.v(c[0] + rx * w / 2, c[1] + h / 2, c[2] + rz * w / 2, nx, 0, nz, 1, 1, 1, uv[0], uv[3]);
    buf.quad(a, b, d, e);
  }
  function flatPost(c, i) {
    flatBuf.box(c[0] - track.TX[i] * 0.04, c[1], c[2] - track.TZ[i] * 0.04, 0.07, 2.4, 0.07, [0.6, 0.62, 0.64]);
  }
  function quadFacing(buf, c, nrm, w, h, col) {
    const rx = -nrm[2], rz = nrm[0];
    const a = buf.v(c[0] - rx * w, c[1] - h, c[2] - rz * w, nrm[0], 0, nrm[2], col[0], col[1], col[2]);
    const b = buf.v(c[0] + rx * w, c[1] - h, c[2] + rz * w, nrm[0], 0, nrm[2], col[0], col[1], col[2]);
    const d = buf.v(c[0] + rx * w, c[1] + h, c[2] + rz * w, nrm[0], 0, nrm[2], col[0], col[1], col[2]);
    const e = buf.v(c[0] - rx * w, c[1] + h, c[2] - rz * w, nrm[0], 0, nrm[2], col[0], col[1], col[2]);
    buf.quad(a, b, d, e);
  }
  /** 노면 데칼: i부터 len 샘플 길이, 중심 d, 폭 w */
  function roadDecal(i, len, d, w, cellK) {
    const uv = env.tex.decals.cell(cellK);
    const A = [], B = [];
    for (let k = 0; k <= len; k++) {
      const j = Math.min(n - 1, i + k), v = k / len;
      P(j, d + w / 2, 0.03, t3); A.push(decalBuf.v(t3[0], t3[1], t3[2], 0, 1, 0, 1, 1, 1, uv[0], v));
      P(j, d - w / 2, 0.03, t3); B.push(decalBuf.v(t3[0], t3[1], t3[2], 0, 1, 0, 1, 1, 1, uv[2], v));
    }
    decalBuf.strip(A, B);
  }
  /** 체크무늬 선 (출발·도착) */
  function checkerLine(i) {
    const hw = F.hw[i], cols = 16, rowsN = 2, cw = (2 * hw) / cols;
    for (let r = 0; r < rowsN; r++) for (let k = 0; k < cols; k++) {
      const c = (r + k) % 2 ? 0.95 : 0.06;
      const d0 = hw - k * cw, d1 = d0 - cw, s0 = r * 0.5, s1 = s0 + 0.5;
      const q = [[d0, s0], [d1, s0], [d1, s1], [d0, s1]].map(([d, ds]) => {
        track.at(i * DS + ds, d, o);
        return flatBuf.v(o.x, o.y + 0.035, o.z, 0, 1, 0, c, c, c);
      });
      flatBuf.quad(q[0], q[1], q[2], q[3]);
    }
  }
  checkerLine(stage.i0);
  checkerLine(stage.i1);

  const add = (buf, mat, order = 0, shadow = false) => {
    if (buf.empty) return;
    const m = new THREE.Mesh(buf.toGeometry(), mat);
    m.matrixAutoUpdate = false; m.renderOrder = order; m.castShadow = shadow; m.frustumCulled = false;
    group.add(m);
  };
  add(signBuf, matSign, 0, true);
  add(flatBuf, matFlat, 1);
  add(decalBuf, matDecal, 2);
  add(glowBuf, matGlow, 0);
  return group;
}
