import { loadWorldData } from './lib/node_data.mjs';
import { DS, computeRacingLine, solveSpeed } from '../src/track.js';
const t0 = Date.now();
const { track } = loadWorldData();
console.log('build ms', Date.now() - t0, JSON.stringify(track.stats));
let minR = 1e9, at = 0; const tight = [];
for (let i = 0; i < track.n; i++) { const r = 1 / Math.max(1e-6, Math.abs(track.K[i])); if (r < minR) { minR = r; at = i; } }
console.log('min radius', minR.toFixed(1), 'at s', at * DS);
// 코너 목록: |K| > 1/60 인 연속 구간
let cur = null; const corners = [];
for (let i = 0; i < track.n; i++) {
  const k = track.K[i];
  if (Math.abs(k) > 1 / 60) { if (!cur || Math.sign(k) !== cur.sg) { if (cur) corners.push(cur); cur = { s0: i * DS, sg: Math.sign(k), kmax: 0, turn: 0 }; } cur.s1 = i * DS; cur.kmax = Math.max(cur.kmax, Math.abs(k)); cur.turn += Math.abs(k) * DS; }
  else if (cur) { corners.push(cur); cur = null; }
}
console.log('corners(R<60):', corners.length, ' hairpins(turn>120deg):', corners.filter(c => c.turn > 2.09).length, ' R<25:', corners.filter(c => 1 / c.kmax < 25).length, ' R<15:', corners.filter(c => 1 / c.kmax < 15).length);
const bins = 250;
for (let s = 0; s < track.length; s += bins) {
  let turn = 0, kmax = 0, n = 0, g = 0;
  for (let i = Math.floor(s / DS); i < Math.min(track.n, Math.floor((s + bins) / DS)); i++) { turn += Math.abs(track.K[i]) * DS; kmax = Math.max(kmax, Math.abs(track.K[i])); g += track.G[i]; n++; }
  const bar = '#'.repeat(Math.round(turn * 57.3 / 12));
  console.log(String(s).padStart(6), 'turn', (turn * 57.3).toFixed(0).padStart(4), 'Rmin', (1 / kmax).toFixed(0).padStart(4), 'grade', (g / n * 100).toFixed(1).padStart(6), 'y', track.Y[Math.floor(s / DS)].toFixed(0).padStart(4), bar);
}
const t1 = Date.now();
const line = computeRacingLine(track, 0, track.n - 1);
console.log('line ms', Date.now() - t1);
const bikes = {
  stock: { mu: 1.0, vTop: 46, a0: 6.5, pw: 190, brake: 8.5 },
  mid: { mu: 1.17, vTop: 56, a0: 7.8, pw: 260, brake: 10.7 },
  max: { mu: 1.35, vTop: 66, a0: 9.2, pw: 340, brake: 13 },
  grandpa: { mu: 1.6, vTop: 30, a0: 3.6, pw: 60, brake: 8 },
};
for (const [k, p] of Object.entries(bikes)) {
  const r = solveSpeed(track, line, p);
  let vmax = 0; for (const v of r.V) vmax = Math.max(vmax, v);
  const per = [];
  for (let s = 0; s < track.length; s += 1250) { const a = Math.floor(s / DS), b = Math.min(track.n - 1, Math.floor((s + 1250) / DS)); per.push((r.T[b] - r.T[a]).toFixed(1)); }
  console.log(k.padEnd(8), 'time', r.time.toFixed(1), 'avg km/h', (track.length / r.time * 3.6).toFixed(1), 'vmax', (vmax * 3.6).toFixed(0), 'per1.25km', per.join(' '));
}
