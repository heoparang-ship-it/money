// 메뉴 배경: 보랏빛 저녁 하늘, 초승달, 도트 구름, 실제 대관령 능선 실루엣, 풍력발전기.
// 아래쪽 도로에서는 할배(오늘의 핸디캡)와 내 바이크가 나란히 달린다.
import { BAYER, hex } from './palette.js';
import { mulberry32, clamp } from '../geo.js';
import { drawActor } from './vox.js';
import { mk } from './sprites.js';

const BANDS = ['#2a1670', '#3f1f9a', '#5a30c8', '#7a4de8', '#9a62f0', '#c07af2', '#e894e8', '#ffb4e4', '#ffd0ee'].map(hex);

export class SkyScene {
  constructor(data) {
    // 실제 고도에서 능선 단면 세 개를 뽑는다 (서 → 동)
    const dem = data.dem;
    this.ridges = [3000, 500, -2200].map((north, k) => {
      const a = [];
      for (let x = -9000; x <= 16000; x += 55) a.push(dem.height(x, -north + Math.sin(x * 0.0007 + k) * 600));
      const mx = Math.max(...a), mn = Math.min(...a);
      return a.map((v) => (v - mn) / (mx - mn));
    });
    this.t = 0; this.w = 0; this.h = 0;
    const r = mulberry32(5);
    this.stars = Array.from({ length: 46 }, () => [r(), r() * 0.55, r() * 6.28, r() < 0.25]);
    this.clouds = Array.from({ length: 7 }, (_, k) => ({ x: r(), y: 0.12 + r() * 0.42, sp: 2 + r() * 4, spr: this._cloud(r, k) }));
  }
  _cloud(r, k) {
    const w = 34 + ((r() * 40) | 0), h = 14 + ((r() * 8) | 0), { c, g } = mk(w, h);
    const blobs = Array.from({ length: 4 + (k % 3) }, () => [4 + r() * (w - 8), h * (0.45 + r() * 0.3), 4 + r() * (h * 0.42)]);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let inside = false;
      for (const b of blobs) if ((x - b[0]) ** 2 + ((y - b[1]) * 1.25) ** 2 < b[2] * b[2] * 1.9) { inside = true; break; }
      if (!inside && !(y > h * 0.6 && y < h - 2 && x > 3 && x < w - 4)) continue;
      g.fillStyle = y < h * 0.45 ? '#ffffff' : y < h * 0.75 ? '#fbe0ff' : '#e0b0f4';
      g.fillRect(x, y, 1, 1);
    }
    return c;
  }
  resize(w, h) {
    if (w === this.w && h === this.h) return;
    this.w = w; this.h = h;
    const { c, g } = mk(w, h), img = g.createImageData(w, h), D = img.data, n = BANDS.length - 1;
    const mx = Math.round(w * 0.2), my = Math.round(h * 0.2), mr = Math.max(12, Math.round(h * 0.07));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const f = clamp(y / (h * 0.86), 0, 0.999) * n, i = f | 0, fr = f - i;
      let col = BANDS[BAYER[(x & 3) + ((y & 3) << 2)] / 16 < fr ? i + 1 : i];
      // 초승달
      const d1 = (x - mx) ** 2 + (y - my) ** 2, d2 = (x - mx - mr * 0.5) ** 2 + (y - my + mr * 0.28) ** 2;
      if (d1 <= mr * mr && d2 > mr * mr * 0.86) col = d1 > mr * mr * 0.8 ? [255, 236, 150] : [255, 248, 200];
      const p = (y * w + x) * 4;
      D[p] = col[0]; D[p + 1] = col[1]; D[p + 2] = col[2]; D[p + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    this.bg = c;
  }
  update(dt) { this.t += dt; }
  /** riders: { player: 파츠, grandpa: 파츠 } */
  draw(g, w, H, riders, dim = 0, foot = 0) {
    const h = H - foot;
    this.resize(w, h);
    const t = this.t;
    g.drawImage(this.bg, 0, 0);
    for (const s of this.stars) {
      const x = (s[0] * w) | 0, y = (s[1] * h) | 0, tw = Math.sin(t * 1.7 + s[2]);
      g.fillStyle = tw > 0.3 ? '#ffffff' : '#d8c0ff';
      g.fillRect(x, y, 1, 1);
      if (s[3] && tw > 0.55) { g.fillRect(x - 1, y, 3, 1); g.fillRect(x, y - 1, 1, 3); }
    }
    for (const c of this.clouds) { const x = ((((c.x * (w + 120) - t * c.sp) % (w + 120)) + (w + 120)) % (w + 120)) - 80; g.drawImage(c.spr, Math.round(x), Math.round(c.y * h)); }
    // 능선 (멀수록 옅게, 가까울수록 진하게)
    const cols = ['#8a5ae8', '#5b2bc4', '#35178a'], base = [0.6, 0.68, 0.78], amp = [0.2, 0.2, 0.16], sp = [1.2, 2.6, 5];
    const roadY = h - Math.max(40, Math.round(h * 0.17));
    for (let k = 0; k < 3; k++) {
      const r = this.ridges[k], off = t * sp[k];
      g.fillStyle = cols[k];
      for (let x = 0; x < w; x++) {
        const v = r[((((x + off) * 0.55) | 0) + k * 60) % r.length];
        const y = Math.round(h * base[k] - v * h * amp[k]);
        g.fillRect(x, y, 1, roadY - y + 2);
      }
      if (k === 1) for (let i = 0; i < 6; i++) { // 풍력발전기
        const x = Math.round(((((i * 0.19 + 0.07) * (w + 60) - off) % (w + 60)) + (w + 60)) % (w + 60)) - 30;
        if (x < 2 || x >= w - 2) continue;
        const v = r[((((x + off) * 0.55) | 0) + 60) % r.length], y = Math.round(h * base[1] - v * h * amp[1]);
        g.fillStyle = '#f6f2ff'; g.fillRect(x, y - 16, 1, 16);
        for (let b = 0; b < 3; b++) { const a = t * 1.4 + i + (b * Math.PI * 2) / 3; for (let q = 1; q <= 7; q++) g.fillRect(Math.round(x + Math.cos(a) * q), Math.round(y - 16 + Math.sin(a) * q), 1, 1); }
        g.fillStyle = cols[1];
      }
    }
    // 도로
    g.fillStyle = '#2b1464'; g.fillRect(0, roadY - 3, w, 3);
    g.fillStyle = '#eef0fa'; g.fillRect(0, roadY - 5, w, 1);
    for (let x = -(((t * 60) | 0) % 16); x < w; x += 16) { g.fillStyle = '#8d92b0'; g.fillRect(x, roadY - 5, 1, 3); }
    g.fillStyle = '#4b4666'; g.fillRect(0, roadY, w, h - roadY);
    g.fillStyle = '#fff6e6'; g.fillRect(0, roadY + 2, w, 1); g.fillRect(0, h - 4, w, 1);
    g.fillStyle = '#ffd23f';
    const mid = roadY + ((h - roadY) >> 1);
    for (let x = -(((t * 90) | 0) % 24); x < w; x += 24) g.fillRect(x, mid, 12, 1);
    if (riders) {
      const bob = Math.round(Math.sin(t * 9) * 0.6);
      if (riders.grandpa) drawActor(g, Math.round(w * 0.8), mid - 3 + bob, riders.grandpa, Math.PI / 2, 0, t);
      if (riders.player) drawActor(g, Math.round(w * 0.2), mid + 9 - bob, riders.player, Math.PI / 2, 0, t);
    }
    if (foot > 0) { g.fillStyle = '#2b1464'; g.fillRect(0, h, w, foot); }
    if (dim > 0) { g.fillStyle = `rgba(30,14,80,${dim})`; g.fillRect(0, 0, w, H); }
  }
}
