// 도트 그래픽 팔레트. 레퍼런스(보라·핑크 레트로 게임 UI)에 맞춰 그림자와 외곽선은 짙은 보라로 통일한다.

export const INK = '#2b1464'; // 외곽선·글자 그림자
export const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
export const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

const SUMMER = {
  // 지형: 어두움 → 밝음 5단계 (언덕 음영)
  land: {
    1: ['#1c4f3e', '#236b45', '#2f8a4f', '#47a85c', '#72c46c'], // 숲
    2: ['#3f6b45', '#4f8750', '#6aa35c', '#88bd6a', '#a8d47c'], // 관목
    3: ['#7a8f4a', '#93a85a', '#aec06a', '#c8d67e', '#e0e896'], // 경작지
    4: ['#6f6a86', '#85809c', '#9c97b3', '#b4afc9', '#ccc8de'], // 시가지
    5: ['#7a6a5e', '#93806e', '#ab9880', '#c3b096', '#dac8ae'], // 나지
    6: ['#2c58b8', '#3a6fd6', '#4b88ee', '#69a4ff', '#8fc0ff'], // 물
  },
  verge: '#8fbf5e', cut: '#5d4b57',
  decid: [['#1f6a3c', '#35914a', '#62bd5c'], ['#256f38', '#44a04a', '#7fcf62'], ['#1c5f44', '#2f8858', '#58b874']],
  pine: [['#143f38', '#1f5e45', '#3a8057']],
  larch: [['#1d5a3a', '#2f8048', '#5aa85a']],
};
const AUTUMN = {
  land: {
    1: ['#5a3a2e', '#7a4e2e', '#9a6a30', '#b88a3c', '#d6aa4e'],
    2: ['#6b5a3a', '#87733f', '#a38d48', '#bfa758', '#d8c26c'],
    3: ['#8a7a44', '#a59250', '#bfaa5e', '#d6c274', '#ead890'],
    4: SUMMER.land[4], 5: SUMMER.land[5], 6: SUMMER.land[6],
  },
  verge: '#c2a85a', cut: '#5d4b57',
  decid: [['#a8322a', '#d9502e', '#ff8a3c'], ['#b8641e', '#e8952a', '#ffc94a'], ['#8f2a3a', '#c8413c', '#f0705a'], ['#8a7a26', '#b8a832', '#e0d458']],
  pine: [['#143f38', '#1f5e45', '#3a8057']],
  larch: [['#a8741e', '#d9a02a', '#ffd24a']],
};

const COMMON = {
  asphalt: ['#4b4666', '#544f70', '#433f5c'],
  yellow: '#ffd23f', white: '#fff6e6',
  gravel: ['#857d9c', '#978fad'],
  rail: '#eef0fa', railPost: '#8d92b0',
  wall: '#d2cbe2', wallDark: '#7a7296', parapet: '#bfb8d2',
  curbR: '#ff5a7a', curbW: '#ffffff',
  sideRoad: '#6f6a8c', dirt: '#b8905e', parking: '#5f5a7c',
  stream: '#4b88ee', water: '#3a6fd6', gully: '#2a3f7a',
  paint: '#ffe38a',
  roofs: ['#3f6fe8', '#ff8a3c', '#3fae6a', '#8a84a8', '#e8506e', '#4fb8d8'],
  walls: ['#f2ead8', '#e6d8c0', '#f6f2ee', '#d8c8b8', '#e8e2f2'],
  trunk: '#6b4a3a', trunkPine: '#b0583a',
};

// 날씨별 색 보정 (r, g, b 배율과 덧셈)
const TINT = {
  day: null,
  autumn: null,
  sunset: { m: [1.08, 0.84, 0.92], a: [26, 4, 22] },
  fog: { m: [0.86, 0.88, 0.9], a: [26, 26, 30] },
  night: { m: [0.5, 0.52, 0.86], a: [6, 4, 30] },
  rain: { m: [0.74, 0.8, 0.9], a: [4, 8, 20] },
};

export function buildPalette(weather, season) {
  const base = season === 'autumn' ? AUTUMN : SUMMER;
  const tint = TINT[weather] || null;
  const T = (h) => {
    const c = hex(h);
    if (!tint) return c;
    return [0, 1, 2].map((k) => Math.max(0, Math.min(255, Math.round(c[k] * tint.m[k] + tint.a[k]))));
  };
  const css = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
  const p = { land: {}, css, tint };
  for (const k in base.land) p.land[k] = base.land[k].map(T);
  p.land[0] = p.land[1];
  for (const k of ['verge', 'cut']) p[k] = T(base[k]);
  for (const k of ['decid', 'pine', 'larch']) p[k] = base[k].map((ramp) => ramp.map(T));
  for (const k in COMMON) {
    const v = COMMON[k];
    p[k] = Array.isArray(v) ? v.map(T) : T(v);
  }
  p.ink = T(INK);
  return p;
}
