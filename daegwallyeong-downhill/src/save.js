// 진행 상황 저장 (localStorage). 저장이 막힌 환경에서도 게임은 돌아가야 한다.
import { STORAGE_KEY } from './config.js';

const DEFAULT = () => ({
  v: 1, money: 0, up: {}, stages: {},
  settings: { assist: 0.5, diff: 0, quality: 'auto', sound: 1, gkey: '', sat: 1 },
});

export function loadSave() {
  const d = DEFAULT();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && s.v === 1) { Object.assign(d, s); d.settings = { ...DEFAULT().settings, ...(s.settings || {}) }; }
    }
  } catch (e) { /* 저장소 사용 불가 */ }
  return d;
}
export function writeSave(s) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch (e) { /* 무시 */ }
}
export function resetSave(s) {
  const keep = s.settings;
  const d = DEFAULT();
  d.settings = keep;
  Object.keys(s).forEach((k) => delete s[k]);
  Object.assign(s, d);
  writeSave(s);
}
export function stageUnlocked(save, id) {
  if (id === 1) return true;
  const prev = save.stages[id - 1];
  return !!(prev && prev.stars >= 2);
}
export const won = (n) => '₩' + Math.round(n).toLocaleString('ko-KR');
