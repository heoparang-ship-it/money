// 입체 도트(스프라이트 스택). 복셀로 조립한 모델을 층층이 쌓아 그려서, 위에서 본 화면에서도
// 바이크가 눕고 10 m 계란탑이 휘청대는 것이 보이게 한다. 복셀 하나 = 화면 1 px.
// 모델 좌표: x = 좌→우(진행 방향 기준 오른쪽이 +), y = 앞(0)→뒤, z = 아래→위.
import { INK, hex } from './palette.js';

export class Vox {
  constructor(nx, ny, nz) { this.nx = nx; this.ny = ny; this.nz = nz; this.d = new Uint8Array(nx * ny * nz); this.pal = [null]; this.idx = new Map(); }
  ci(h) { let i = this.idx.get(h); if (!i) { i = this.pal.length; this.pal.push(hex(h)); this.idx.set(h, i); } return i; }
  set(x, y, z, h) { if (x < 0 || y < 0 || z < 0 || x >= this.nx || y >= this.ny || z >= this.nz) return; this.d[(z * this.ny + y) * this.nx + x] = this.ci(h); }
  box(x0, y0, z0, x1, y1, z1, h) { for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, z, h); }
  ball(cx, cy, cz, rx, ry, rz, h, zmin = -99, zmax = 99) {
    for (let z = Math.floor(cz - rz); z <= Math.ceil(cz + rz); z++) { if (z < zmin || z > zmax) continue;
      for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 + ((z - cz) / rz) ** 2 <= 1.0) this.set(x, y, z, h);
      } }
  }
  /** 층별 캔버스. 위에 다른 복셀이 있는 칸은 옆면으로 보고 어둡게 칠한다 */
  build(px = (this.nx - 1) / 2, py = (this.ny - 1) / 2) {
    const { nx, ny, nz, d } = this, layers = [];
    for (let z = 0; z < nz; z++) {
      let any = false;
      const c = document.createElement('canvas'); c.width = nx; c.height = ny;
      const g = c.getContext('2d'), img = g.createImageData(nx, ny), D = img.data;
      for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
        const v = d[(z * ny + y) * nx + x];
        if (!v) continue;
        any = true;
        const col = this.pal[v], side = z + 1 < nz && d[((z + 1) * ny + y) * nx + x] ? 0.7 : 1, low = z < 2 ? 0.85 : 1, o = (y * nx + x) * 4;
        D[o] = col[0] * side * low; D[o + 1] = col[1] * side * low; D[o + 2] = col[2] * (side * 0.94 + 0.06) * low; D[o + 3] = 255;
      }
      if (any) { g.putImageData(img, 0, 0); layers.push({ c, z }); }
    }
    return { layers, px, py, w: nx, h: ny };
  }
}

// ---------------------------------------------------------------- 그리기
const SW = 192, SH = 300, OX = 96, OY = 250;
let sc = null, sg = null, oc = null, og = null;
function scratch() {
  if (sc) return;
  sc = document.createElement('canvas'); sc.width = SW; sc.height = SH; sg = sc.getContext('2d'); sg.imageSmoothingEnabled = false;
  oc = document.createElement('canvas'); oc.width = SW; oc.height = SH; og = oc.getContext('2d'); og.imageSmoothingEnabled = false;
}
const _items = [];
/**
 * 스택 그리기. parts: [{ m: build() 결과, z0, ox, oy, sway(z, t) → 옆으로 밀리는 px }]
 * ang: 화면 회전각(위쪽 0, 시계 방향 +), lean: 왼쪽으로 기울면 +
 */
export function drawActor(ctx, sx, sy, parts, ang, lean = 0, time = 0, outline = INK, alpha = 1) {
  scratch();
  const step = Math.PI / 32;
  ang = Math.round(ang / step) * step;
  const ca = Math.cos(ang), sa = Math.sin(ang), ls = Math.sin(lean), lcos = Math.cos(lean);
  sg.setTransform(1, 0, 0, 1, 0, 0); sg.clearRect(0, 0, SW, SH);
  _items.length = 0;
  for (const p of parts) for (const L of p.m.layers) _items.push({ z: L.z + (p.z0 || 0), L, p });
  _items.sort((a, b) => a.z - b.z);
  for (const it of _items) {
    const p = it.p, z = it.z, ox = p.ox || 0, oy = p.oy || 0;
    let tx = OX + ox * ca - oy * sa, ty = OY + ox * sa + oy * ca;
    let side = -z * ls * (p.leanK ?? 1) + (it.L.j || 0);
    if (p.sway) side += p.sway(it.L.z, time, lean);
    tx += ca * side; ty += sa * side - z * lcos;
    sg.setTransform(ca, sa, -sa, ca, Math.round(tx), Math.round(ty));
    sg.drawImage(it.L.c, -p.m.px - 0.5, -p.m.py - 0.5);
  }
  og.setTransform(1, 0, 0, 1, 0, 0); og.globalCompositeOperation = 'source-over'; og.clearRect(0, 0, SW, SH);
  og.drawImage(sc, 0, 0); og.globalCompositeOperation = 'source-in'; og.fillStyle = outline; og.fillRect(0, 0, SW, SH);
  const x = Math.round(sx) - OX, y = Math.round(sy) - OY;
  ctx.globalAlpha = 0.3 * alpha; ctx.drawImage(oc, x + 3, y + 3);
  ctx.globalAlpha = alpha;
  ctx.drawImage(oc, x - 1, y); ctx.drawImage(oc, x + 1, y); ctx.drawImage(oc, x, y - 1); ctx.drawImage(oc, x, y + 1);
  ctx.drawImage(sc, x, y);
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------- 모델
const C = {
  tire: '#2a2440', dark: '#3a3658', metal: '#b9bfd6', chrome: '#dfe4f4', black: '#221c3a', glass: '#7fd0ff', light: '#fff4c0', red: '#ff4f6a',
  citi: '#e8384f', cream: '#fff2d8', rust: '#a8704a', skin: '#f2c9a0', helm: '#fbf8ee', vest: '#9a4fd0', shirt: '#f0e2c0', pants: '#4a5488', shoe: '#ffffff', beard: '#f4f4f4',
  egg1: '#f0dcae', egg2: '#cdb486', box: '#dfe4f4', boxD: '#aab2cc', paper: '#f6f2e6', ink: '#55507a', dogW: '#fffaf0', dogE: '#c98a4a', nose: '#221c3a', pink: '#ff7fd8',
  rock: '#9a93b0', rock2: '#7d7696', deer: '#c98a4a', deerD: '#8a5a3a', wood: '#b8905e', cab: '#7fd060', straw: '#ffd870', blue: '#4b6ef0', rice: '#f6eed8', gas: '#b8c0d0',
};
const cache = new Map();

export function playerModel(up = {}) {
  const total = (up.engine || 0) + (up.tire || 0) + (up.brake || 0) + (up.susp || 0) + (up.light || 0);
  const key = `P${total >= 18 ? 2 : total >= 10 ? 1 : 0}${up.engine >= 4 ? 'e' : ''}${up.tire >= 3 ? 't' : ''}${up.sticker ? 's' : ''}`;
  if (cache.has(key)) return cache.get(key);
  const body = total >= 18 ? '#2f2a4a' : total >= 10 ? '#ff4f6a' : '#3f7bff', acc = total >= 18 ? '#ffcf3f' : '#ffffff';
  const suit = total >= 18 ? '#221c3a' : '#3a3658', helm = total >= 18 ? '#ffcf3f' : '#ffffff';
  const v = new Vox(9, 21, 17), w = up.tire >= 3 ? 1 : 0;
  v.box(3, 0, 0, 5, 5, 5, C.tire); v.box(3 - w, 15, 0, 5 + w, 20, 5, C.tire);
  v.box(2, 5, 2, 6, 14, 5, C.dark);
  v.box(2, 3, 3, 6, 10, 7, body); v.box(3, 1, 5, 5, 3, 8, body); v.box(3, 0, 6, 5, 0, 7, C.light);
  v.box(3, 2, 9, 5, 3, 9, C.glass);
  v.box(2, 6, 7, 6, 10, 9, body); v.box(4, 6, 9, 4, 10, 9, acc);
  v.box(3, 11, 7, 5, 14, 8, C.black); v.box(3, 14, 7, 5, 18, 9, body); v.box(4, 15, 9, 4, 17, 9, acc); v.box(3, 19, 8, 5, 19, 9, C.red);
  v.box(7, 12, 3, 7, 18, 4, up.engine >= 3 ? '#8fb0ff' : C.metal);
  if (up.engine >= 4) v.box(1, 12, 3, 1, 18, 4, '#8fb0ff');
  v.box(0, 5, 9, 8, 5, 9, C.dark);
  v.box(1, 8, 4, 1, 13, 7, suit); v.box(7, 8, 4, 7, 13, 7, suit);
  v.box(2, 10, 9, 6, 13, 10, suit); v.box(2, 7, 10, 6, 12, 12, suit); v.box(3, 11, 13, 5, 12, 13, body);
  v.box(1, 5, 10, 1, 8, 11, suit); v.box(7, 5, 10, 7, 8, 11, suit);
  v.ball(4, 6.5, 13.6, 2.2, 2.3, 2.3, helm); v.box(3, 4, 13, 5, 4, 14, C.black);
  if (up.sticker) v.box(4, 18, 10, 4, 18, 10, '#ffe14a');
  const m = [{ m: v.build(4, 10) }];
  cache.set(key, m);
  return m;
}

/** 씨티백 차체 */
function citi(v, cx) {
  v.box(cx - 1, 0, 0, cx + 1, 5, 5, C.tire); v.box(cx - 1, 15, 0, cx + 1, 20, 5, C.tire);
  v.box(cx - 1, 1, 6, cx + 1, 4, 6, C.cream); v.box(cx - 1, 15, 6, cx + 1, 19, 7, C.cream);
  v.box(cx - 1, 5, 2, cx + 1, 15, 5, C.citi); v.box(cx - 2, 7, 1, cx + 2, 10, 3, C.metal);
  v.box(cx - 3, 4, 3, cx + 3, 5, 9, C.cream);
  v.box(cx - 2, 3, 9, cx + 2, 4, 11, C.citi); v.box(cx - 1, 2, 8, cx + 1, 2, 10, C.light);
  v.box(cx - 5, 4, 11, cx + 5, 4, 11, C.dark); v.box(cx - 5, 3, 12, cx - 5, 3, 13, C.chrome); v.box(cx + 5, 3, 12, cx + 5, 3, 13, C.chrome);
  v.box(cx - 2, 7, 5, cx + 2, 15, 7, C.citi); v.box(cx - 2, 7, 8, cx + 2, 14, 8, C.black);
  v.box(cx - 3, 15, 8, cx + 3, 19, 8, C.chrome); v.box(cx - 1, 20, 6, cx + 1, 20, 7, C.red);
  v.box(cx + 2, 11, 2, cx + 3, 18, 3, C.rust);
}
function head(v, cx, cy, z, mask) {
  v.ball(cx, cy, z, 2.3, 2.3, 2.3, C.skin); v.ball(cx, cy, z + 0.6, 2.7, 2.7, 2.6, C.helm, z);
  if (mask) v.box(cx - 2, Math.round(cy - 2.6), z, cx + 2, Math.round(cy - 2.6), z + 1, '#5b2bc4');
}
function legsFront(v, cx) {
  v.box(cx - 3, 6, 4, cx - 2, 10, 7, C.pants); v.box(cx + 2, 6, 4, cx + 3, 10, 7, C.pants);
  v.box(cx - 3, 5, 3, cx - 2, 6, 4, C.shoe); v.box(cx + 2, 5, 3, cx + 3, 6, 4, C.shoe);
}
function torso(v, cx, y0 = 8, y1 = 11) { v.box(cx - 2, y0 + 1, 9, cx + 2, y1, 10, C.pants); v.box(cx - 3, y0, 11, cx + 3, y1, 15, C.vest); v.box(cx - 1, y0 - 1, 15, cx + 1, y0 - 1, 16, C.beard); }
const armBarL = (v, cx) => v.box(cx - 5, 5, 12, cx - 4, 9, 13, C.shirt);
const armBarR = (v, cx) => v.box(cx + 4, 5, 12, cx + 5, 9, 13, C.shirt);

function eggTower(n) {
  // 계란판: 두 층은 밝게, 한 층은 어두운 테두리. 판마다 조금씩 어긋나게 쌓는다.
  const mkTray = (fill, dot, edge) => { const t = new Vox(9, 9, 1); for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) t.set(x, y, 0, x === 0 || y === 0 || x === 8 || y === 8 ? edge : (x + y) % 2 ? fill : dot); return t.build(4, 4).layers[0].c; };
  const A = mkTray(C.egg1, '#ffffff', '#fff3d2'), B = mkTray(C.egg1, '#fff6dc', '#f3deb0'), D = mkTray(C.egg2, C.egg2, '#b8956a');
  const layers = [];
  for (let z = 0; z < n; z++) layers.push({ c: z % 3 === 2 ? D : z % 3 ? A : B, z, j: ((Math.floor(z / 3) * 7919) % 3) - 1 });
  return { layers, px: 4, py: 4, w: 9, h: 9 };
}

/**
 * 할배 모델. handicap: coffee | boxes2 | eggtower | backward | feet | blind | dog | umbrella | nap | serious
 * effort: 따라붙느라 핸디캡을 하나 풀었을 때. frame: 0/1 (손 흔들기·꼬리 등)
 */
export function grandpaModel(handicap, effort = false, frame = 0, towerN = 90) {
  const key = `G${handicap}${effort ? 'e' : ''}${frame}${towerN}`;
  if (cache.has(key)) return cache.get(key);
  const cx = 9, v = new Vox(19, 25, 30), parts = [];
  citi(v, cx);
  const upright = () => { legsFront(v, cx); torso(v, cx); head(v, cx, 9.5, 18); };
  switch (handicap) {
    case 'coffee':
      upright(); armBarL(v, cx);
      if (effort) armBarR(v, cx);
      else { v.box(cx + 4, 9, 12, cx + 6, 10, 13, C.shirt); v.box(cx + 6, 8, 13, cx + 7, 9, 15, '#ffffff'); v.box(cx + 6, 8, 16, cx + 7, 9, 16, '#8a5a3a'); }
      break;
    case 'boxes2': {
      upright();
      const boxAt = (x0) => { v.box(x0, 8, 6, x0 + 2, 11, 11, C.box); v.box(x0, 8, 6, x0 + 2, 8, 11, C.boxD); v.box(x0 + 1, 9, 12, x0 + 1, 10, 12, C.dark); };
      v.box(cx + 4, 9, 12, cx + 7, 10, 13, C.shirt); boxAt(cx + 6);
      if (effort) { armBarL(v, cx); v.box(cx - 1, 15, 9, cx + 1, 18, 14, C.box); v.box(cx - 1, 15, 9, cx + 1, 15, 14, C.boxD); }
      else { v.box(cx - 7, 9, 12, cx - 4, 10, 13, C.shirt); boxAt(cx - 8); }
      break;
    }
    case 'eggtower':
      upright(); armBarL(v, cx); armBarR(v, cx);
      parts.push({ m: eggTower(towerN), z0: 9, ox: 0, oy: 6.5, leanK: 0.22, sway: (z, t, lean) => (Math.sin(t * 2.1 + z * 0.06) * 6 + lean * 9) * (z / towerN) ** 2 });
      break;
    case 'backward': {
      // 뒤로 돌아앉아 뒤따라오는 사람을 구경한다
      v.box(cx - 3, 12, 4, cx - 2, 16, 7, C.pants); v.box(cx + 2, 12, 4, cx + 3, 16, 7, C.pants);
      v.box(cx - 3, 16, 3, cx - 2, 17, 4, C.shoe); v.box(cx + 2, 16, 3, cx + 3, 17, 4, C.shoe);
      v.box(cx - 2, 9, 9, cx + 2, 11, 10, C.pants); v.box(cx - 3, 8, 11, cx + 3, 11, 15, C.vest); v.box(cx - 1, 12, 15, cx + 1, 12, 16, C.beard);
      head(v, cx, 9.5, 18);
      if (effort) v.box(cx + 4, 5, 12, cx + 5, 8, 13, C.shirt); // 손을 뒤로 뻗어 핸들을 잡는다
      const wx = frame ? cx - 6 : cx - 5;
      v.box(wx, 11, 14, wx + 1, 12, 19, C.shirt); v.box(wx, 11, 20, wx + 1, 12, 20, C.skin);
      v.box(cx + 4, 12, 12, cx + 5, 14, 13, C.shirt);
      break;
    }
    case 'nap':
    case 'feet': {
      // 시트에 누워 발로 핸들을 잡는다
      v.box(cx - 3, 9, 9, cx + 3, 15, 11, C.vest); v.box(cx - 2, 15, 9, cx + 2, 15, 10, C.shirt);
      v.box(cx - 3, 5, 9, cx - 2, 9, 11, C.pants); v.box(cx + 2, 5, 9, cx + 3, 9, 11, C.pants);
      v.box(cx - 4, 3, 11, cx - 3, 4, 13, C.shoe); v.box(cx + 3, 3, 11, cx + 4, 4, 13, C.shoe);
      v.ball(cx, 17.5, 11.5, 2.3, 2.3, 2.3, C.skin); v.ball(cx, 18, 12, 2.7, 2.7, 2.5, C.helm, 12);
      v.box(cx - 5, 15, 9, cx - 4, 18, 10, C.shirt); v.box(cx + 4, 15, 9, cx + 5, 18, 10, C.shirt);
      if (effort) { v.box(cx + 4, 5, 12, cx + 5, 12, 12, C.shirt); }
      if (handicap === 'nap') parts.push({ m: eggTower(towerN), z0: 12, ox: 0, oy: 1, leanK: 0.22, sway: (z, t, lean) => (Math.sin(t * 1.6 + z * 0.06) * 7 + lean * 9) * (z / towerN) ** 2 });
      break;
    }
    case 'blind':
      upright();
      if (effort) { armBarL(v, cx); armBarR(v, cx); v.box(cx - 2, 15, 9, cx + 2, 18, 9, C.paper); }
      else {
        v.box(cx - 6, 3, 13, cx + 6, 7, 13, C.paper);
        for (const y of [4, 6]) for (let x = cx - 5; x <= cx + 5; x++) if ((x + y) % 3) v.set(x, y, 13, C.ink);
        v.box(cx - 6, 6, 12, cx - 5, 9, 13, C.shirt); v.box(cx + 5, 6, 12, cx + 6, 9, 13, C.shirt);
      }
      v.box(cx - 2, 7, 18, cx + 2, 7, 19, '#5b2bc4');
      break;
    case 'dog': {
      // 감자가 운전, 할배는 짐받이에 거꾸로 앉아 구경
      v.box(cx - 2, 7, 9, cx + 2, 11, 12, C.dogW); v.box(cx - 2, 4, 12, cx + 2, 7, 15, C.dogW);
      v.box(cx - 2, 5, 16, cx - 2, 6, effort ? 18 : 17, C.dogE); v.box(cx + 2, 5, 16, cx + 2, 6, effort ? 18 : 17, C.dogE);
      v.box(cx - 1, 3, 13, cx + 1, 3, 14, C.dogW); v.set(cx, 2, 14, C.nose);
      v.box(cx - 4, 4, 11, cx - 3, 5, 12, C.dogW); v.box(cx + 3, 4, 11, cx + 4, 5, 12, C.dogW);
      v.box(cx + (frame ? 1 : -1), 12, 12, cx + (frame ? 1 : -1), 12, 15, C.dogW);
      v.box(cx - 2, 15, 9, cx + 2, 17, 10, C.pants); v.box(cx - 3, 14, 11, cx + 3, 17, 15, C.vest); v.box(cx - 1, 18, 15, cx + 1, 18, 16, C.beard);
      head(v, cx, 15.5, 18);
      v.box(cx - 3, 18, 5, cx - 2, 21, 8, C.pants); v.box(cx + 2, 18, 5, cx + 3, 21, 8, C.pants);
      v.box(cx - 3, 22, 4, cx - 2, 23, 5, C.shoe); v.box(cx + 2, 22, 4, cx + 3, 23, 5, C.shoe);
      if (frame) { v.box(cx + 4, 17, 12, cx + 5, 22, 13, C.shirt); v.box(cx - 5, 15, 12, cx - 4, 17, 13, C.shirt); }
      else { v.box(cx + 4, 15, 13, cx + 5, 16, 19, C.shirt); v.box(cx - 5, 15, 13, cx - 4, 16, 19, C.shirt); }
      break;
    }
    case 'umbrella':
      upright();
      if (effort) armBarL(v, cx); else v.box(cx - 5, 8, 13, cx - 4, 10, 17, C.shirt);
      v.box(cx + 4, 9, 12, cx + 4, 10, 16, C.shirt); v.box(cx + 4, 9, 17, cx + 4, 9, 23, C.dark);
      for (let y = -8; y <= 8; y++) for (let x = -8; x <= 8; x++) {
        const r2 = x * x + y * y;
        if (r2 > 70) continue;
        const a = Math.atan2(y, x), seg = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 8) % 2;
        v.set(cx + 2 + x, 9 + y, r2 > 40 ? 23 : 24, seg ? C.pink : '#ffffff');
      }
      v.set(cx + 2, 9, 25, C.dark);
      break;
    case 'serious':
      legsFront(v, cx);
      v.box(cx - 2, 10, 9, cx + 2, 12, 10, C.pants); v.box(cx - 3, 6, 10, cx + 3, 11, 13, C.vest);
      armBarL(v, cx); armBarR(v, cx);
      v.ball(cx, 6.5, 15, 2.3, 2.3, 2.3, C.skin); v.ball(cx, 6.5, 15.6, 2.7, 2.7, 2.6, C.helm, 15);
      v.box(cx - 3, 4, 15, cx + 3, 9, 15, C.red);
      break;
    default:
      upright(); armBarL(v, cx); armBarR(v, cx);
  }
  parts.unshift({ m: v.build(cx, 10) });
  cache.set(key, parts);
  return parts;
}

export function cargoPart(kind) {
  const key = 'C' + kind;
  if (cache.has(key)) return cache.get(key);
  const v = new Vox(7, 7, 12);
  if (kind === 'box') { v.box(1, 1, 0, 5, 5, 6, C.box); v.box(1, 1, 0, 5, 1, 6, C.boxD); v.box(3, 2, 7, 3, 4, 7, C.dark); }
  else if (kind === 'rice') { v.box(0, 0, 0, 6, 6, 3, C.rice); v.box(2, 0, 3, 4, 6, 3, C.red); }
  else if (kind === 'gas') { v.ball(3, 3, 4, 3, 3, 5.5, C.gas); v.box(2, 2, 10, 4, 4, 11, '#ffcf3f'); }
  const p = { m: v.build(3, 3), z0: 9, ox: 0, oy: 7 };
  cache.set(key, p);
  return p;
}

export function obstacleModel(kind) {
  if (cache.has(kind)) return cache.get(kind);
  let v;
  if (kind === 'rock') { v = new Vox(11, 10, 6); v.ball(4, 5, 1.5, 4, 3.6, 3.6, C.rock); v.ball(7.5, 4, 1, 3, 2.6, 2.8, C.rock2); v.ball(6, 7.5, 0.6, 2.2, 2, 2, C.rock); }
  else if (kind === 'deer') {
    v = new Vox(7, 15, 14);
    for (const [x, y] of [[2, 4], [4, 4], [2, 10], [4, 10]]) v.box(x, y, 0, x, y, 4, C.deerD);
    v.box(2, 3, 5, 4, 11, 8, C.deer); v.box(2, 1, 8, 4, 3, 11, C.deer); v.box(2, 0, 9, 4, 0, 10, C.deer); v.set(3, 0, 9, C.nose);
    v.box(1, 2, 12, 1, 2, 13, C.deerD); v.box(5, 2, 12, 5, 2, 13, C.deerD); v.box(3, 12, 7, 3, 12, 8, '#ffffff');
  } else {
    // 경운기 + 배추 실은 트레일러 + 밀짚모자 아저씨
    v = new Vox(11, 31, 18);
    v.box(3, 0, 3, 7, 6, 8, '#e8384f'); v.box(4, 0, 4, 6, 0, 6, C.metal);
    v.box(1, 1, 0, 2, 7, 6, C.tire); v.box(8, 1, 0, 9, 7, 6, C.tire);
    v.box(3, 7, 8, 3, 14, 8, C.dark); v.box(7, 7, 8, 7, 14, 8, C.dark);
    v.box(1, 15, 4, 9, 29, 5, C.wood); v.box(1, 15, 6, 1, 29, 7, C.wood); v.box(9, 15, 6, 9, 29, 7, C.wood); v.box(1, 29, 6, 9, 29, 7, C.wood);
    v.box(0, 20, 0, 1, 25, 4, C.tire); v.box(9, 20, 0, 10, 25, 4, C.tire);
    for (let k = 0; k < 8; k++) v.ball(3 + (k % 2) * 4, 19 + Math.floor(k / 2) * 3, 7.5, 1.8, 1.6, 1.6, C.cab);
    v.box(3, 14, 6, 7, 16, 11, C.blue); v.ball(5, 15, 13.5, 1.8, 1.8, 1.8, C.skin);
    for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++) if (x * x + y * y <= 10) v.set(5 + x, 15 + y, 15, C.straw);
    v.box(4, 14, 16, 6, 16, 16, C.straw);
  }
  const m = [{ m: v.build() }];
  cache.set(kind, m);
  return m;
}
