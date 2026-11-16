// 헤드리스 밸런스 시뮬레이션: 봇(사람 흉내)이 실제 게임 물리로 각 스테이지를 달려 할배와 겨룬다.
// 사용: node tools/sim.mjs [skill ...]
import { loadWorldData } from './lib/node_data.mjs';
import { DS } from '../src/track.js';
import { STAGES, WEATHERS, bikeParams, refParams, GRANDPA } from '../src/config.js';
import { PlayerBike } from '../src/physics.js';
import { Grandpa, stageReference } from '../src/rival.js';
import { Bot } from '../src/bot.js';

const { track } = loadWorldData();
const skills = process.argv.slice(2).map(Number).filter((x) => x > 0);
if (!skills.length) skills.push(0.86, 0.9, 0.94, 0.98);
const only = process.env.STAGE ? Number(process.env.STAGE) : 0;
const upOffset = Number(process.env.UP || 0);

export function runStage(st, skill, upLevel, verbose = false) {
  const stage = { ...st, i0: Math.round(st.s0 / DS), i1: Math.round(st.s1 / DS) };
  const grip = WEATHERS[st.weather].grip;
  const ref = stageReference(track, stage, grip);
  const params = refParams(Math.max(0, Math.min(5, upLevel)));
  const bike = new PlayerBike(track, params, { assist: 0.5 });
  bike.place(stage.s0 - 6, -1.6);
  const gp = new Grandpa(track, stage, ref);
  const bot = new Bot(track, ref, params, { skill, grip });
  const dt = 1 / 120, inp = {};
  const kb = process.env.KB === '1'; let kSteer = 0; // 키보드처럼 좌/우 누름만 가능한 조작
  let t = 0, finish = 0, lead = 0, minGap = 1e9, maxGap = -1e9;
  while (t < 900) {
    bot.control(bike, inp);
    if (kb) {
      const tgt = inp.steer > kSteer + 0.12 ? 1 : inp.steer < kSteer - 0.12 ? -1 : 0;
      const rate = tgt === 0 ? 5.5 : Math.sign(tgt) !== Math.sign(kSteer) && kSteer !== 0 ? 9 : 3.6;
      kSteer += Math.max(-rate * dt, Math.min(rate * dt, tgt - kSteer));
      inp.steer = kSteer; inp.brake = inp.brake > 0 ? 1 : 0;
    }
    bike.update(dt, inp, { grip, draft: 0, locked: false });
    bike.events.length = 0;
    gp.update(dt, t, bike, null);
    gp.events.length = 0;
    t += dt;
    const gap = gp.s - bike.s;
    if (gap < 0) lead += dt;
    minGap = Math.min(minGap, gap); maxGap = Math.max(maxGap, gap);
    if (!finish && bike.s >= stage.s1) { finish = t; bike.finished = true; }
    if (finish && gp.finished) break;
    if (!Number.isFinite(bike.s + bike.d + bike.v)) throw new Error('NaN in physics');
  }
  return { time: finish, gTime: gp.finishTime, tRef: ref.tRef, target: gp.target, pace: gp.pace, crashes: bike.stats.crashes, scrapes: bike.stats.scrapes, top: bike.stats.topSpeed * 3.6, lead, minGap, maxGap };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('stage      len   tRef  할배목표 pace | skill: 기록(차이) 사고/스침');
  for (const st of STAGES) {
    if (only && st.id !== only) continue;
    const rows = [];
    let info = null;
    for (const sk of skills) {
      const r = runStage(st, sk, st.ref + upOffset);
      info = r;
      rows.push(`${sk}: ${r.time.toFixed(1)}(${(r.time - r.gTime >= 0 ? '+' : '') + (r.time - r.gTime).toFixed(1)}) ${r.crashes}/${r.scrapes}`);
    }
    console.log(`${String(st.id).padStart(2)} ${st.name.padEnd(10).slice(0, 10)} ${String(st.s1 - st.s0).padStart(5)} ${info.tRef.toFixed(1).padStart(6)} ${info.target.toFixed(1).padStart(6)} ${info.pace.toFixed(2)} | ${rows.join(' | ')}`);
  }
}
