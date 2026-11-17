// 캔버스 안에 찍는 도트 글자. 갈무리11을 제 크기(11 px)로 그린 뒤 경계를 잘라 번짐 없이 만든다.
import { INK, hex } from './palette.js';

const cache = new Map();
let sc = null, sg = null;
export const FONT = '11px Galmuri11, "DungGeunMo", monospace';

export function pxText(str, color = '#ffffff', outline = INK, bold = false) {
  const key = str + '|' + color + '|' + outline + '|' + (bold ? 1 : 0);
  let c = cache.get(key);
  if (c) return c;
  if (!sc) { sc = document.createElement('canvas'); sc.width = 4; sc.height = 4; sg = sc.getContext('2d', { willReadFrequently: true }); }
  sg.font = (bold ? 'bold ' : '') + FONT;
  const w = Math.max(1, Math.ceil(sg.measureText(str).width)) + 2, h = 14;
  sc.width = w; sc.height = h;
  sg.font = (bold ? 'bold ' : '') + FONT; sg.textBaseline = 'top'; sg.fillStyle = '#fff';
  sg.fillText(str, 1, 1);
  const img = sg.getImageData(0, 0, w, h), D = img.data, on = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) on[i] = D[i * 4 + 3] >= 96 ? 1 : 0;
  const fc = hex(color), oc = outline ? hex(outline) : null;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, p = i * 4;
    if (on[i]) { D[p] = fc[0]; D[p + 1] = fc[1]; D[p + 2] = fc[2]; D[p + 3] = 255; }
    else if (oc && ((x > 0 && on[i - 1]) || (x < w - 1 && on[i + 1]) || (y > 0 && on[i - w]) || (y < h - 1 && on[i + w]) || (x > 0 && y < h - 1 && on[i + w - 1]) || (x < w - 1 && y < h - 1 && on[i + w + 1]))) { D[p] = oc[0]; D[p + 1] = oc[1]; D[p + 2] = oc[2]; D[p + 3] = 255; }
    else D[p + 3] = 0;
  }
  c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d').putImageData(img, 0, 0);
  if (cache.size > 400) cache.clear();
  cache.set(key, c);
  return c;
}
/** 가운데 정렬로 찍기 */
export function drawText(g, str, x, y, color, outline, bold) {
  const c = pxText(str, color, outline, bold);
  g.drawImage(c, Math.round(x - c.width / 2), Math.round(y));
  return c.width;
}
