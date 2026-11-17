// 도트 스프라이트를 코드로 찍어 낸다 (나무, 길가 소품, 아이콘, 초상화).
import { MPP } from './const.js';
import { INK, hex } from './palette.js';
import { mulberry32 } from '../geo.js';

export function mk(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  return { c, g };
}
const css = (c) => (typeof c === 'string' ? c : `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`);
const dot = (g, x, y, c) => { g.fillStyle = css(c); g.fillRect(x, y, 1, 1); };
const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

/** 글자 지도 → 캔버스. rows: 문자열 배열, pal: { 문자: 색 }. '.'은 투명 */
export function fromMap(rows, pal, scale = 1) {
  const w = Math.max(...rows.map((r) => r.length)), h = rows.length, { c, g } = mk(w * scale, h * scale);
  rows.forEach((r, y) => [...r].forEach((ch, x) => { if (ch !== '.' && ch !== ' ' && pal[ch]) { g.fillStyle = css(pal[ch]); g.fillRect(x * scale, y * scale, scale, scale); } }));
  return c;
}

function shadow(rx, ry) {
  const { c, g } = mk(rx * 2 + 1, ry * 2 + 1);
  g.fillStyle = 'rgba(30,14,70,0.34)';
  for (let y = -ry; y <= ry; y++) { const w = Math.round(rx * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry + 0.01)))); g.fillRect(rx - w, y + ry, w * 2 + 1, 1); }
  return c;
}

export function makeTreeSprites(pal) {
  const rnd = mulberry32(77);
  const out = { decid: [], pine: [], larch: [] };
  const round = (ramp, r, squash, trunkH, trunkCol) => {
    const ry = Math.round(r * squash), w = r * 2 + 3, h = ry * 2 + 2 + trunkH, { c, g } = mk(w, h), cx = r + 1, cyc = ry + 1;
    g.fillStyle = css(trunkCol); g.fillRect(cx - 1, cyc + ry - 1, 2, trunkH + 1);
    dot(g, cx, cyc + ry + trunkH - 1, mul(trunkCol, 0.7));
    for (let y = -ry; y <= ry; y++) for (let x = -r; x <= r; x++) {
      const e = (x * x) / (r * r) + (y * y) / (ry * ry);
      if (e > 1.02) continue;
      const t = (x + y * (r / ry)) / r;
      let col = t < -0.42 ? ramp[2] : t > 0.5 ? ramp[0] : ramp[1];
      if (rnd() < 0.1) col = t < 0 ? ramp[2] : ramp[0];
      if (e > 0.78 && t > 0.15) col = mul(ramp[0], 0.72); // 아래·오른쪽 가장자리 외곽선
      dot(g, cx + x, cyc + y, col);
    }
    return { c, ax: cx, ay: h - 1, sh: shadow(r, Math.max(2, Math.round(r * 0.45))), shx: r - 3, shy: Math.max(2, Math.round(r * 0.45)) - 2, hm: (trunkH + ry) * MPP, rm: r * MPP };
  };
  const cone = (ramp, tiers) => {
    const w = tiers[0] + 2, th = 4, h = tiers.length * (th - 1) + 5, { c, g } = mk(w, h), cx = (w - 1) >> 1;
    g.fillStyle = css(pal.trunk); g.fillRect(cx, h - 3, 1, 3);
    for (let k = 0; k < tiers.length; k++) {
      const tw = tiers[k], y0 = h - 4 - (k + 1) * (th - 1);
      for (let y = 0; y < th; y++) {
        const ww = Math.max(1, Math.round((tw * (y + 1)) / th)), xs = cx - (ww >> 1);
        for (let x = 0; x < ww; x++) dot(g, xs + x, y0 + y, x < ww * 0.3 ? ramp[2] : x > ww * 0.68 ? ramp[0] : ramp[1]);
      }
    }
    return { c, ax: cx, ay: h - 1, sh: shadow((tiers[0] >> 1) + 1, 2), shx: (tiers[0] >> 1) - 2, shy: 0, hm: h * 0.5 * MPP, rm: tiers[0] * 0.5 * MPP };
  };
  for (const ramp of pal.decid) for (const r of [5, 6, 7, 8]) out.decid.push(round(ramp, r, 0.86, 3, pal.trunk));
  for (const ramp of pal.pine) for (const r of [4, 5, 5, 6]) out.pine.push(round(ramp, r, 0.72, 6 + (r & 1) * 2, pal.trunkPine));
  for (const ramp of pal.larch) for (const t of [[7, 5, 3], [9, 7, 5, 3], [9, 7, 5, 3, 1]]) out.larch.push(cone(ramp, t));
  return out;
}

export function makePropSprites(pal) {
  const P = {};
  const base = { o: '#ff7a2e', w: '#ffffff', y: '#ffd23f', b: INK, g: '#9a93b0', G: '#d2cbe2', k: '#6b6486', r: '#ff5a7a', B: '#4b6ef0', s: '#f2c9a0', d: '#55507a', p: '#ff7fd8', c: '#7fe0ff', n: '#6b4a3a', W: '#f6f2ff' };
  const tint = (h) => { const c = hex(h); return pal.tint ? [0, 1, 2].map((k) => Math.max(0, Math.min(255, c[k] * pal.tint.m[k] + pal.tint.a[k]))) : c; };
  const K = {};
  for (const k in base) K[k] = tint(base[k]);
  const S = (rows, ax, ay, sh) => { const c = fromMap(rows, K); return { c, ax: ax ?? (c.width >> 1), ay: ay ?? c.height - 1, sh: sh ? shadow(sh, 1) : null, shx: sh ? sh - 1 : 0, shy: 0 }; };
  P.cone = S(['..o..', '..o..', '.www.', '.ooo.', 'ooooo'], 2, 4, 2);
  P.chevL = S(['bbbbbbbbb', 'byybyybyb', 'bybyybyyb', 'byybyybyb', 'bbbbbbbbb', '....k....', '....k....'], 4, 6, 2);
  P.chevR = S(['bbbbbbbbb', 'bybyybyyb', 'byybyybyb', 'bybyybyyb', 'bbbbbbbbb', '....k....', '....k....'], 4, 6, 2);
  P.post = S(['.bbb.', '.rrr.', '.rrr.', '.www.', '.www.', '.rrr.', '.rrr.', '.www.', '.www.', '.rrr.', '.rrr.', '.www.', '.www.', '.rrr.', '.rrr.', '.www.', '.www.', '.rrr.', '.rrr.', '.www.', '.www.', 'kkkkk'], 2, 21, 3);
  P.busStop = S([
    'bbbbbbbbbbbbbbbbbb', 'bBBBBBBBBBBBBBBBBb', 'bBBBBBBBBBBBBBBBBb', 'bbbbbbbbbbbbbbbbbb', '.kWWWWWWWWWWWWWWk.', '.kWcWWcWWcWWcWWWk.', '.kWWWWWWWWWWWWWWk.',
    '.kWWWWWWWWWWWWWWk.', '.k..............k.', '.k.nnnnnnnnnnnn.k.', '.k..n........n..k.',
  ], 9, 10, 8);
  P.stele = S(['.kkkk.', 'kGGGGk', 'kGbbGk', 'kGGGGk', 'kGbbGk', 'kGGGGk', 'kGbbGk', 'kGGGGk', 'kGGGGk', 'kkkkkk', 'gggggggg'.slice(0, 6)], 3, 10, 4);
  const pillar = ['.kk.'];
  for (let i = 0; i < 34; i++) pillar.push(i % 9 === 8 ? 'kggk' : 'kGGk');
  pillar.push('kggggk'.slice(1, 5), 'gggg');
  P.tower = S(pillar, 2, pillar.length - 1, 4);
  const tb = ['.WWW.', 'WWWWW', '.WWW.'];
  for (let i = 0; i < 58; i++) tb.push(i % 2 ? '..W..' : '..G..');
  tb.push('.ggg.');
  P.turbine = S(tb, 2, tb.length - 1, 3); P.turbine.top = tb.length - 2;
  const py = [];
  for (let i = 0; i < 26; i++) { const w = 3 + Math.floor(i / 5); const row = Array(11).fill('.'); const l = 5 - (w >> 1), r = 5 + (w >> 1); row[l] = 'g'; row[r] = 'g'; if (i % 4 === 0) for (let x = l; x <= r; x++) row[x] = 'k'; else if (i % 4 === 2) row[5] = 'k'; py.push(row.join('')); }
  py[2] = 'kkkkkkkkkkk'; py[6] = '.kkkkkkkkk.';
  P.pylon = S(py, 5, 25, 4);
  P.fans = [];
  for (const shirt of ['r', 'B', 'y', 'p', 'c']) for (const up of [0, 1]) {
    K.t = K[shirt];
    P.fans.push(S(up ? ['t.s.t', 't.s.t', '.ttt.', '.ttt.', '.ttt.', '.d.d.', '.d.d.'] : ['..s..', '..s..', '.ttt.', 'ttttt', '.ttt.', '.d.d.', '.d.d.'], 2, 6, 2));
  }
  return P;
}

// ---------------------------------------------------------------- UI용 도트 그림
const UI = { k: INK, w: '#ffffff', s: '#f2c9a0', S: '#d9a47a', g: '#c9c2dc', p: '#7a4df0', P: '#b79bff', y: '#ffe14a', r: '#ff5a7a', o: '#ff9a3c', b: '#4b6ef0', c: '#7fe0ff', n: '#8a5a3a', d: '#55507a', m: '#ff7fd8', e: '#f6efe0', G: '#3fae6a' };
/** 할배 초상 (16×16) */
export const PORTRAIT_GRANDPA = [
  '....kkkkkkkk....', '...kwwwwwwwwk...', '..kwwwwwwwwwwk..', '..kwwwwwwwwwwk..', '.kkkkkkkkkkkkkk.', '.ksssssssssssk..', 'kkskkssssskksk..', '.ksskssssskssk..',
  '.ksssssSSssssk..', '.kswwwsSSswwwk..', '.ksswwwwwwwwsk..', '..kswwkkkkwwsk..', '..kkswwwwwwsk...', '...kkswwwwsk....', '....kkkkkkkk....', '................',
];
/** 강아지 감자 초상 (16×16) */
export const PORTRAIT_DOG = [
  '.kk........kk...', 'knnk......knnk..', 'knnnkkkkkknnnk..', 'knnkwwwwwwknnk..', '.kkwwwwwwwwkk...', '.kwwkwwwwkwwk...', '.kwwkwwwwkwwk...', '.kwwwwwwwwwwk...',
  '.kwwwwkkwwwwk...', '.kwwwkkkkwwwk...', '..kwwwmmwwwk....', '..kwwwmmwwwk....', '...kkwwwwkk.....', '.....kkkk.......', '................', '................',
];
export const ICONS = {
  engine: ['................', '....kkkkkk......', '...kggggggk.....', '..kkkkkkkkkkk...', '.kgggkrrkgggk...', '.kgggkrrkgggkkk.', '.kgggkkkkgggkgk.', '.kggggggggggkgk.', '.kggggggggggkkk.', '.kgkkgggkkggk...', '.kkkkkkkkkkkk...', '..koo.....ook...', '..kyo.....oyk...', '...k.......k....', '................', '................'],
  tire: ['................', '.....kkkkkk.....', '...kkddddddkk...', '..kddkkkkkkddk..', '..kdkggggggkdk..', '.kdkggkkkkggkdk.', '.kdkgkggggkgkdk.', '.kdkgkgkkgkgkdk.', '.kdkgkgkkgkgkdk.', '.kdkgkggggkgkdk.', '.kdkggkkkkggkdk.', '..kdkggggggkdk..', '..kddkkkkkkddk..', '...kkddddddkk...', '.....kkkkkk.....', '................'],
  brake: ['................', '.....kkkkkk.....', '...kkggggggkk...', '..kggkkkkkkggk..', '..kgkggggggkgk..', '.kgkggkkkkggkgk.', '.kgkgkrrrrkgkgk.', '.kgkgkrrrrkgkgk.', '.kgkgkrrrrkgkgk.', '.kgkgkrrrrkgkgk.', '.kgkggkkkkggkgk.', '..kgkggggggkgk..', '..kggkkkkkkggk..', '...kkggggggkk...', '.....kkkkkk.....', '................'],
  susp: ['................', '......kkkk......', '......kggk......', '.....kkkkkk.....', '....kyyyyyyk....', '.....kkkkkk.....', '....kyyyyyyk....', '.....kkkkkk.....', '....kyyyyyyk....', '.....kkkkkk.....', '....kyyyyyyk....', '.....kkkkkk.....', '......kggk......', '......kggk......', '......kkkk......', '................'],
  light: ['................', '..........kkk...', '........kkwwk...', '.......kwwwck...', '......kwwwcwk...', '.....kwwwcwwk...', '....kwwwcwwk....', '...kwwwcwwwk....', '...kwwcwwwk.....', '..kwwcwwwk......', '..kwcwwkk.......', '..kcwkk.........', '.kckk...........', '.kk.............', '................', '................'],
  nitro: ['................', '......kkkk......', '......kbbk......', '.....kkkkkk.....', '.....kccccck....'.slice(0, 16), '....kccccccck...'.slice(0, 16), '....kcwwcccck...'.slice(0, 16), '....kcwccccck...'.slice(0, 16), '....kccccccck...'.slice(0, 16), '....kccccccck...'.slice(0, 16), '....kccccccck...'.slice(0, 16), '....kkkkkkkkk...', '.....koook......', '....kyoooyk.....', '.....kyyyk......', '......kkk.......'],
  led: ['................', '.......k........', '...k...k...k....', '....k.....k.....', '......kkk.......', '.....kmmmk......', '.kk.kmmwmmk.kk..', '....kmwwwmk.....', '.kk.kmmwmmk.kk..', '.....kmmmk......', '......kkk.......', '....k.....k.....', '...k...k...k....', '.......k........', '................', '................'],
  sticker: ['................', '..kkkkkkkkkkkk..', '.kyyyyyyyyyyyyk.', '.kykkykkykkkyyk.', '.kykyykykykyyyk.'.slice(0, 16), '.kykkykkykkyyyk.', '.kyyyyyyyyyyyyk.', '.kyykkkkkkkkyyk.', '.kyykssssskyyyk.'.slice(0, 16), '.kyykskskskyyyk.'.slice(0, 16), '.kyykssssskyyyk.'.slice(0, 16), '.kyykkwwwkkyyyk.'.slice(0, 16), '.kyyyykkkyyyyyk.'.slice(0, 16), '.kyyyyyyyyyyyyk.', '..kkkkkkkkkkkk..', '................'],
  heart: ['.kk...kk.', 'kmmk.kmmk', 'kmwmkmmmk', 'kmmmmmmmk', '.kmmmmmk.', '..kmmmk..', '...kmk...', '....k....'],
  heartOff: ['.kk...kk.', 'kddk.kddk', 'kdddkdddk', 'kdddddddk', '.kdddddk.', '..kdddk..', '...kdk...', '....k....'],
  star: ['....k....', '...kyk...', 'kkkkykkkk', 'kyyyyyyyk', '.kyyyyyk.', '..kyyyk..', '.kyykyyk.', 'kyk...kyk', 'kk.....kk'],
};
const urlCache = new Map();
/** 도트 그림을 CSS에서 쓸 수 있는 data URL로 */
export function pixUrl(rows, scale = 1) {
  const key = rows.join('') + scale;
  if (!urlCache.has(key)) urlCache.set(key, fromMap(rows, UI, scale).toDataURL());
  return urlCache.get(key);
}
export function pixCanvas(rows, scale = 1) { return fromMap(rows, UI, scale); }
