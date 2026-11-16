// 바이크와 라이더 모델. 전부 기본 도형을 코드로 조립한다 (외부 에셋 없음).
// 모델 좌표: 앞 = +Z, 위 = +Y, 왼쪽 = +X.
import * as THREE from 'three';
import { clamp, lerp } from './geo.js';

const matCache = new Map();
function phong(hex, shininess = 50, spec = 0x555555) {
  const k = `p${hex}${shininess}`;
  if (!matCache.has(k)) matCache.set(k, new THREE.MeshPhongMaterial({ color: hex, shininess, specular: spec }));
  return matCache.get(k);
}
function matte(hex) {
  const k = `l${hex}`;
  if (!matCache.has(k)) matCache.set(k, new THREE.MeshLambertMaterial({ color: hex }));
  return matCache.get(k);
}
function glow(hex) {
  return new THREE.MeshBasicMaterial({ color: hex, toneMapped: false });
}
const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3();

function add(parent, geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}
function box(parent, w, h, d, x, y, z, mat, rx = 0, ry = 0, rz = 0) {
  const m = add(parent, new THREE.BoxGeometry(w, h, d), mat, x, y, z);
  m.rotation.set(rx, ry, rz);
  return m;
}
function ell(parent, rx, ry, rz, x, y, z, mat, seg = 14) {
  const m = add(parent, new THREE.SphereGeometry(1, seg, Math.max(8, seg - 4)), mat, x, y, z);
  m.scale.set(rx, ry, rz);
  return m;
}
/** 두 점 사이의 원통/캡슐 */
function rod(parent, a, b, r, mat, capsule = true, r2 = null) {
  _a.set(a[0], a[1], a[2]); _b.set(b[0], b[1], b[2]);
  const len = _a.distanceTo(_b);
  const geo = capsule ? new THREE.CapsuleGeometry(r, Math.max(0.01, len), 3, 8) : new THREE.CylinderGeometry(r2 ?? r, r, len, 10);
  const m = add(parent, geo, mat, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  m.quaternion.setFromUnitVectors(UP, _b.sub(_a).normalize());
  return m;
}

function makeWheel(R, tube, rimHex, spokes = 5, disc = true) {
  const g = new THREE.Group();
  const tire = add(g, new THREE.TorusGeometry(R - tube, tube, 8, 22), matte(0x151515));
  tire.rotation.y = Math.PI / 2;
  const rimR = R - tube * 1.7;
  const rim = add(g, new THREE.TorusGeometry(rimR, 0.018, 6, 20), phong(rimHex, 80));
  rim.rotation.y = Math.PI / 2;
  for (let k = 0; k < spokes; k++) {
    const s = box(g, 0.025, rimR * 2, 0.035, 0, 0, 0, phong(rimHex, 80));
    s.rotation.x = (k * Math.PI) / spokes;
  }
  if (disc) {
    const d = add(g, new THREE.CylinderGeometry(R * 0.5, R * 0.5, 0.012, 16), phong(0x9a9a9a, 120), 0.06, 0, 0);
    d.rotation.z = Math.PI / 2;
  }
  return g;
}

function blobShadow() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  gr.addColorStop(0, 'rgba(0,0,0,0.6)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 2.9), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8 }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.03;
  m.renderOrder = 3;
  return m;
}

function baseRig() {
  const root = new THREE.Group(); // 위치 + 요(yaw)
  const pitch = new THREE.Group(); // 경사·노즈다이브
  const lean = new THREE.Group(); // 기울임 (접지점 기준)
  root.add(pitch); pitch.add(lean);
  const shadow = blobShadow();
  root.add(shadow);
  return { root, pitch, lean, shadow };
}

// ---------------------------------------------------------------------------
// 플레이어: 스포츠 바이크 "스톰 400R" + 풀 슈트 라이더
// ---------------------------------------------------------------------------
export function makePlayerBike(up = {}) {
  const rig = baseRig();
  const g = rig.lean;
  const total = (up.engine || 0) + (up.tire || 0) + (up.brake || 0) + (up.susp || 0) + (up.light || 0);
  const race = total >= 18;
  const bodyHex = race ? 0x16181d : total >= 10 ? 0xc81e2a : 0x1f5fd6;
  const accentHex = race ? 0xd9a520 : 0xf2f2f2;
  const body = phong(bodyHex, 90), accent = phong(accentHex, 70), dark = matte(0x1c1d20), metal = phong(0x8d9299, 110), black = phong(0x0e0e10, 30);
  const Rf = 0.305, Rr = 0.315, zf = 0.72, zr = -0.66;
  const tubeR = 0.062 + 0.006 * (up.tire || 0);
  const wf = makeWheel(Rf, 0.055, (up.light || 0) >= 2 ? 0xd9a520 : 0x202226);
  wf.position.set(0, Rf, zf);
  const wr = makeWheel(Rr, tubeR, (up.light || 0) >= 2 ? 0xd9a520 : 0x202226);
  wr.position.set(0, Rr, zr);
  g.add(wf, wr);
  // 프레임·엔진
  box(g, 0.3, 0.3, 0.5, 0, 0.5, 0.04, dark);
  box(g, 0.34, 0.2, 0.62, 0, 0.36, 0.14, body, 0.1); // 언더카울
  box(g, 0.07, 0.07, 0.6, 0, 0.4, -0.36, metal, -0.12); // 스윙암
  // 연료탱크·시트·테일
  ell(g, 0.185, 0.15, 0.3, 0, 0.86, 0.12, body);
  box(g, 0.25, 0.07, 0.34, 0, 0.84, -0.26, black, 0.08);
  box(g, 0.2, 0.12, 0.42, 0, 0.9, -0.6, body, 0.3);
  box(g, 0.12, 0.04, 0.2, 0, 0.99, -0.7, accent, 0.3);
  const tail = box(g, 0.14, 0.045, 0.03, 0, 0.93, -0.83, glow(0x550808));
  // 사이드 카울 + 노즈
  box(g, 0.04, 0.4, 0.66, 0.185, 0.62, 0.3, body, 0, 0.06);
  box(g, 0.04, 0.4, 0.66, -0.185, 0.62, 0.3, body, 0, -0.06);
  box(g, 0.045, 0.1, 0.5, 0.19, 0.74, 0.3, accent, 0, 0.06);
  box(g, 0.045, 0.1, 0.5, -0.19, 0.74, 0.3, accent, 0, -0.06);
  ell(g, 0.2, 0.19, 0.3, 0, 0.9, 0.6, body);
  ell(g, 0.15, 0.13, 0.2, 0, 1.03, 0.56, new THREE.MeshPhongMaterial({ color: 0x0c1016, shininess: 140, transparent: true, opacity: 0.72 }));
  const hl = box(g, 0.2, 0.05, 0.03, 0, 0.87, 0.89, glow(0xfff6d8));
  // 포크·핸들·프런트 펜더
  const forkMat = phong((up.susp || 0) >= 3 ? 0xd9a520 : 0x9aa0a6, 120);
  rod(g, [0.105, Rf, zf], [0.105, 0.95, 0.5], 0.024, forkMat, false);
  rod(g, [-0.105, Rf, zf], [-0.105, 0.95, 0.5], 0.024, forkMat, false);
  rod(g, [0.3, 0.97, 0.44], [0.1, 1.0, 0.5], 0.017, dark, false);
  rod(g, [-0.3, 0.97, 0.44], [-0.1, 1.0, 0.5], 0.017, dark, false);
  ell(g, 0.075, 0.03, 0.2, 0, Rf * 2 + 0.03, zf, body);
  // 배기: 엔진 단계에 따라 달라진다
  const e = up.engine || 0;
  const exMat = e >= 3 ? phong(0x7a8fb8, 140) : phong(0xa9adb3, 120);
  rod(g, [-0.15, 0.36, 0.2], [-0.19, 0.4, -0.3], 0.028, metal, false);
  rod(g, [-0.19, 0.4, -0.3], [-0.22, 0.56 + e * 0.01, -0.78], 0.05 + e * 0.006, exMat, false, 0.04);
  if (e >= 4) rod(g, [0.19, 0.4, -0.3], [0.22, 0.6, -0.78], 0.07, exMat, false, 0.04);
  if (e >= 5) { // 터보 스쿠프
    box(g, 0.1, 0.1, 0.16, 0.24, 0.56, 0.2, phong(0xb9bec6, 140));
    add(g, new THREE.CylinderGeometry(0.06, 0.06, 0.06, 12), phong(0x2b2e33, 60), 0.3, 0.56, 0.2).rotation.z = Math.PI / 2;
  }
  if (race) { // 윙렛
    box(g, 0.16, 0.012, 0.12, 0.27, 0.8, 0.62, black, 0, 0, -0.25);
    box(g, 0.16, 0.012, 0.12, -0.27, 0.8, 0.62, black, 0, 0, 0.25);
  }
  if (up.sticker) box(g, 0.1, 0.1, 0.005, 0, 0.94, -0.84, matte(0xffe14a));
  let underglow = null;
  if (up.led) {
    underglow = box(g, 0.3, 0.02, 1.0, 0, 0.2, 0.05, glow(0x33ddff));
    const gl = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 2.6), new THREE.MeshBasicMaterial({ color: 0x1ec8ff, transparent: true, opacity: 0.28, depthWrite: false, blending: THREE.AdditiveBlending, map: rig.shadow.material.map }));
    gl.rotation.x = -Math.PI / 2; gl.position.y = 0.04; gl.renderOrder = 4;
    rig.root.add(gl);
  }
  // 니트로 불꽃
  const flame = add(g, new THREE.ConeGeometry(0.07, 0.7, 10), new THREE.MeshBasicMaterial({ color: 0x66c8ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), -0.22, 0.58, -1.18);
  flame.rotation.x = -Math.PI / 2 - 0.2;
  flame.visible = false; flame.castShadow = false;

  // --- 라이더 (가죽 슈트 + 풀페이스)
  const rider = new THREE.Group();
  g.add(rider);
  const suit = matte(race ? 0x15161a : 0x20242c), suit2 = matte(bodyHex), helm = phong(race ? 0xd9a520 : 0xf4f4f4, 110), glove = matte(0x111111), boot = matte(0x101010);
  const upper = new THREE.Group();
  upper.position.set(0, 0.93, -0.22);
  rider.add(upper);
  rod(upper, [0, 0.06, 0.02], [0, 0.36, 0.36], 0.16, suit); // 몸통 (앞으로 숙임)
  box(upper, 0.3, 0.2, 0.08, 0, 0.3, 0.2, suit2, -0.75); // 등 보호대 포인트
  ell(upper, 0.1, 0.07, 0.12, 0, 0.43, 0.3, suit2); // 등 험프
  const head = new THREE.Group();
  head.position.set(0, 0.5, 0.5);
  upper.add(head);
  ell(head, 0.135, 0.14, 0.155, 0, 0, 0, helm);
  ell(head, 0.115, 0.06, 0.1, 0, 0.0, 0.085, phong(0x0b0d10, 160)); // 바이저
  rod(upper, [0.2, 0.34, 0.34], [0.3, 0.07, 0.62], 0.055, suit); rod(upper, [-0.2, 0.34, 0.34], [-0.3, 0.07, 0.62], 0.055, suit);
  ell(upper, 0.05, 0.045, 0.06, 0.3, 0.05, 0.65, glove); ell(upper, 0.05, 0.045, 0.06, -0.3, 0.05, 0.65, glove);
  const legL = new THREE.Group(), legR = new THREE.Group();
  legL.position.set(0.11, 0.9, -0.24); legR.position.set(-0.11, 0.9, -0.24);
  rider.add(legL, legR);
  for (const [leg, sx] of [[legL, 1], [legR, -1]]) {
    rod(leg, [0, 0, 0], [sx * 0.1, -0.16, 0.36], 0.082, suit);
    rod(leg, [sx * 0.1, -0.16, 0.36], [sx * 0.08, -0.48, 0.0], 0.062, suit);
    ell(leg, 0.055, 0.045, 0.11, sx * 0.08, -0.5, 0.04, boot);
    ell(leg, 0.06, 0.05, 0.06, sx * 0.13, -0.17, 0.4, suit2); // 니 슬라이더
  }
  return {
    ...rig, wheels: [wf, wr], wheelR: [Rf, Rr], rider, upper, head, legL, legR, tail, headlight: hl, flame, underglow,
    kind: 'player', riderBase: { ux: 0, uy: 0.93 },
  };
}

// ---------------------------------------------------------------------------
// 할배: 씨티백 + 바가지 헬멧 + 조끼 + 고무신
// ---------------------------------------------------------------------------
export function makeGrandpaBike(cargo = 'box') {
  const rig = baseRig();
  const g = rig.lean;
  const red = phong(0xb81f24, 60), cream = phong(0xe9e2cf, 50), dark = matte(0x202124), chrome = phong(0xc4c8cc, 140), black = matte(0x121212), rust = matte(0x6b4a34);
  const R = 0.29, zf = 0.62, zr = -0.58;
  const wf = makeWheel(R, 0.04, 0xb9bdc2, 8, false); wf.position.set(0, R, zf);
  const wr = makeWheel(R, 0.042, 0xb9bdc2, 8, false); wr.position.set(0, R, zr);
  g.add(wf, wr);
  // 언더본 프레임 커버 + 레그실드
  box(g, 0.15, 0.13, 0.72, 0, 0.5, 0.08, red, -0.32);
  box(g, 0.44, 0.52, 0.05, 0, 0.66, 0.36, cream, -0.28);
  box(g, 0.1, 0.5, 0.07, 0.24, 0.66, 0.33, cream, -0.28, 0.5);
  box(g, 0.1, 0.5, 0.07, -0.24, 0.66, 0.33, cream, -0.28, -0.5);
  // 엔진(수평 단기통) + 배기
  box(g, 0.2, 0.16, 0.3, 0, 0.36, 0.1, phong(0x8a8d90, 80));
  rod(g, [-0.1, 0.33, 0.2], [-0.16, 0.3, -0.2], 0.018, chrome, false);
  rod(g, [-0.16, 0.3, -0.2], [-0.19, 0.36, -0.74], 0.04, rust, false);
  // 시트 아래 차체, 긴 시트, 짐받이
  box(g, 0.25, 0.24, 0.62, 0, 0.62, -0.28, red);
  box(g, 0.26, 0.08, 0.64, 0, 0.79, -0.22, black);
  box(g, 0.3, 0.025, 0.36, 0, 0.84, -0.72, chrome);
  rod(g, [0.14, R, zr], [0.14, 0.76, -0.5], 0.016, chrome, false); rod(g, [-0.14, R, zr], [-0.14, 0.76, -0.5], 0.016, chrome, false);
  box(g, 0.16, 0.16, 0.03, 0, 0.6, -0.9, cream); // 번호판
  const tail = box(g, 0.1, 0.06, 0.03, 0, 0.74, -0.9, glow(0x550808));
  ell(g, 0.07, 0.035, 0.26, 0, R * 2 + 0.04, zf, cream); // 앞 펜더
  ell(g, 0.08, 0.04, 0.3, 0, R * 2 + 0.03, zr + 0.05, cream);
  // 포크·핸들·둥근 전조등·백미러
  rod(g, [0.07, R, zf], [0.05, 0.98, 0.42], 0.016, chrome, false); rod(g, [-0.07, R, zf], [-0.05, 0.98, 0.42], 0.016, chrome, false);
  const bar = new THREE.Group(); bar.position.set(0, 1.0, 0.42); g.add(bar);
  box(bar, 0.3, 0.11, 0.14, 0, 0, 0.02, red);
  add(bar, new THREE.CylinderGeometry(0.085, 0.085, 0.05, 16), chrome, 0, 0, 0.1).rotation.x = Math.PI / 2;
  const hl = add(bar, new THREE.CylinderGeometry(0.07, 0.07, 0.02, 16), glow(0xfff0c0), 0, 0, 0.13); hl.rotation.x = Math.PI / 2;
  rod(bar, [0.33, 0.02, -0.03], [-0.33, 0.02, -0.03], 0.014, chrome, false);
  ell(bar, 0.03, 0.03, 0.06, 0.33, 0.02, -0.03, black); ell(bar, 0.03, 0.03, 0.06, -0.33, 0.02, -0.03, black);
  for (const sx of [1, -1]) {
    rod(bar, [sx * 0.2, 0.03, -0.02], [sx * 0.3, 0.26, -0.04], 0.007, chrome, false);
    const mr = add(bar, new THREE.CylinderGeometry(0.055, 0.055, 0.012, 14), chrome, sx * 0.3, 0.28, -0.04); mr.rotation.x = Math.PI / 2;
  }
  // 센터 스탠드 (코너에서 긁히는 그것)
  box(g, 0.3, 0.02, 0.04, 0, 0.16, -0.12, chrome);

  // 짐
  const cargoG = new THREE.Group(); cargoG.position.set(0, 0.86, -0.72); g.add(cargoG);
  const steelBox = (y) => { box(cargoG, 0.3, 0.34, 0.2, 0, y + 0.17, 0, phong(0xc9ccd1, 150)); box(cargoG, 0.12, 0.02, 0.04, 0, y + 0.36, 0, chrome); };
  const riceBag = (y) => { const m = ell(cargoG, 0.2, 0.1, 0.3, 0, y + 0.1, 0, matte(0xe8dfc4)); m.rotation.y = 0.2; box(cargoG, 0.2, 0.005, 0.12, 0, y + 0.2, 0, matte(0xc0271f)); };
  const eggs = (y, n) => { for (let k = 0; k < n; k++) box(cargoG, 0.3, 0.035, 0.3, 0, y + 0.02 + k * 0.04, 0, matte(k % 2 ? 0xb9a37a : 0xc9b48a), 0, (k % 3) * 0.05); };
  const gas = (y) => { const c = add(cargoG, new THREE.CylinderGeometry(0.13, 0.13, 0.46, 14), phong(0x9aa3a8, 70), 0, y + 0.23, 0); ell(cargoG, 0.13, 0.07, 0.13, 0, y + 0.46, 0, phong(0x9aa3a8, 70)); box(cargoG, 0.08, 0.06, 0.08, 0, y + 0.54, 0, matte(0xd9a520)); return c; };
  if (cargo === 'box') steelBox(0);
  else if (cargo === 'rice') riceBag(0);
  else if (cargo === 'eggs') eggs(0, 9);
  else if (cargo === 'gas') gas(0);
  else if (cargo === 'tower') { riceBag(0); steelBox(0.2); eggs(0.57, 7); }

  // --- 할배
  const rider = new THREE.Group(); g.add(rider);
  const skin = matte(0xd9a47a), vest = matte(0x6a2d4f), shirt = matte(0xd8cdb4), pants = matte(0x39404a), shoe = matte(0xf2f2ee), helmet = phong(0xf4f1e6, 60);
  const upper = new THREE.Group(); upper.position.set(0, 0.84, -0.14); rider.add(upper);
  rod(upper, [0, 0.08, 0], [0, 0.46, 0.09], 0.155, vest);
  ell(upper, 0.17, 0.12, 0.15, 0, 0.07, 0, pants);
  const head = new THREE.Group(); head.position.set(0, 0.69, 0.14); upper.add(head);
  ell(head, 0.105, 0.115, 0.108, 0, 0, 0, skin);
  const hm = add(head, new THREE.SphereGeometry(0.125, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), helmet, 0, 0.012, -0.005);
  box(head, 0.2, 0.012, 0.07, 0, 0.02, 0.13, helmet, 0.25); // 챙
  box(head, 0.012, 0.13, 0.012, 0.1, -0.06, 0.03, black); box(head, 0.012, 0.13, 0.012, -0.1, -0.06, 0.03, black); // 턱끈
  ell(head, 0.018, 0.018, 0.012, 0.04, 0.0, 0.103, black); ell(head, 0.018, 0.018, 0.012, -0.04, 0.0, 0.103, black); // 눈
  box(head, 0.07, 0.012, 0.01, 0, -0.045, 0.1, matte(0xf2f2f2)); // 흰 수염
  ell(head, 0.02, 0.016, 0.02, 0, -0.012, 0.11, skin);
  // 팔: 어깨 피벗 (손 흔들기용)
  const armL = new THREE.Group(), armR = new THREE.Group();
  armL.position.set(0.19, 0.44, 0.07); armR.position.set(-0.19, 0.44, 0.07);
  upper.add(armL, armR);
  for (const [arm, sx] of [[armL, 1], [armR, -1]]) {
    rod(arm, [0, 0, 0], [sx * 0.12, -0.27, 0.5], 0.05, shirt);
    ell(arm, 0.045, 0.04, 0.05, sx * 0.13, -0.28, 0.53, skin);
  }
  const legL = new THREE.Group(), legR = new THREE.Group();
  legL.position.set(0.12, 0.84, -0.12); legR.position.set(-0.12, 0.84, -0.12);
  rider.add(legL, legR);
  for (const [leg, sx] of [[legL, 1], [legR, -1]]) {
    rod(leg, [0, 0, 0], [sx * 0.05, -0.1, 0.36], 0.085, pants);
    rod(leg, [sx * 0.05, -0.1, 0.36], [sx * 0.07, -0.5, 0.3], 0.065, pants);
    ell(leg, 0.05, 0.035, 0.11, sx * 0.07, -0.54, 0.34, shoe); // 고무신
  }
  return {
    ...rig, wheels: [wf, wr], wheelR: [R, R], rider, upper, head, legL, legR, armL, armR, tail, headlight: hl, cargo: cargoG, bar,
    kind: 'grandpa',
  };
}

const _q = new THREE.Quaternion();
/**
 * 모델 자세 갱신.
 * st: { x, y, z, yaw, slope, lean, v, brake(0..1), accel(-1..1), dt, time }
 */
export function poseBike(m, st) {
  m.root.position.set(st.x, st.y, st.z);
  m.root.rotation.y = st.yaw;
  const dive = clamp((st.brake || 0) * 0.05 - (st.accel || 0) * 0.025, -0.05, 0.06);
  m.pitch.rotation.x = lerp(m.pitch.rotation.x, -(st.slope || 0) + dive, 0.3);
  m.lean.rotation.z = -st.lean;
  const spin = (st.v * st.dt) / m.wheelR[0];
  m.wheels[0].rotation.x += spin; m.wheels[1].rotation.x += spin;
  m.shadow.material.opacity = st.night ? 0.25 : 0.9;
  if (m.tail) m.tail.material.color.setHex(st.brake > 0.05 ? 0xff2a1a : 0x550808);
  const L = st.lean, aL = Math.abs(L);
  if (m.kind === 'player') {
    // 행오프: 몸을 코너 안쪽으로 빼고 안쪽 무릎을 내민다
    const off = clamp(L * 0.42, -0.24, 0.24);
    m.upper.position.x = lerp(m.upper.position.x, off, 0.25);
    m.upper.rotation.z = lerp(m.upper.rotation.z, L * 0.22, 0.25);
    m.upper.rotation.x = lerp(m.upper.rotation.x, st.v > 38 && aL < 0.2 ? 0.2 : 0, 0.1); // 직선에서 엎드림
    m.head.rotation.z = -L * 0.45; // 시선은 수평 유지
    m.head.rotation.y = clamp(L * 0.5, -0.5, 0.5);
    m.legL.rotation.y = lerp(m.legL.rotation.y, L > 0.25 ? clamp((L - 0.25) * 2.2, 0, 0.9) : 0, 0.25);
    m.legR.rotation.y = lerp(m.legR.rotation.y, L < -0.25 ? -clamp((-L - 0.25) * 2.2, 0, 0.9) : 0, 0.25);
    m.legL.position.x = 0.11 + off * 0.5; m.legR.position.x = -0.11 + off * 0.5;
    if (m.flame) {
      m.flame.visible = !!st.boost;
      if (st.boost) m.flame.scale.set(1 + Math.random() * 0.4, 0.8 + Math.random() * 0.6, 1 + Math.random() * 0.4);
    }
    if (m.underglow) m.underglow.material.color.setHSL((st.time * 0.15) % 1, 1, 0.55);
  } else {
    // 할배: 꼿꼿하게 앉아 발을 내밀고 돈다. 엔진 진동으로 달달 떤다.
    const g = st.gag || 'ride';
    m.lean.position.y = Math.sin(st.time * 55) * 0.004 * (st.v < 3 ? 2.5 : 1);
    m.upper.rotation.z = lerp(m.upper.rotation.z, L * 0.5, 0.2); // 린 아웃 (몸은 세운다)
    const tuck = g === 'tuck' ? 1 : 0;
    m.upper.rotation.x = lerp(m.upper.rotation.x, tuck * 0.95, 0.08);
    m.head.rotation.x = lerp(m.head.rotation.x, -tuck * 0.7, 0.08);
    m.head.rotation.z = -L * 0.5;
    const look = g === 'look' || g === 'wave' ? 2.4 : 0;
    m.head.rotation.y = lerp(m.head.rotation.y, look, 0.12);
    // 왼팔: 손 흔들기 / 전화 받기
    const wave = g === 'wave' ? 1 : 0, phone = g === 'phone' ? 1 : 0;
    m.armL.rotation.x = lerp(m.armL.rotation.x, wave * -2.4 + phone * -1.5, 0.15);
    m.armL.rotation.z = lerp(m.armL.rotation.z, wave * (0.3 + Math.sin(st.time * 9) * 0.35) + phone * -0.9, 0.2);
    // 안쪽 발 내밀기
    m.legL.rotation.z = lerp(m.legL.rotation.z, L > 0.3 ? clamp((L - 0.3) * 1.3, 0, 0.75) : 0, 0.2);
    m.legR.rotation.z = lerp(m.legR.rotation.z, L < -0.3 ? -clamp((-L - 0.3) * 1.3, 0, 0.75) : 0, 0.2);
    if (m.cargo) m.cargo.rotation.z = Math.sin(st.time * 6.3) * 0.02 + L * 0.06;
    if (g === 'kick') { m.legR.rotation.x = -Math.abs(Math.sin(st.time * 7)) * 0.9; m.lean.position.y += Math.abs(Math.sin(st.time * 7)) * 0.02; } else m.legR.rotation.x = lerp(m.legR.rotation.x, 0, 0.2);
  }
}

/** 넘어졌을 때: 바이크가 미끄러지며 구른다 */
export function poseCrash(m, t) {
  m.lean.rotation.z = -Math.sign(m.lean.rotation.z || 1) * Math.min(1.45, 0.3 + t * 3.2);
  m.upper.rotation.x = Math.sin(t * 9) * 0.5;
  m.root.rotation.y += 0.02 * Math.max(0, 1.2 - t);
}
