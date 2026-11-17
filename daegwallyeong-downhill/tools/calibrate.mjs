// 레벨별 할배 페이스(k) 보정: "기준 바이크를 탄 봇이 목표 숙련도일 때 정확히 비기도록" k를 이분법으로 찾는다.
// 사용: node tools/calibrate.mjs   → config.js의 STAGES[].k 에 반영할 값을 출력
import { STAGES } from '../src/config.js';
import { runStage } from './sim.mjs';

const target = { 1: 0.875, 2: 0.88, 3: 0.885, 4: 0.89, 5: 0.895, 6: 0.9, 7: 0.905, 8: 0.91, 9: 0.915, 10: 0.9 };
for (const st of STAGES) {
  let lo = 1.0, hi = 1.5;
  for (let it = 0; it < 14; it++) {
    const k = (lo + hi) / 2, r = runStage({ ...st, k }, target[st.id], st.ref);
    if (r.time - r.gTime > 0) lo = k; else hi = k; // 봇이 지면 할배를 더 느리게
  }
  const k = Math.round(((lo + hi) / 2) * 200) / 200;
  const chk = [0.82, 0.86, 0.9, 0.94].map((s) => { const r = runStage({ ...st, k }, s, st.ref); return `${s}:${(r.time - r.gTime >= 0 ? '+' : '') + (r.time - r.gTime).toFixed(1)}`; });
  console.log(`stage ${String(st.id).padStart(2)} target ${target[st.id]}  k = ${k.toFixed(3)}   ${chk.join('  ')}`);
}
