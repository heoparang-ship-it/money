// 좌표 변환과 실제 고도(DEM) 샘플링.
// 게임 좌표: X = 동쪽(m), Y = 실제 해발고도(m), Z = 남쪽(m)  (북쪽 = -Z)

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const wrapAngle = (a) => {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
};

export function makeProjection(lon0, lat0, R = 6371008.8) {
  const KX = (Math.PI / 180) * R * Math.cos((lat0 * Math.PI) / 180);
  const KY = (Math.PI / 180) * R;
  return {
    lon0, lat0, KX, KY,
    toLocal: (lon, lat) => [(lon - lon0) * KX, -(lat - lat0) * KY],
    toLonLat: (x, z) => [lon0 + x / KX, lat0 - z / KY],
  };
}

// 결정적 난수 (같은 스테이지는 항상 같은 풍경)
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 값 노이즈 (지형 색·나무 배치용)
function hash2(ix, iz) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}
export function fbm(x, z, oct = 3) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, z * f); a *= 0.5; f *= 2.03; }
  return s;
}

/** 실제 고도 격자. near: 12.5 m 격자(코스 주변), far: 125 m 격자(동해안까지). */
export class Dem {
  constructor(meta, near, far) {
    this.meta = meta;
    this.n = { ...meta.near, d: near };
    this.f = { ...meta.far, d: far };
    const n = this.n;
    this.nx0 = n.x0; this.nx1 = n.x0 + (n.nx - 1) * n.step;
    this.nn0 = n.y0; this.nn1 = n.y0 + (n.ny - 1) * n.step;
  }

  _bilinear(g, x, north) {
    let fx = (x - g.x0) / g.step, fy = (north - g.y0) / g.step;
    fx = clamp(fx, 0, g.nx - 1.001); fy = clamp(fy, 0, g.ny - 1.001);
    const i = fx | 0, j = fy | 0, u = fx - i, v = fy - j, o = j * g.nx + i, d = g.d;
    return ((d[o] * (1 - u) + d[o + 1] * u) * (1 - v) + (d[o + g.nx] * (1 - u) + d[o + g.nx + 1] * u) * v) * 0.1;
  }

  _bicubic(g, x, north) {
    let fx = (x - g.x0) / g.step, fy = (north - g.y0) / g.step;
    fx = clamp(fx, 1, g.nx - 2.001); fy = clamp(fy, 1, g.ny - 2.001);
    const i = fx | 0, j = fy | 0, u = fx - i, v = fy - j, d = g.d, nx = g.nx;
    const w = (t, k) => {
      // Catmull-Rom 가중치
      switch (k) {
        case 0: return ((-t + 2) * t - 1) * t * 0.5;
        case 1: return ((3 * t - 5) * t * t + 2) * 0.5;
        case 2: return ((-3 * t + 4) * t + 1) * t * 0.5;
        default: return (t - 1) * t * t * 0.5;
      }
    };
    let s = 0;
    for (let b = 0; b < 4; b++) {
      const o = (j - 1 + b) * nx + i - 1;
      const row = d[o] * w(u, 0) + d[o + 1] * w(u, 1) + d[o + 2] * w(u, 2) + d[o + 3] * w(u, 3);
      s += row * w(v, b);
    }
    return s * 0.1;
  }

  /** 지형 원본 고도 (도로 절토 반영 전). */
  height(x, z) {
    const north = -z;
    const m = Math.min(x - this.nx0, this.nx1 - x, north - this.nn0, this.nn1 - north);
    if (m <= 0) return this._bilinear(this.f, x, north);
    const hn = this._bicubic(this.n, x, north);
    if (m >= 320) return hn;
    const t = m / 320, w = t * t * (3 - 2 * t);
    return lerp(this._bilinear(this.f, x, north), hn, w);
  }

  inNear(x, z, margin = 0) {
    const north = -z;
    return x > this.nx0 + margin && x < this.nx1 - margin && north > this.nn0 + margin && north < this.nn1 - margin;
  }
}

/** 토지피복 래스터 (ESA WorldCover 기반): 0 미분류 1 숲 2 관목 3 경작지 4 시가지 5 나지 6 물 */
export class LandCover {
  constructor(meta, data) { Object.assign(this, meta); this.d = data; }
  at(x, z) {
    const i = Math.floor((x - this.x0) / this.step), j = Math.floor((-z - this.y0) / this.step);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.ny) return 1;
    return this.d[j * this.nx + i] || 1;
  }
}
