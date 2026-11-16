// 정점 색을 쓰는 절차적 메시를 쌓아 올리는 작은 버퍼 도우미.
import * as THREE from 'three';

export class GeoBuf {
  constructor() { this.p = []; this.n = []; this.c = []; this.uv = []; this.idx = []; this.count = 0; }

  v(x, y, z, nx, ny, nz, r, g, b, u = 0, w = 0) {
    this.p.push(x, y, z); this.n.push(nx, ny, nz); this.c.push(r, g, b); this.uv.push(u, w);
    return this.count++;
  }
  tri(a, b, c) { this.idx.push(a, b, c); }
  quad(a, b, c, d) { this.idx.push(a, b, c, a, c, d); }

  /** 두 줄의 점(왼쪽 줄 A, 오른쪽 줄 B)을 잇는 띠. 위에서 볼 때 앞면이 위를 향한다. */
  strip(A, B) {
    for (let i = 0; i < A.length - 1; i++) { this.idx.push(A[i], B[i], B[i + 1], A[i], B[i + 1], A[i + 1]); }
  }

  /** 축 정렬 상자 (yaw 회전 가능). c: [r,g,b] */
  box(cx, cy, cz, sx, sy, sz, c, yaw = 0, shadeTop = 1.12) {
    const cs = Math.cos(yaw), sn = Math.sin(yaw);
    const P = (lx, ly, lz) => [cx + lx * cs + lz * sn, cy + ly, cz - lx * sn + lz * cs];
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    const faces = [
      [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz], [0, 0, 1], 1],
      [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz], [0, 0, -1], 0.9],
      [[hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz], [1, 0, 0], 0.95],
      [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz], [-1, 0, 0], 0.85],
      [[-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz], [0, 1, 0], shadeTop],
    ];
    for (const [a, b, d, e, nn, sh] of faces) {
      const n = [nn[0] * cs + nn[2] * sn, nn[1], -nn[0] * sn + nn[2] * cs];
      const ids = [a, b, d, e].map((q, k) => {
        const w = P(q[0], q[1], q[2]);
        return this.v(w[0], w[1], w[2], n[0], n[1], n[2], c[0] * sh, c[1] * sh, c[2] * sh, k === 1 || k === 2 ? 1 : 0, k >= 2 ? 1 : 0);
      });
      this.quad(ids[0], ids[1], ids[2], ids[3]);
    }
  }

  toGeometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
  get empty() { return this.count === 0; }
}

export function disposeTree(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of ms) { if (m.map && m.userData.ownMap) m.map.dispose(); m.dispose(); }
    }
  });
}
