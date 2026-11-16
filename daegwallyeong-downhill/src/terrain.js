// 실제 고도(DEM)로 만든 지형. 도로 주변은 4 m, 멀어질수록 거칠어지는 쿼드트리 LOD.
// 지형은 도로 높이에 맞춰 절토·성토되고(heightAt), LOD 경계의 틈은 스커트로 가린다.
import * as THREE from 'three';
import { clamp, lerp, smoothstep, fbm, vnoise } from './geo.js';
import { DS } from './track.js';

const ROOT = 1024; // 최상위 셀 (m)
const MIN = 4; // 최소 셀 (m)

export class Terrain {
  constructor(world) {
    this.dem = world.dem;
    this.track = world.track;
    this.landcover = world.landcover;
    this._q = {};
    // 거리 판정용 성긴 도로 점 (32 m 간격)
    const t = this.track;
    this.coarseAll = [];
    for (let i = 0; i < t.n; i += 16) this.coarseAll.push(t.X[i], t.Z[i]);
  }

  /** 도로 절토·성토가 반영된 최종 지표 높이. */
  heightAt(x, z) {
    const h = this.dem.height(x, z);
    const q = this.track.nearest(x, z, this._q);
    if (q.dist > 31) return h;
    const r0 = q.hw + 2.1, r1 = r0 + 22;
    if (q.dist >= r1) return h;
    const t = smoothstep(r0, r1, q.dist);
    let base = q.y - 0.6 - Math.abs(q.bank) * q.dist;
    if (q.bridge) base = Math.min(h, q.y - 5.5); // 교량 아래는 계곡으로 파낸다
    return lerp(base, h, t);
  }

  normalAt(x, z, eps, out) {
    const hx = this.heightAt(x + eps, z) - this.heightAt(x - eps, z);
    const hz = this.heightAt(x, z + eps) - this.heightAt(x, z - eps);
    const nx = -hx, ny = 2 * eps, nz = -hz, l = Math.hypot(nx, ny, nz);
    out.x = nx / l; out.y = ny / l; out.z = nz / l;
    return out;
  }

  _distTo(pts, x, z) {
    let best = 1e18;
    for (let i = 0; i < pts.length; i += 2) {
      const dx = pts[i] - x, dz = pts[i + 1] - z, d = dx * dx + dz * dz;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }

  /**
   * 지형 메시 생성.
   * stage: { i0, i1 } 샘플 범위. palette: 계절 색. sat: 위성사진 매핑(없으면 null).
   */
  build(stage, palette, sat, quality = 1) {
    const t = this.track;
    const stagePts = [];
    for (let i = Math.max(0, stage.i0 - 60); i <= Math.min(t.n - 1, stage.i1 + 80); i += 8) stagePts.push(t.X[i], t.Z[i]);
    const allPts = this.coarseAll;
    const long = stage.i1 - stage.i0 > 2500;
    const KS = (long ? 2.6 : 3.6) * (quality < 1 ? 0.8 : 1), KA = 1.5;
    const f = this.dem.f;
    const x0 = f.x0, x1 = f.x0 + (f.nx - 1) * f.step, z0 = -(f.y0 + (f.ny - 1) * f.step), z1 = -f.y0;

    const leaves = []; // [x, z, size]
    const leafSet = new Set();
    const lkey = (x, z, s) => `${x}|${z}|${s}`;
    const visit = (x, z, s) => {
      const cx = x + s / 2, cz = z + s / 2, half = s * 0.7071;
      let split = false;
      if (s > MIN) {
        const dS = this._distTo(stagePts, cx, cz) - half;
        if (dS < s * KS) split = true;
        else {
          const dA = this._distTo(allPts, cx, cz) - half - 16;
          if (dA < s * KA) split = true;
        }
      }
      if (split) {
        const h = s / 2;
        visit(x, z, h); visit(x + h, z, h); visit(x, z + h, h); visit(x + h, z + h, h);
      } else {
        leaves.push(x, z, s);
        leafSet.add(lkey(x, z, s));
      }
    };
    const gx0 = Math.floor(x0 / ROOT) * ROOT, gz0 = Math.floor(z0 / ROOT) * ROOT;
    for (let x = gx0; x < x1; x += ROOT) for (let z = gz0; z < z1; z += ROOT) visit(x, z, ROOT);

    // 꼭짓점 캐시
    const cache = new Map();
    const tmpN = {}, q = {};
    const col = new THREE.Color();
    const vert = (x, z) => {
      const key = (Math.round(x / MIN) + 16384) * 32768 + (Math.round(z / MIN) + 16384);
      let v = cache.get(key);
      if (v) return v;
      const y = this.heightAt(x, z);
      const dAll = this._distTo(allPts, x, z);
      const eps = clamp(dAll / 10, 2, 90);
      this.normalAt(x, z, eps, tmpN);
      // 색
      const lc = this.landcover.at(x, z);
      const slope = 1 - tmpN.y;
      const nz1 = fbm(x * 0.012, z * 0.012, 3), nz2 = vnoise(x * 0.11, z * 0.11);
      let c = palette.land[lc] || palette.land[1];
      col.setRGB(c[0], c[1], c[2]);
      if (lc <= 1) {
        // 숲: 멀리서도 수관처럼 보이도록 나무 색을 얼룩덜룩 섞는다
        const pick = vnoise(x * 0.085 + 31.7, z * 0.085 - 12.3), cs = palette.canopy;
        const cc = cs[Math.min(cs.length - 1, (pick * cs.length) | 0)];
        col.lerp(_tmpC.setRGB(cc[0], cc[1], cc[2]), 0.62);
      }
      const shade = 0.72 + nz1 * 0.5 + (nz2 - 0.5) * 0.22;
      col.multiplyScalar(shade);
      if (lc !== 6) {
        const rock = smoothstep(0.34, 0.6, slope + (nz2 - 0.5) * 0.12);
        if (rock > 0) col.lerp(_tmpC.setRGB(palette.rock[0], palette.rock[1], palette.rock[2]), rock * 0.85);
        // 도로변 절토면·갓길 흙
        this.track.nearest(x, z, q);
        if (q.dist < q.hw + 16) {
          const w = 1 - smoothstep(q.hw + 2, q.hw + 16, q.dist);
          col.lerp(_tmpC.setRGB(palette.verge[0], palette.verge[1], palette.verge[2]), w * 0.75);
        }
        if (y > 950) col.lerp(_tmpC.setRGB(palette.high[0], palette.high[1], palette.high[2]), smoothstep(950, 1250, y) * 0.5);
      }
      if (y <= 0.4 && !this.dem.inNear(x, z)) col.setRGB(palette.sea[0], palette.sea[1], palette.sea[2]);
      v = { x, y, z, nx: tmpN.x, ny: tmpN.y, nz: tmpN.z, r: col.r, g: col.g, b: col.b };
      cache.set(key, v);
      return v;
    };

    // 버킷: 가까운 셀은 512 m 타일별, 먼 셀은 한 덩어리
    const buckets = new Map();
    const bucket = (key, texNear, small) => {
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = { pos: [], nor: [], col: [], uv: [], near: texNear, small }));
      return b;
    };
    const push = (b, v, dy = 0) => {
      b.pos.push(v.x, v.y - dy, v.z); b.nor.push(v.nx, v.ny, v.nz); b.col.push(v.r, v.g, v.b);
      if (sat) { const uv = sat.uv(v.x, v.z, b.near); b.uv.push(uv[0], uv[1]); } else b.uv.push(v.x / 14, v.z / 14);
    };
    const has = (x, z, s) => leafSet.has(lkey(x, z, s));
    for (let i = 0; i < leaves.length; i += 3) {
      const x = leaves[i], z = leaves[i + 1], s = leaves[i + 2];
      // 위성사진 모드: 고해상도 모자이크 범위 안의 셀만 near 텍스처를 쓴다
      const texNear = sat ? sat.inNear(x, z, s) : true;
      const key = s >= 128 ? (sat && texNear ? 'farN' : 'far') : `${texNear ? 'N' : 'F'}${Math.floor(x / 512)}_${Math.floor(z / 512)}`;
      const b = bucket(key, texNear, s < 128);
      const v00 = vert(x, z), v10 = vert(x + s, z), v01 = vert(x, z + s), v11 = vert(x + s, z + s);
      // 위쪽이 앞면이 되도록 (x->z 순서)
      push(b, v00); push(b, v01); push(b, v10); push(b, v10); push(b, v01); push(b, v11);
      // 스커트: 같은 크기의 이웃 잎이 없으면 LOD 경계
      const depth = Math.max(1.2, s * 0.4);
      if (!has(x, z - s, s)) skirt(b, v00, v10, depth);
      if (!has(x, z + s, s)) skirt(b, v11, v01, depth);
      if (!has(x - s, z, s)) skirt(b, v01, v00, depth);
      if (!has(x + s, z, s)) skirt(b, v10, v11, depth);
    }
    function skirt(b, a, c, depth) {
      // 양면이 보이도록 두 번 (재질은 FrontSide 유지)
      push(b, a); push(b, c); push(b, c, depth); push(b, a); push(b, c, depth); push(b, a, depth);
      push(b, c); push(b, a); push(b, a, depth); push(b, c); push(b, a, depth); push(b, c, depth);
    }

    const group = new THREE.Group();
    group.name = 'terrain';
    const matNear = new THREE.MeshLambertMaterial({ vertexColors: !sat, map: sat ? sat.texNear : palette.detailTex });
    const matFar = sat ? new THREE.MeshLambertMaterial({ map: sat.texFar }) : matNear;
    if (sat) { matNear.userData.ownMap = true; matFar.userData.ownMap = true; } // 스테이지를 바꿀 때 위성 텍스처도 함께 해제
    let tris = 0;
    for (const [key, b] of buckets) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
      if (!sat) g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, b.near ? matNear : matFar);
      m.receiveShadow = b.small;
      m.matrixAutoUpdate = false;
      group.add(m);
      tris += b.pos.length / 9;
    }
    group.userData.stats = { leaves: leaves.length / 3, verts: cache.size, tris, meshes: buckets.size };
    return group;
  }
}
const _tmpC = new THREE.Color();
