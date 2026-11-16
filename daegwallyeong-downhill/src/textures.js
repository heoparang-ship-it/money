// 모든 텍스처는 캔버스에 코드로 그린다 (이미지 파일 없음).
import * as THREE from 'three';
import { mulberry32 } from './geo.js';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
function tex(c, { repeat = false, aniso = 8, srgb = true, mip = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (!mip) { t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; }
  return t;
}

/** 아스팔트 + 차선. u: 도로 폭, v: 진행 방향(12 m 반복). */
export function makeAsphalt(wet = 0) {
  const W = 512, H = 1024, c = canvas(W, H), g = c.getContext('2d'), rnd = mulberry32(7);
  g.fillStyle = wet ? '#232528' : '#3b3c3f';
  g.fillRect(0, 0, W, H);
  const img = g.getImageData(0, 0, W, H), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * 34 + (rnd() < 0.02 ? 30 : 0);
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  // 바퀴 자국(조금 밝은 띠), 보수 흔적
  for (const u of [0.2, 0.34, 0.66, 0.8]) {
    const gr = g.createLinearGradient(u * W - 22, 0, u * W + 22, 0);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.035)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(u * W - 22, 0, 44, H);
  }
  g.globalAlpha = 0.35; g.strokeStyle = '#1c1c1e'; g.lineWidth = 3;
  for (let k = 0; k < 7; k++) {
    g.beginPath();
    let x = rnd() * W, y = rnd() * H;
    g.moveTo(x, y);
    for (let j = 0; j < 6; j++) { x += (rnd() - 0.5) * 70; y += rnd() * 60; g.lineTo(x, y); }
    g.stroke();
  }
  g.globalAlpha = 1;
  // 중앙선: 황색 실선 2줄 (추월 금지 산악도로)
  g.fillStyle = '#e2b021';
  g.fillRect(W * 0.5 - 13, 0, 8, H);
  g.fillRect(W * 0.5 + 5, 0, 8, H);
  // 가장자리 흰 실선
  g.fillStyle = '#e9e9e4';
  g.fillRect(W * 0.045, 0, 9, H);
  g.fillRect(W * 0.955 - 9, 0, 9, H);
  // 닳은 느낌
  g.globalCompositeOperation = 'destination-out';
  g.globalAlpha = 0.25;
  for (let k = 0; k < 500; k++) g.fillRect(rnd() * W, rnd() * H, 2 + rnd() * 5, 2 + rnd() * 9);
  g.globalCompositeOperation = 'destination-over';
  g.globalAlpha = 1; g.fillStyle = wet ? '#232528' : '#3b3c3f'; g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'source-over';
  return tex(c, { repeat: true, aniso: 16 });
}

/** 지형·구조물에 곱해지는 거친 질감 (회색조). */
export function makeGrain(seed = 3, size = 256, contrast = 60) {
  const c = canvas(size, size), g = c.getContext('2d'), rnd = mulberry32(seed);
  const img = g.createImageData(size, size), d = img.data;
  // 큰 얼룩 + 고운 입자
  const blob = new Float32Array(size * size);
  for (let k = 0; k < 90; k++) {
    const cx = rnd() * size, cy = rnd() * size, r = 6 + rnd() * 28, a = (rnd() - 0.5) * 0.9;
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
      const dd = (x * x + y * y) / (r * r);
      if (dd > 1) continue;
      const px = ((cx + x) | 0) & (size - 1), py = ((cy + y) | 0) & (size - 1);
      blob[py * size + px] += a * (1 - dd);
    }
  }
  for (let i = 0; i < size * size; i++) {
    const v = 226 + blob[i] * contrast + (rnd() - 0.5) * contrast * 0.7;
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = Math.max(0, Math.min(255, v));
    d[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return tex(c, { repeat: true, aniso: 4 });
}

/** 표지판 아틀라스 (4x4 칸). 반환: { texture, cell(name) -> [u0, v0, u1, v1] } */
export function makeSignAtlas() {
  const S = 256, N = 4, c = canvas(S * N, S * N), g = c.getContext('2d');
  const cells = {};
  let n = 0;
  const cell = (name, draw) => {
    const cx = (n % N) * S, cy = Math.floor(n / N) * S;
    g.save(); g.translate(cx, cy); draw(); g.restore();
    cells[name] = [cx / (S * N), 1 - (cy + S) / (S * N), (cx + S) / (S * N), 1 - cy / (S * N)];
    n++;
  };
  const chevron = (dir) => () => {
    g.fillStyle = '#f4c20d'; g.fillRect(8, 40, S - 16, S - 80);
    g.strokeStyle = '#111'; g.lineWidth = 6; g.strokeRect(8, 40, S - 16, S - 80);
    g.fillStyle = '#111';
    for (let k = 0; k < 2; k++) {
      const x = 50 + k * 90;
      g.beginPath();
      if (dir > 0) { g.moveTo(x, 62); g.lineTo(x + 50, 62); g.lineTo(x + 100, 128); g.lineTo(x + 50, 194); g.lineTo(x, 194); g.lineTo(x + 50, 128); }
      else { g.moveTo(S - x, 62); g.lineTo(S - x - 50, 62); g.lineTo(S - x - 100, 128); g.lineTo(S - x - 50, 194); g.lineTo(S - x, 194); g.lineTo(S - x - 50, 128); }
      g.closePath(); g.fill();
    }
  };
  cell('chevL', chevron(-1));
  cell('chevR', chevron(1));
  const speed = (v) => () => {
    g.beginPath(); g.arc(128, 128, 118, 0, 7); g.fillStyle = '#d41f1f'; g.fill();
    g.beginPath(); g.arc(128, 128, 88, 0, 7); g.fillStyle = '#fff'; g.fill();
    g.fillStyle = '#111'; g.font = 'bold 110px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(v), 128, 136);
  };
  cell('s30', speed(30));
  cell('s40', speed(40));
  const warn = (drawIcon) => () => {
    g.beginPath(); g.moveTo(128, 14); g.lineTo(246, 226); g.lineTo(10, 226); g.closePath();
    g.fillStyle = '#d41f1f'; g.fill();
    g.beginPath(); g.moveTo(128, 52); g.lineTo(214, 208); g.lineTo(42, 208); g.closePath();
    g.fillStyle = '#f7d11e'; g.fill();
    g.fillStyle = '#111'; g.strokeStyle = '#111';
    drawIcon();
  };
  cell('curveL', warn(() => { g.lineWidth = 16; g.beginPath(); g.moveTo(150, 200); g.quadraticCurveTo(150, 130, 100, 110); g.stroke(); g.beginPath(); g.moveTo(84, 92); g.lineTo(124, 96); g.lineTo(100, 132); g.fill(); }));
  cell('curveR', warn(() => { g.lineWidth = 16; g.beginPath(); g.moveTo(106, 200); g.quadraticCurveTo(106, 130, 156, 110); g.stroke(); g.beginPath(); g.moveTo(172, 92); g.lineTo(132, 96); g.lineTo(156, 132); g.fill(); }));
  cell('rocks', warn(() => { g.beginPath(); g.moveTo(70, 200); g.lineTo(150, 100); g.lineTo(150, 200); g.fill(); for (const [x, y, r] of [[176, 150, 10], [190, 182, 12], [168, 190, 8]]) { g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); } }));
  cell('deer', warn(() => {
    // 고라니 실루엣
    g.beginPath(); g.ellipse(124, 158, 38, 17, -0.15, 0, 7); g.fill();
    g.beginPath(); g.ellipse(168, 122, 12, 9, -0.5, 0, 7); g.fill();
    g.lineWidth = 9; g.beginPath(); g.moveTo(152, 148); g.lineTo(164, 126); g.stroke();
    g.lineWidth = 6;
    for (const [x1, y1, x2, y2] of [[100, 168, 88, 204], [112, 170, 116, 204], [142, 168, 138, 204], [152, 164, 168, 200]]) { g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); }
    g.beginPath(); g.moveTo(170, 114); g.lineTo(166, 98); g.moveTo(176, 114); g.lineTo(180, 99); g.stroke();
  }));
  const board = (bg, lines, fg = '#fff', font = 46) => () => {
    g.fillStyle = bg; g.fillRect(4, 30, S - 8, S - 60);
    g.strokeStyle = fg; g.lineWidth = 5; g.strokeRect(12, 38, S - 24, S - 76);
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    lines.forEach((t, i) => { g.font = `bold ${font}px sans-serif`; g.fillText(t, 128, 128 + (i - (lines.length - 1) / 2) * (font + 10), S - 36); });
  };
  cell('r456', board('#1b4fa0', ['지방도', '456'], '#fff', 62));
  cell('gangneung', board('#157a3e', ['강릉 ↓', '성산'], '#fff', 54));
  cell('oldroad', board('#5a3b1c', ['대관령', '옛길'], '#ffe9b0', 58));
  cell('closed', board('#f4c20d', ['통제', '구간'], '#111', 62));
  cell('slow', board('#f4c20d', ['천천히'], '#111', 66));
  cell('start', board('#c0271f', ['출발'], '#fff', 96));
  cell('finish', board('#1d1d1f', ['도착'], '#ffe14a', 96));
  cell('bus', board('#2f6fd0', ['버스'], '#fff', 80));
  return { texture: tex(c, { aniso: 8 }), cells };
}

/** 노면 표시(천천히 등)용 투명 데칼 아틀라스. */
export function makeDecalAtlas() {
  const W = 256, H = 512, c = canvas(W * 4, H), g = c.getContext('2d');
  const put = (k, text, color = '#f1f1ec') => {
    g.save(); g.translate(k * W, 0);
    g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle';
    // 세로로 길게 늘인 노면 글자
    const chars = [...text];
    chars.forEach((ch, i) => {
      g.save();
      g.translate(W / 2, H - (i + 0.5) * (H / chars.length));
      g.scale(1, H / chars.length / 150);
      g.font = 'bold 150px sans-serif';
      g.fillText(ch, 0, 0);
      g.restore();
    });
    g.restore();
  };
  put(0, '천천히');
  put(1, '급커브', '#f0c23a');
  // 체크무늬 (출발·결승선)
  g.save(); g.translate(2 * W, 0);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 4; x++) { g.fillStyle = (x + y) % 2 ? '#f4f4f0' : '#101012'; g.fillRect(x * 64, y * 64, 64, 64); }
  g.restore();
  // 화살표
  g.save(); g.translate(3 * W, 0); g.fillStyle = '#f1f1ec';
  g.beginPath(); g.moveTo(128, 30); g.lineTo(220, 200); g.lineTo(160, 200); g.lineTo(160, 480); g.lineTo(96, 480); g.lineTo(96, 200); g.lineTo(36, 200); g.closePath(); g.fill();
  g.restore();
  const t = tex(c, { aniso: 8 });
  return { texture: t, cell: (k) => [k / 4, 0, (k + 1) / 4, 1] };
}

/** 글자 간판 (버스정류장 이름, 현수막 등). */
export function makeTextTexture(lines, { w = 512, h = 128, bg = '#1b4fa0', fg = '#fff', font = 56, border = true } = {}) {
  const c = canvas(w, h), g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  if (border) { g.strokeStyle = fg; g.lineWidth = 6; g.strokeRect(8, 8, w - 16, h - 16); }
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
  const arr = Array.isArray(lines) ? lines : [lines];
  arr.forEach((t, i) => {
    g.font = `bold ${font}px "Apple SD Gothic Neo","Malgun Gothic","Noto Sans KR",sans-serif`;
    g.fillText(t, w / 2, h / 2 + (i - (arr.length - 1) / 2) * (font + 8), w - 40);
  });
  return tex(c, { aniso: 8 });
}

/** 파티클용 부드러운 원. */
export function makeSoftDot() {
  const c = canvas(64, 64), g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return tex(c, { srgb: false });
}

/** 송전탑 격자 (알파). */
export function makeLattice() {
  const c = canvas(128, 512), g = c.getContext('2d');
  g.strokeStyle = '#9aa0a6'; g.lineWidth = 5;
  const L = (x1, y1, x2, y2) => { g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); };
  const wAt = (y) => 14 + (y / 512) * 44;
  L(64 - wAt(512), 512, 64 - wAt(60), 60); L(64 + wAt(512), 512, 64 + wAt(60), 60);
  for (let y = 60; y < 512; y += 56) {
    const a = wAt(y), b = wAt(Math.min(512, y + 56));
    L(64 - a, y, 64 + a, y); L(64 - a, y, 64 + b, y + 56); L(64 + a, y, 64 - b, y + 56);
  }
  for (const y of [70, 130, 190]) { L(4, y, 124, y); L(4, y, 64 - wAt(y), y + 22); L(124, y, 64 + wAt(y), y + 22); }
  L(64 - wAt(60), 60, 64, 8); L(64 + wAt(60), 60, 64, 8);
  const t = tex(c, { aniso: 4 });
  return t;
}

/** 건물 벽 (창문 줄무늬). */
export function makeWallTexture() {
  const c = canvas(256, 256), g = c.getContext('2d'), rnd = mulberry32(11);
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(0,0,0,${rnd() * 0.05})`; g.fillRect(rnd() * 256, rnd() * 256, 3, 3); }
  // 창문 2개 + 문틀 느낌 (가로 4 m, 세로 3.2 m 한 칸)
  g.fillStyle = '#39485a';
  g.fillRect(34, 70, 76, 86); g.fillRect(150, 70, 76, 86);
  g.strokeStyle = '#d9d9d6'; g.lineWidth = 6;
  g.strokeRect(34, 70, 76, 86); g.strokeRect(150, 70, 76, 86);
  g.beginPath(); g.moveTo(72, 70); g.lineTo(72, 156); g.moveTo(188, 70); g.lineTo(188, 156); g.stroke();
  g.fillStyle = 'rgba(0,0,0,0.10)'; g.fillRect(0, 232, 256, 24);
  return tex(c, { repeat: true, aniso: 4 });
}
