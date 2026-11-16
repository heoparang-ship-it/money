// 풍경: 나무(금강소나무·활엽수), 실제 건물 외곽선, 샛길, 하천, 풍력발전기, 송전탑,
// 표지석·버스정류장 같은 실제 지점, 출발·도착 게이트.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { DS } from './track.js';
import { GeoBuf } from './geobuf.js';
import { clamp, mulberry32, vnoise } from './geo.js';
import { makeTextTexture } from './textures.js';

function colored(geo, r, g, b) {
  const n = geo.attributes.position.count, c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { c[i * 3] = r; c[i * 3 + 1] = g; c[i * 3 + 2] = b; }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return geo.index ? geo.toNonIndexed() : geo;
}
function blob(rx, ry, rz, x, y, z, shade = 1) {
  const g = new THREE.IcosahedronGeometry(1, 0);
  // 부드러운 음영을 위해 법선을 구면 방향으로
  const p = g.attributes.position, nrm = g.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    const l = Math.hypot(p.getX(i), p.getY(i), p.getZ(i));
    nrm.setXYZ(i, p.getX(i) / l, p.getY(i) / l * 0.8 + 0.35, p.getZ(i) / l);
  }
  g.scale(rx, ry, rz); g.translate(x, y, z);
  return colored(g, shade, shade, shade);
}
let treeGeos = null;
function getTreeGeos(trunk) {
  if (treeGeos) return treeGeos;
  // 줄기는 회색이 아닌 색(갈색)으로 칠해 두고, 셰이더에서 "회색이 아니면 인스턴스 색을 곱하지 않는다"로 구분한다
  const tr = (r0, r1, h, y, k = 1, red = 1) => { const g = new THREE.CylinderGeometry(r0, r1, h, 5, 1, true); g.translate(0, y + h / 2, 0); return colored(g, trunk[0] * k * 1.7 * red, trunk[1] * k * 1.5, trunk[2] * k * 1.2); };
  // 금강소나무: 붉은 긴 줄기 + 위쪽에 납작한 잎 뭉치
  const pine = mergeGeometries([
    tr(0.11, 0.2, 7.2, 0, 1.2, 1.5),
    blob(2.0, 0.9, 2.0, 0.2, 7.6, 0, 0.95), blob(1.5, 0.75, 1.5, -0.7, 8.6, 0.4, 1.05), blob(1.3, 0.7, 1.3, 0.6, 9.2, -0.5, 1.12),
  ]);
  // 활엽수: 둥근 수관
  const oak = mergeGeometries([
    tr(0.14, 0.24, 3.2, 0, 0.9),
    blob(2.3, 1.9, 2.3, 0, 4.6, 0, 0.92), blob(1.7, 1.5, 1.7, 1.1, 5.6, 0.5, 1.06), blob(1.6, 1.4, 1.6, -0.9, 5.9, -0.6, 1.1),
  ]);
  // 낙엽송: 원뿔형
  const cone = (r, h, y, s) => { const g = new THREE.ConeGeometry(r, h, 6); g.translate(0, y + h / 2, 0); return colored(g, s, s, s); };
  const larch = mergeGeometries([tr(0.1, 0.2, 2.4, 0), cone(1.9, 3.6, 1.6, 0.9), cone(1.5, 3.2, 3.6, 1.0), cone(1.0, 2.8, 5.4, 1.1)]);
  // 먼 나무용 단순 모델 (삼각형 수 약 1/3)
  const pineLo = mergeGeometries([tr(0.11, 0.2, 7.2, 0, 1.2, 1.5), blob(2.1, 1.25, 2.1, 0, 8.3, 0, 1.02)]);
  const oakLo = mergeGeometries([tr(0.14, 0.24, 3.2, 0, 0.9), blob(2.5, 2.3, 2.5, 0, 5.0, 0, 1.0)]);
  const larchLo = mergeGeometries([cone(1.8, 6.6, 1.6, 1.0)]);
  treeGeos = { pine, oak, larch, pineLo, oakLo, larchLo };
  return treeGeos;
}

/** (x,z) 평면 다각형 삼각형이 위(+Y)를 향하도록 인덱스 순서를 맞춘다 */
function upTri(buf, pts, ids, t) {
  const a = pts[t[0]], b = pts[t[1]], c = pts[t[2]];
  const cr = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  if (cr < 0) buf.tri(ids[t[0]], ids[t[1]], ids[t[2]]); else buf.tri(ids[t[0]], ids[t[2]], ids[t[1]]);
}

export function buildScenery(world, stage, env, quality) {
  const { track, terrain, features, landcover, dem } = world;
  const pal = env.palette;
  const group = new THREE.Group();
  group.name = 'scenery';
  const animated = [];
  const rnd = mulberry32(1000 + stage.id * 77);
  const q = {}, o = {};
  const i0 = Math.max(0, stage.i0 - 70), i1 = Math.min(track.n - 1, stage.i1 + 90);
  // 스테이지 도로까지의 거리. 128 m 격자에 점을 담아 두고 주변 5x5 칸만 본다 (풀코스에서도 빠르게).
  const stagePts = [], sGrid = new Map(), SG = 128;
  for (let i = i0; i <= i1; i += 8) {
    stagePts.push(track.X[i], track.Z[i]);
    const key = (Math.floor(track.X[i] / SG) + 512) * 1024 + Math.floor(track.Z[i] / SG) + 512;
    let a = sGrid.get(key); if (!a) sGrid.set(key, (a = [])); a.push(track.X[i], track.Z[i]);
  }
  const coarse = [];
  for (let i = i0; i <= i1; i += 64) coarse.push(track.X[i], track.Z[i]);
  const distStage = (x, z) => {
    let b = 1e18;
    const cx = Math.floor(x / SG) + 512, cz = Math.floor(z / SG) + 512;
    for (let a = -2; a <= 2; a++) for (let c = -2; c <= 2; c++) {
      const arr = sGrid.get((cx + a) * 1024 + cz + c);
      if (arr) for (let k = 0; k < arr.length; k += 2) { const dx = arr[k] - x, dz = arr[k + 1] - z, d = dx * dx + dz * dz; if (d < b) b = d; }
    }
    if (b < 1e17) return Math.sqrt(b);
    // 256 m 밖: 성긴 점으로 근사
    for (let k = 0; k < coarse.length; k += 2) { const dx = coarse[k] - x, dz = coarse[k + 1] - z, d = dx * dx + dz * dz; if (d < b) b = d; }
    return Math.sqrt(b);
  };
  const matVC = new THREE.MeshLambertMaterial({ vertexColors: true, map: env.tex.grain, side: THREE.DoubleSide });
  const footprints = []; // 나무가 건물·샛길 위에 서지 않게

  // ---------------- 건물 (실제 외곽선)
  {
    const walls = new GeoBuf(), roofs = new GeoBuf();
    const roofCols = [[0.1, 0.28, 0.62], [0.72, 0.3, 0.1], [0.14, 0.42, 0.26], [0.35, 0.36, 0.38], [0.55, 0.13, 0.11], [0.12, 0.3, 0.5]];
    const wallCols = [[0.86, 0.84, 0.78], [0.8, 0.76, 0.66], [0.9, 0.9, 0.88], [0.72, 0.66, 0.58], [0.82, 0.8, 0.84]];
    const museumPoi = (features.pois || []).find((p) => p.name === '대관령박물관');
    features.buildings.forEach((b, bi) => {
      const pts = [];
      for (let k = 0; k < b.p.length; k += 2) pts.push([b.p[k], -b.p[k + 1]]);
      if (pts.length < 3) return;
      let cx = 0, cz = 0, area = 0;
      for (let k = 0; k < pts.length; k++) { const a = pts[k], c = pts[(k + 1) % pts.length]; cx += a[0]; cz += a[1]; area += a[0] * c[1] - c[0] * a[1]; }
      cx /= pts.length; cz /= pts.length; area = Math.abs(area) / 2;
      if (distStage(cx, cz) > 900 || area < 12) return;
      track.nearest(cx, cz, q);
      if (q.dist < q.hw + 3) return; // 도로 위에 걸친 오차 건물은 생략
      const r2 = mulberry32(bi * 31 + 5);
      const isMuseum = museumPoi && Math.hypot(museumPoi.p[0] - cx, -museumPoi.p[1] - cz) < 70 && area > 150;
      const floors = area > 260 || isMuseum ? 2 : r2() < 0.25 ? 2 : 1;
      const h = floors * 3.2 + (isMuseum ? 2 : 0.4);
      let base = 1e9, top = -1e9;
      for (const p of pts) { const y = terrain.heightAt(p[0], p[1]); base = Math.min(base, y); top = Math.max(top, y); }
      const y0 = base - 0.5, y1 = top + h;
      const wc = isMuseum ? [0.62, 0.6, 0.56] : wallCols[(r2() * wallCols.length) | 0], rc = isMuseum ? [0.2, 0.2, 0.22] : roofCols[(r2() * roofCols.length) | 0];
      let u = 0;
      for (let k = 0; k < pts.length; k++) {
        const a = pts[k], c = pts[(k + 1) % pts.length];
        const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
        if (len < 0.3) continue;
        const nx = -(c[1] - a[1]) / len, nz = (c[0] - a[0]) / len; // 감긴 방향과 같은 쪽 법선
        const sh = 0.82 + 0.25 * Math.abs(nx * 0.6 + nz * 0.8);
        const v0 = (y0 - top) / 3.2, v1 = (y1 - top) / 3.2;
        const A = walls.v(a[0], y0, a[1], nx, 0, nz, wc[0] * sh, wc[1] * sh, wc[2] * sh, u / 4, v0);
        const B = walls.v(c[0], y0, c[1], nx, 0, nz, wc[0] * sh, wc[1] * sh, wc[2] * sh, (u + len) / 4, v0);
        const C = walls.v(c[0], y1, c[1], nx, 0, nz, wc[0] * sh, wc[1] * sh, wc[2] * sh, (u + len) / 4, v1);
        const D = walls.v(a[0], y1, a[1], nx, 0, nz, wc[0] * sh, wc[1] * sh, wc[2] * sh, u / 4, v1);
        walls.quad(A, B, C, D);
        u += len;
      }
      // 지붕: 처마를 조금 내민 평지붕 + 테두리
      const contour = pts.map((p) => new THREE.Vector2(p[0], p[1]));
      const tris = THREE.ShapeUtils.triangulateShape(contour, []);
      const ids = pts.map((p) => roofs.v(cx + (p[0] - cx) * 1.06, y1 + 0.25, cz + (p[1] - cz) * 1.06, 0, 1, 0, rc[0], rc[1], rc[2], p[0] / 3, p[1] / 3));
      for (const t of tris) upTri(roofs, pts, ids, t);
      const ids2 = pts.map((p) => roofs.v(cx + (p[0] - cx) * 1.06, y1 - 0.05, cz + (p[1] - cz) * 1.06, 0, 0, 1, rc[0] * 0.7, rc[1] * 0.7, rc[2] * 0.7));
      for (let k = 0; k < pts.length; k++) { const k2 = (k + 1) % pts.length; roofs.quad(ids2[k], ids2[k2], ids[k2], ids[k]); }
      footprints.push([cx, cz, Math.sqrt(area) * 0.75 + 2]);
      if (isMuseum) world.museumPos = [cx, cz];
    });
    if (!walls.empty) {
      const m = new THREE.Mesh(walls.toGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true, map: env.tex.wall, side: THREE.DoubleSide }));
      const r = new THREE.Mesh(roofs.toGeometry(), matVC);
      m.castShadow = r.castShadow = true; m.receiveShadow = true;
      group.add(m, r);
    }
  }

  // ---------------- 샛길·주차장·하천 (지형 위에 얹는 띠)
  {
    const flat = new GeoBuf();
    const ribbon = (p, w, col, lift, snapMain) => {
      const A = [], B = [];
      const m = p.length / 2;
      let any = false;
      for (let k = 0; k < m; k++) {
        const x = p[k * 2], z = -p[k * 2 + 1];
        if (distStage(x, z) > 1100) { if (A.length > 1) flat.strip(A, B); A.length = 0; B.length = 0; continue; }
        const xa = p[Math.max(0, k - 1) * 2], za = -p[Math.max(0, k - 1) * 2 + 1], xb = p[Math.min(m - 1, k + 1) * 2], zb = -p[Math.min(m - 1, k + 1) * 2 + 1];
        let tx = xb - xa, tz = zb - za; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
        const nx = tz, nz = -tx;
        const yAt = (px, pz) => {
          if (snapMain) { track.nearest(px, pz, q); if (q.dist < q.hw + 2.6) return q.y - 0.04; }
          return terrain.heightAt(px, pz) + lift;
        };
        const sh = 0.9 + 0.2 * vnoise(x * 0.05, z * 0.05);
        A.push(flat.v(x + nx * w / 2, yAt(x + nx * w / 2, z + nz * w / 2), z + nz * w / 2, 0, 1, 0, col[0] * sh, col[1] * sh, col[2] * sh, k, 0));
        B.push(flat.v(x - nx * w / 2, yAt(x - nx * w / 2, z - nz * w / 2), z - nz * w / 2, 0, 1, 0, col[0] * sh, col[1] * sh, col[2] * sh, k, 1));
        footprints.push([x, z, w / 2 + 2.5]);
        any = true;
      }
      if (A.length > 1) flat.strip(A, B);
      return any;
    };
    // 긴 구간은 잘게 나눠 지형을 따라가게
    const densify = (p, step) => {
      const out = [];
      for (let k = 0; k < p.length / 2 - 1; k++) {
        const ax = p[k * 2], ay = p[k * 2 + 1], bx = p[k * 2 + 2], by = p[k * 2 + 3];
        const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
        for (let j = 0; j < n; j++) out.push(ax + ((bx - ax) * j) / n, ay + ((by - ay) * j) / n);
      }
      out.push(p[p.length - 2], p[p.length - 1]);
      return out;
    };
    for (const r of features.roads) {
      const dirt = r.c === 'track';
      ribbon(densify(r.p, 6), r.w, dirt ? [0.33, 0.27, 0.19] : [0.19, 0.19, 0.2], dirt ? 0.12 : 0.2, true);
    }
    for (const s of features.streams) ribbon(densify(s.p, 8), s.k === 'river' ? 14 : 2.6, [0.16, 0.3, 0.38], 0.25, false);
    for (const pk of features.parking) {
      const pts = [];
      for (let k = 0; k < pk.p.length; k += 2) pts.push([pk.p[k], -pk.p[k + 1]]);
      const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cz = pts.reduce((s, p) => s + p[1], 0) / pts.length;
      if (distStage(cx, cz) > 700) continue;
      const tris = THREE.ShapeUtils.triangulateShape(pts.map((p) => new THREE.Vector2(p[0], p[1])), []);
      const ids = pts.map((p) => flat.v(p[0], terrain.heightAt(p[0], p[1]) + 0.22, p[1], 0, 1, 0, 0.2, 0.2, 0.21));
      for (const t of tris) upTri(flat, pts, ids, t);
      footprints.push([cx, cz, 14]);
    }
    for (const wp of features.waterPolys) {
      const pts = [];
      for (let k = 0; k < wp.p.length; k += 2) pts.push([wp.p[k], -wp.p[k + 1]]);
      let y = 1e9;
      for (const p of pts) y = Math.min(y, dem.height(p[0], p[1]));
      const tris = THREE.ShapeUtils.triangulateShape(pts.map((p) => new THREE.Vector2(p[0], p[1])), []);
      const ids = pts.map((p) => flat.v(p[0], y + 0.6, p[1], 0, 1, 0, 0.12, 0.26, 0.36));
      for (const t of tris) upTri(flat, pts, ids, t);
    }
    if (!flat.empty) {
      const m = new THREE.Mesh(flat.toGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
      m.receiveShadow = true; m.frustumCulled = false;
      group.add(m);
    }
  }

  // ---------------- 소품: 콘, 게이트, 표지석, 정류장 …
  const props = new GeoBuf();
  const boards = []; // 글자판 { tex, pos, yaw, w, h }
  const frame = (i, d, dy = 0) => { track.at(clamp(i, 0, track.n - 1) * DS, d, o); return [o.x, o.y + dy, o.z]; };
  const yawOf = (i) => Math.atan2(track.TX[clamp(i, 0, track.n - 1)], track.TZ[clamp(i, 0, track.n - 1)]);
  const cone = (x, y, z) => {
    props.box(x, y + 0.02, z, 0.36, 0.04, 0.36, [0.9, 0.3, 0.05]);
    props.box(x, y + 0.2, z, 0.2, 0.34, 0.2, [0.95, 0.32, 0.05]);
    props.box(x, y + 0.31, z, 0.21, 0.08, 0.21, [0.95, 0.95, 0.95]);
    props.box(x, y + 0.48, z, 0.1, 0.24, 0.1, [0.95, 0.32, 0.05]);
  };
  for (const j of world.roadside.junctions) {
    if (j.i < i0 - 100 || j.i > i1 + 100) continue;
    const half = Math.ceil((j.w / 2 + 1.5) / DS);
    for (let k = -half; k <= half; k++) {
      const p = frame(j.i + k, j.side * (track.HW[clamp(j.i + k, 0, track.n - 1)] + 0.45));
      cone(p[0], p[1], p[2]);
    }
  }
  // 출발·도착 게이트
  const gate = (i, label, sub, colTop, bg, fg) => {
    const hw = track.HW[i], yaw = yawOf(i);
    const L = frame(i, hw + 1.1), R = frame(i, -(hw + 1.1)), C = frame(i, 0);
    props.box(L[0], L[1] + 2.9, L[2], 0.3, 6.2, 0.3, colTop, yaw);
    props.box(R[0], R[1] + 2.9, R[2], 0.3, 6.2, 0.3, colTop, yaw);
    props.box(C[0], C[1] + 6.0, C[2], 2 * hw + 2.5, 0.35, 0.35, colTop, yaw);
    boards.push({ tex: makeTextTexture([label, sub], { w: 1024, h: 256, bg, fg, font: 96 }), pos: [C[0], C[1] + 5.0, C[2]], yaw: yaw + Math.PI, w: 2 * hw + 1.6, h: 1.7, both: true });
  };
  gate(stage.i0, '출 발', '', [0.75, 0.12, 0.1], '#c0271f', '#ffffff');
  gate(stage.i1, '도 착', '', [0.1, 0.1, 0.11], '#151517', '#ffe14a');
  // 도착점 응원단
  {
    const i = stage.i1 + 4, rn = mulberry32(stage.id * 13);
    for (let k = 0; k < 9; k++) {
      const side = k % 2 ? 1 : -1;
      const p = frame(i + ((k * 1.3) | 0), side * (track.HW[i] + 1.3 + rn() * 1.4));
      const sh = [[0.8, 0.2, 0.2], [0.2, 0.4, 0.8], [0.9, 0.8, 0.3], [0.3, 0.6, 0.35], [0.7, 0.4, 0.7]][k % 5];
      props.box(p[0], p[1] + 0.45, p[2], 0.34, 0.9, 0.24, [0.2, 0.22, 0.28]);
      props.box(p[0], p[1] + 1.2, p[2], 0.42, 0.62, 0.26, sh);
      props.box(p[0], p[1] + 1.66, p[2], 0.22, 0.24, 0.22, [0.85, 0.65, 0.5]);
    }
    const p = frame(i + 3, track.HW[i] + 2.6);
    boards.push({ tex: makeTextTexture(['황 영감 화이팅!', '씨티백은 죽지 않는다'], { w: 1024, h: 256, bg: '#fff7d6', fg: '#b3261e', font: 84 }), pos: [p[0], p[1] + 2.5, p[2]], yaw: yawOf(i) + Math.PI + 0.5, w: 5.2, h: 1.3, both: true });
    props.box(p[0], p[1] + 1.2, p[2], 0.08, 2.4, 0.08, [0.5, 0.4, 0.3]);
  }
  // 표지석 (대관령 정상), 기념비, 사친시비
  const stele = (x, z, w, h, d, text, yaw, font = 150) => {
    const y = terrain.heightAt(x, z);
    props.box(x, y + 0.2, z, w + 0.9, 0.5, d + 0.9, [0.45, 0.44, 0.42], yaw);
    props.box(x, y + 0.45 + h / 2, z, w, h, d, [0.52, 0.52, 0.5], yaw, 1.0);
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    boards.push({ tex: makeTextTexture([...text], { w: 256, h: 1024, bg: '#84847f', fg: '#1d1d1b', font, border: false }), pos: [x + fx * (d / 2 + 0.02), y + 0.45 + h / 2, z + fz * (d / 2 + 0.02)], yaw, w: w * 0.8, h: h * 0.9 });
    footprints.push([x, z, 4]);
  };
  const facingRoad = (x, z) => { track.nearest(x, z, q); track.at(q.s, 0, o); return Math.atan2(o.x - x, o.z - z); };
  for (const v of features.viewpoints) if (v.s < 200) { const x = v.p[0], z = -v.p[1]; if (distStage(x, z) < 900) stele(x, z, 1.5, 3.4, 0.7, '大關嶺', facingRoad(x, z), 190); }
  for (const p of features.pois) {
    const x = p.p[0], z = -p.p[1];
    if (distStage(x, z) > 700) continue;
    if (p.name.includes('기념비')) {
      const y = terrain.heightAt(x, z);
      props.box(x, y + 1, z, 5, 2, 5, [0.5, 0.5, 0.48]); props.box(x, y + 9, z, 1.6, 16, 1.6, [0.62, 0.62, 0.6]); props.box(x, y + 17.5, z, 2.4, 1, 2.4, [0.5, 0.5, 0.48]);
      footprints.push([x, z, 6]);
    } else if (p.name.includes('사친시비')) {
      track.nearest(x, z, q); track.at(q.s, q.side * (q.hw + 4.5), o);
      stele(o.x, o.z, 1.3, 2.3, 0.5, '사친시비', facingRoad(o.x, o.z), 170);
    } else if (p.name.includes('박물관') || p.name.includes('관리사무소')) {
      // 길가 안내판 (공공 시설만)
      track.nearest(x, z, q);
      if (q.dist > 150) continue;
      const side = q.side, i = Math.round(q.s / DS);
      const pp = frame(i, side * (track.HW[clamp(i, 0, track.n - 1)] + 2.2));
      props.box(pp[0], pp[1] + 1.4, pp[2], 0.1, 2.8, 0.1, [0.4, 0.4, 0.42]);
      boards.push({ tex: makeTextTexture([p.name], { w: 512, h: 128, bg: '#5a3b1c', fg: '#ffe9b0', font: 60 }), pos: [pp[0], pp[1] + 2.6, pp[2]], yaw: yawOf(i) + Math.PI, w: 3.0, h: 0.75, both: true });
    }
  }
  // 버스정류장 (실제 이름)
  for (const b of features.busStops) {
    const x = b.p[0], z = -b.p[1];
    if (distStage(x, z) > 400) continue;
    track.nearest(x, z, q);
    const i = Math.round(q.s / DS), side = q.side, hw = track.HW[clamp(i, 0, track.n - 1)], yaw = yawOf(i);
    const c = frame(i, side * (hw + 2.6));
    const ax = Math.cos(yaw), az = -Math.sin(yaw); // 모델의 +X(왼쪽) 방향
    props.box(c[0] + ax * side * 0.9, c[1] + 1.2, c[2] + az * side * 0.9, 0.1, 2.4, 3.2, [0.75, 0.8, 0.85], yaw);
    props.box(c[0], c[1] + 2.45, c[2], 2.0, 0.12, 3.6, [0.2, 0.42, 0.75], yaw);
    props.box(c[0], c[1] + 0.45, c[2], 0.5, 0.08, 2.4, [0.55, 0.42, 0.28], yaw);
    for (const e of [-1.5, 1.5]) props.box(c[0] + Math.sin(yaw) * e, c[1] + 1.2, c[2] + Math.cos(yaw) * e, 1.9, 2.4, 0.08, [0.75, 0.8, 0.85], yaw);
    boards.push({ tex: makeTextTexture([b.name || '정류장'], { w: 512, h: 128, bg: '#2f6fd0', fg: '#fff', font: 64 }), pos: [c[0] - ax * side * 0.95, c[1] + 2.2, c[2] - az * side * 0.95], yaw: yaw + (side > 0 ? -Math.PI / 2 : Math.PI / 2), w: 2.6, h: 0.6, both: true });
    footprints.push([c[0], c[2], 4]);
  }
  // 교량 이름판
  for (const br of track.bridges) {
    const i = Math.round(br.s0 / DS) - 3;
    if (i < i0 - 50 || i > i1 + 50) continue;
    const pp = frame(i, -(track.HW[clamp(i, 0, track.n - 1)] + 1.0));
    boards.push({ tex: makeTextTexture([br.name && br.name.includes('2') ? '대관령2교' : '대관령1교'], { w: 512, h: 128, bg: '#e9e9e4', fg: '#1b1b1b', font: 70 }), pos: [pp[0], pp[1] + 1.0, pp[2]], yaw: yawOf(i) + Math.PI, w: 1.8, h: 0.45, both: true });
  }
  if (!props.empty) {
    const m = new THREE.Mesh(props.toGeometry(), matVC);
    m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
    group.add(m);
  }
  for (const b of boards) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(b.w, b.h), new THREE.MeshLambertMaterial({ map: b.tex, emissive: 0xffffff, emissiveMap: b.tex, emissiveIntensity: 0.42 }));
    m.material.userData.ownMap = true;
    m.position.set(b.pos[0], b.pos[1], b.pos[2]); m.rotation.y = b.yaw;
    group.add(m);
    if (b.both) { // 뒷면도 글자가 바로 읽히도록 한 장 더
      m.material.side = THREE.FrontSide;
      const m2 = new THREE.Mesh(m.geometry, m.material);
      m2.position.set(b.pos[0] - Math.sin(b.yaw) * 0.03, b.pos[1], b.pos[2] - Math.cos(b.yaw) * 0.03); m2.rotation.y = b.yaw + Math.PI;
      group.add(m2);
    }
  }

  // ---------------- 풍력발전기 (실제 위치) · 송전탑
  {
    const tower = mergeGeometries([
      (() => { const g = new THREE.CylinderGeometry(1.5, 2.4, 80, 10); g.translate(0, 40, 0); return g; })(),
      (() => { const g = new THREE.BoxGeometry(3.6, 3.8, 11); g.translate(0, 81, 1.5); return g; })(),
    ]);
    const blade = (a) => { const g = new THREE.BoxGeometry(1.6, 40, 0.5); g.translate(0, 21, 0); g.rotateZ(a); return g; };
    const rotor = mergeGeometries([blade(0), blade((Math.PI * 2) / 3), blade((Math.PI * 4) / 3), (() => { const g = new THREE.SphereGeometry(2.1, 10, 8); return g; })()]);
    const mat = new THREE.MeshLambertMaterial({ color: 0xf2f4f5 });
    const n = features.turbines.length;
    const tm = new THREE.InstancedMesh(tower, mat, n), rm = new THREE.InstancedMesh(rotor, mat, n);
    const M = new THREE.Matrix4(), bases = [];
    features.turbines.forEach((t, k) => {
      const x = t[0], z = -t[1], y = dem.height(x, z) - 1;
      M.makeRotationY(-Math.PI / 2).setPosition(x, y, z);
      tm.setMatrixAt(k, M);
      bases.push([x, y + 81, z, k * 1.7]);
    });
    tm.instanceMatrix.needsUpdate = true;
    tm.frustumCulled = rm.frustumCulled = false;
    group.add(tm, rm);
    const R = new THREE.Matrix4(), Tm = new THREE.Matrix4(), S = new THREE.Matrix4().makeRotationY(-Math.PI / 2);
    animated.push((time) => {
      for (let k = 0; k < n; k++) {
        const b = bases[k];
        R.makeRotationZ(time * 0.9 + b[3]);
        Tm.makeTranslation(b[0] - 8, b[1], b[2]);
        M.copy(Tm).multiply(S).multiply(R);
        rm.setMatrixAt(k, M);
      }
      rm.instanceMatrix.needsUpdate = true;
    });
    // 송전탑: 십자 판 + 격자 텍스처
    const pb = new GeoBuf();
    for (const t of features.towers) {
      const x = t[0], z = -t[1];
      if (distStage(x, z) > 2500) continue;
      const y = dem.height(x, z) - 1, h = 34, w = 5;
      for (const [ax, az] of [[1, 0], [0, 1]]) {
        const a = pb.v(x - ax * w, y, z - az * w, 0, 1, 0, 1, 1, 1, 0, 0), b2 = pb.v(x + ax * w, y, z + az * w, 0, 1, 0, 1, 1, 1, 1, 0);
        const c = pb.v(x + ax * w, y + h, z + az * w, 0, 1, 0, 1, 1, 1, 1, 1), d = pb.v(x - ax * w, y + h, z - az * w, 0, 1, 0, 1, 1, 1, 0, 1);
        pb.quad(a, b2, c, d);
      }
    }
    if (!pb.empty) {
      const m = new THREE.Mesh(pb.toGeometry(), new THREE.MeshLambertMaterial({ map: env.tex.lattice, alphaTest: 0.35, side: THREE.DoubleSide }));
      m.frustumCulled = false;
      group.add(m);
    }
  }

  // ---------------- 나무
  {
    const geos = getTreeGeos(pal.trunk);
    const long = i1 - i0 > 2500; // 풀코스: 나무 밀도·범위를 줄여 메모리와 로딩 시간을 아낀다
    const spacing = (long ? 10 : 7.5) / Math.sqrt(quality.detail || 1);
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (let k = 0; k < stagePts.length; k += 2) { minX = Math.min(minX, stagePts[k]); maxX = Math.max(maxX, stagePts[k]); minZ = Math.min(minZ, stagePts[k + 1]); maxZ = Math.max(maxZ, stagePts[k + 1]); }
    const RANGE = long ? 130 : quality.detail >= 1 ? 210 : 150;
    const tiles = new Map();
    const fpHash = new Map();
    for (const f of footprints) { const key = `${Math.floor(f[0] / 40)}_${Math.floor(f[1] / 40)}`; (fpHash.get(key) || fpHash.set(key, []).get(key)).push(f); }
    const blocked = (x, z) => {
      const cx = Math.floor(x / 40), cz = Math.floor(z / 40);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        const arr = fpHash.get(`${cx + a}_${cz + b}`);
        if (arr) for (const f of arr) if (Math.hypot(f[0] - x, f[1] - z) < f[2]) return true;
      }
      return false;
    };
    const N = {};
    for (let gx = Math.floor((minX - RANGE) / spacing); gx <= (maxX + RANGE) / spacing; gx++) {
      for (let gz = Math.floor((minZ - RANGE) / spacing); gz <= (maxZ + RANGE) / spacing; gz++) {
        const r = mulberry32(gx * 73856093 ^ gz * 19349663);
        const x = (gx + r()) * spacing, z = (gz + r()) * spacing;
        const dS = distStage(x, z);
        if (dS > RANGE) continue;
        const lc = landcover.at(x, z);
        const dens = (lc === 1 ? 0.92 : lc === 2 ? 0.3 : lc === 4 ? 0.1 : lc === 3 ? 0.04 : lc === 6 ? 0 : 0.03) * (dS < 45 ? 1 : dS < 120 ? 0.55 : 0.3);
        if (r() > dens) continue;
        track.nearest(x, z, q);
        if (q.dist < q.hw + 3.4) continue;
        if (blocked(x, z)) continue;
        terrain.normalAt(x, z, 3, N);
        if (N.y < 0.62) continue; // 너무 가파른 곳
        const y = terrain.heightAt(x, z) - 0.25;
        const tr = r();
        const type = y > 520 ? (tr < 0.5 ? 'pine' : tr < 0.72 ? 'larch' : 'oak') : tr < 0.34 ? 'pine' : tr < 0.44 ? 'larch' : 'oak';
        const sc = (0.8 + r() * 0.75) * (dS > 120 ? 1.25 : 1);
        const cols = type === 'oak' ? pal.decid : type === 'larch' ? (env.w.season === 'autumn' ? [pal.decid[2]] : pal.conifer) : pal.conifer;
        const col = cols[(r() * cols.length) | 0];
        const lod = dS > 85 ? 'Lo' : '';
        const key = `${type}${lod}|${Math.floor(x / 300)}|${Math.floor(z / 300)}`;
        let t = tiles.get(key);
        if (!t) tiles.set(key, (t = { type: type + lod, items: [], near: !lod }));
        const br = 0.8 + r() * 0.5;
        t.items.push(x, y, z, sc, r() * 6.28, col[0] * br, col[1] * br, col[2] * br, 0.85 + r() * 0.4);
      }
    }
    const treeMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    treeMat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <color_vertex>', `
        vColor = vec3(1.0);
        vColor *= color;
        #ifdef USE_INSTANCING_COLOR
          vColor.xyz *= mix(instanceColor.xyz, vec3(1.0), step(0.02, abs(color.r - color.b)));
        #endif`);
    };
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), Pv = new THREE.Vector3(), C = new THREE.Color(), Y = new THREE.Vector3(0, 1, 0);
    let count = 0;
    for (const t of tiles.values()) {
      const n = t.items.length / 9;
      const im = new THREE.InstancedMesh(geos[t.type], treeMat, n);
      for (let k = 0; k < n; k++) {
        const b = k * 9, it = t.items;
        Pv.set(it[b], it[b + 1], it[b + 2]); Q.setFromAxisAngle(Y, it[b + 4]); S.set(it[b + 3], it[b + 3] * it[b + 8], it[b + 3]);
        M.compose(Pv, Q, S); im.setMatrixAt(k, M);
        C.setRGB(it[b + 5], it[b + 6], it[b + 7]); im.setColorAt(k, C);
      }
      im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true;
      im.castShadow = t.near; im.computeBoundingSphere();
      group.add(im);
      count += n;
    }
    group.userData.trees = count;
  }
  group.userData.animated = animated.filter(Boolean);
  return group;
}
