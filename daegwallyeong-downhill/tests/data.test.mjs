// 브라우저 없이 도는 검증: 실제 코스 원본 일치, 도로 재구성 편차, 물리 시뮬레이션 안정성.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadWorldData } from '../tools/lib/node_data.mjs';
import { STAGES } from '../src/config.js';
import { runStage } from '../tools/sim.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const check = (name, cond, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); if (!cond) process.exitCode = 1; };

const course = JSON.parse(fs.readFileSync(path.join(root, 'data/course.json'), 'utf8'));
const pts = course.points;
check('원본 좌표 507개', pts.length === 507, String(pts.length));
const sha = crypto.createHash('sha256').update(JSON.stringify(pts)).digest('hex');
check('좌표 배열 SHA-256이 기획안 기록과 일치', sha === '18f412f8eed09f44dc46800b8a0544ce54bef7cea332832b1465ca1e4f6575b4', sha.slice(0, 16) + '…');
const hav = (a, b) => { const R = 6371008.8, r = Math.PI / 180, dla = (b[1] - a[1]) * r, dlo = (b[0] - a[0]) * r, h = Math.sin(dla / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dlo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
let len = 0; for (let i = 1; i < pts.length; i++) len += hav(pts[i - 1], pts[i]);
check('중심선 수평 길이 12,511.246 m', Math.abs(len - 12511.246) < 0.01, len.toFixed(3));
check('출발점', pts[0][0] === 128.7602135 && pts[0][1] === 37.6871337);
check('도착점', pts[506][0] === 128.8250148 && pts[506][1] === 37.7154738);

const { track } = loadWorldData();
const s = track.stats;
check('게임 중심선이 원본 폴리라인에서 평균 0.3 m 이내', s.meanDeviation < 0.3, `평균 ${s.meanDeviation.toFixed(2)} m, 최대 ${s.maxDeviation.toFixed(2)} m`);
check('게임 중심선 최대 편차 2.5 m 이내', s.maxDeviation < 2.5, `${s.maxDeviation.toFixed(2)} m`);
check('게임 중심선 길이가 원본과 0.1% 이내', Math.abs(s.length - len) / len < 0.001, `${s.length} m`);
check('고도: 출발 ~843 m, 도착 ~72 m', Math.abs(s.elevStart - 843) < 5 && Math.abs(s.elevEnd - 72) < 5, `${s.elevStart.toFixed(0)} → ${s.elevEnd.toFixed(0)} m`);
check('최대 종단 경사 14% 이하', s.maxGrade < 0.14, `${(s.maxGrade * 100).toFixed(1)}%`);
for (const st of STAGES) if (!(st.s0 >= 0 && st.s1 <= track.length && st.s1 > st.s0)) check(`스테이지 ${st.id} 범위`, false);
check('스테이지 10개가 코스 범위 안', true);

// 봇 주행: NaN 없이 완주하고, 숙련도에 따라 결과가 갈리는지
for (const id of [1, 5, 9]) {
  const st = STAGES[id - 1];
  const slow = runStage(st, 0.8, st.ref), fast = runStage(st, 0.97, st.ref + 1);
  check(`레벨 ${id}: 느린 봇은 진다`, slow.time > slow.gTime, `${(slow.time - slow.gTime).toFixed(2)}초 뒤`);
  check(`레벨 ${id}: 빠른 봇(개조 +1)은 이긴다`, fast.time < fast.gTime, `${(fast.gTime - fast.time).toFixed(2)}초 앞`);
  check(`레벨 ${id}: 봇이 넘어지지 않는다`, slow.crashes === 0 && fast.crashes === 0);
}
