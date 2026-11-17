// 게임 설정: 스테이지(실제 도로 구간), 바이크·개조, 할배, 날씨. 할배의 핸디캡과 대사는 src/talk.js.

export const GAME_TITLE = '대관령 다운힐';
export const GAME_SUB = '씨티백 레전드';

/**
 * 스테이지 = 실제 코스(대관령 표지석 → 성산, 12.5 km)의 한 구간.
 * 굽이가 완만한 구간부터 심한 구간 순으로 레벨을 매겼다 (수치는 실제 선형에서 계산).
 * s0, s1: 코스 시작점부터의 거리(m). ref: 이 레벨에서 기대하는 개조 단계(평균).
 * handicap: 할배가 그 판에 스스로 거는 핸디캡 (연출과 대사는 src/talk.js, 모델은 src/px/vox.js).
 */
export const STAGES = [
  { id: 1, name: '성산 가는 길', place: '어흘리 → 성산', s0: 10620, s1: 12440, weather: 'day', ref: 0.0, k: 1.20, pass: 4.0, handicap: 'coffee' },
  { id: 2, name: '박물관 앞 내리막', place: '가마골 아래 → 대관령박물관', s0: 9330, s1: 10560, weather: 'day', ref: 0.6, k: 1.195, pass: 3.5, handicap: 'boxes2' },
  { id: 3, name: '가마골 굽이', place: '가마골', s0: 8150, s1: 9300, weather: 'autumn', ref: 1.2, k: 1.175, pass: 3.2, handicap: 'eggtower' },
  { id: 4, name: '정상 표지석 출발', place: '대관령 정상 → 신사임당 사친시비', s0: 30, s1: 1700, weather: 'day', ref: 1.8, k: 1.15, pass: 3.0, handicap: 'backward' },
  { id: 5, name: '옛길 중턱', place: '해발 600 → 500 m', s0: 3280, s1: 4520, weather: 'sunset', ref: 2.4, k: 1.165, pass: 2.8, handicap: 'feet', obstacles: 'rocks' },
  { id: 6, name: '안개 낀 굽잇길', place: '해발 500 → 430 m', s0: 4540, s1: 5700, weather: 'fog', ref: 3.0, k: 1.16, pass: 2.6, handicap: 'blind', obstacles: 'deer' },
  { id: 7, name: '밤의 대관령', place: '해발 330 → 250 m', s0: 6980, s1: 8130, weather: 'night', ref: 3.6, k: 1.135, pass: 2.4, handicap: 'dog', obstacles: 'tractor' },
  { id: 8, name: '대관령1교 연속 굽이', place: '대관령1교 → 해발 330 m', s0: 5700, s1: 6960, weather: 'rain', ref: 4.2, k: 1.17, pass: 2.2, handicap: 'umbrella', obstacles: 'rocks' },
  { id: 9, name: '아흔아홉 굽이의 심장', place: '해발 720 → 600 m', s0: 1740, s1: 3260, weather: 'autumn', ref: 4.7, k: 1.15, pass: 2.0, handicap: 'nap', obstacles: 'mixed' },
  { id: 10, name: '풀코스 결전', place: '대관령 정상 → 성산 12.5 km', s0: 30, s1: 12440, weather: 'sunset', ref: 5.0, k: 1.11, pass: 6.0, handicap: 'medley', obstacles: 'mixed', boss: true },
];

// ---------------------------------------------------------------------------
// 플레이어 바이크: 처음부터 꽤 좋은 바이크(스톰 400R). 개조할수록 괴물이 된다.
// ---------------------------------------------------------------------------
export const BIKE_BASE = {
  name: '스톰 400R',
  mu: 1.0, // 타이어 접지 (최대 기울기 = atan(mu))
  vTop: 46, // m/s (166 km/h)
  a0: 6.5, // 저속 최대 가속 m/s²
  pw: 190, // 출력/질량 W/kg
  brake: 8.5, // 최대 제동 m/s²
  leanRate: 2.1, // 기울임 속도 rad/s
};

export const UPGRADES = [
  { key: 'engine', name: '엔진', desc: '가속과 최고속', max: 5,
    steps: ['순정', '흡기 튜닝', '풀배기 머플러', 'ECU 맵핑', '보어업', '터보 (미쳤소?)'],
    cost: [0, 60000, 140000, 300000, 560000, 980000] },
  { key: 'tire', name: '타이어', desc: '코너 접지력 · 최대 기울기', max: 5,
    steps: ['순정', '스포츠 타이어', '하이그립', '세미 슬릭', '레이싱 슬릭', '월드GP 스펙'],
    cost: [0, 70000, 160000, 330000, 600000, 1050000] },
  { key: 'brake', name: '브레이크', desc: '제동력 — 늦게 잡을수록 빠르다', max: 5,
    steps: ['순정', '메쉬 호스', '레이싱 패드', '대구경 디스크', '4P 캘리퍼', '카본 디스크'],
    cost: [0, 45000, 110000, 240000, 450000, 800000] },
  { key: 'susp', name: '서스펜션', desc: '기울이는 속도 · 연속 코너 대응', max: 5,
    steps: ['순정', '프리로드 조절', '강화 스프링', '카트리지 킷', '풀 어저스터블', '전자제어 서스'],
    cost: [0, 50000, 120000, 260000, 480000, 850000] },
  { key: 'light', name: '경량화', desc: '가속 · 민첩성', max: 5,
    steps: ['순정', '순정 부품 다이어트', '알루미늄 휠', '티타늄 볼트', '카본 카울', '마그네슘 휠'],
    cost: [0, 55000, 130000, 280000, 520000, 900000] },
  { key: 'nitro', name: '니트로', desc: '직선에서 한 방 (횟수)', max: 3,
    steps: ['없음', '1회', '2회', '3회'],
    cost: [0, 90000, 260000, 620000] },
  { key: 'led', name: 'LED 언더글로우', desc: '성능 +0 · 간지 +100', max: 1,
    steps: ['없음', '장착'], cost: [0, 150000], gag: true },
  { key: 'sticker', name: '"할배 조심" 스티커', desc: '성능 +0 · 할배가 한마디 한다', max: 1,
    steps: ['없음', '부착'], cost: [0, 9900], gag: true },
];

export function bikeParams(up) {
  const e = up.engine || 0, t = up.tire || 0, b = up.brake || 0, s = up.susp || 0, l = up.light || 0;
  return {
    mu: BIKE_BASE.mu + 0.07 * t,
    vTop: BIKE_BASE.vTop + 4 * e,
    a0: BIKE_BASE.a0 + 0.45 * e + 0.2 * l,
    pw: BIKE_BASE.pw * (1 + 0.14 * e) * (1 + 0.04 * l),
    brake: BIKE_BASE.brake + 0.9 * b,
    leanRate: BIKE_BASE.leanRate + 0.22 * s + 0.07 * l,
    nitro: up.nitro || 0,
  };
}
/** 레벨 기준 바이크: 다섯 가지 성능 개조를 모두 ref 단계로 올렸다고 본다 (소수 단계는 보간). */
export function refParams(ref) {
  return bikeParams({ engine: ref, tire: ref, brake: ref, susp: ref, light: ref });
}
export function bikeTitle(up) {
  const sum = (up.engine || 0) + (up.tire || 0) + (up.brake || 0) + (up.susp || 0) + (up.light || 0);
  if (sum >= 25) return '스톰 400R "대관령 스페셜" (풀튠)';
  if (sum >= 18) return '스톰 400R 레이스 스펙';
  if (sum >= 10) return '스톰 400R 스테이지 2';
  if (sum >= 4) return '스톰 400R 스테이지 1';
  return '스톰 400R (순정)';
}
export function horsepower(up) {
  const p = bikeParams(up);
  return Math.round((p.pw * 255) / 735.5); // 차체+라이더 255 kg 가정
}
export function totalSpent(up) {
  let s = 0;
  for (const u of UPGRADES) for (let i = 1; i <= (up[u.key] || 0); i++) s += u.cost[i];
  return s;
}
export const BIKE_PRICE = 8900000; // 순정 차량 가격 (농담용 누적 금액 표시)

// ---------------------------------------------------------------------------
// 할배: 씨티백 (97cc, 8마력). 개조 내역 없음. 코너링 포스 측정 불가.
// ---------------------------------------------------------------------------
export const GRANDPA = {
  name: '황 영감',
  bike: '씨티백',
  // 물리 한계 (속도 프로파일 계산용; 실제 페이스는 레벨별 목표 시간에 맞춰 보정된다)
  params: { mu: 1.75, vTop: 31, a0: 3.8, pw: 62, brake: 8.5 },
  kickDelay: 1.6, // 출발 때 킥스타터 밟는 시간 (초)
  waitGap: 42, // 이만큼 앞서면 기다려 준다 (m)
  waitResume: 20,
  waitFactor: 0.84, // 기다릴 때 페이스 배율 (딴짓)
  wakeFactor: 1.075, // 따라붙을 때 페이스 배율 (핸디캡을 하나 푼다)
  freeZone: 0.84, // 진행률이 이 값을 넘으면 봐주기/따라붙기 없이 실력대로
};

// ---------------------------------------------------------------------------
// 날씨·시간대
// ---------------------------------------------------------------------------
export const WEATHERS = {
  day: { label: '맑은 낮', season: 'summer', grip: 1 },
  autumn: { label: '단풍 든 오후', season: 'autumn', grip: 1 },
  sunset: { label: '해 질 녘', season: 'autumn', grip: 1 },
  fog: { label: '짙은 안개', season: 'summer', grip: 0.96 },
  night: { label: '한밤중', season: 'summer', grip: 1 },
  rain: { label: '비 오는 날', season: 'summer', grip: 0.86 },
};

export const TIPS = [
  '코너 앞에서 미리 감속하고, 들어가서는 브레이크를 놓으세요.',
  '브레이크를 잡은 채로는 바이크가 덜 눕습니다.',
  '좌우 키는 화면 기준이 아니라 바이크 기준입니다. 왼쪽 키 = 바이크의 왼쪽.',
  '할배 뒤에 바짝 붙으면 공기저항이 줄어 직선에서 따라붙기 쉽습니다.',
  '가드레일에 살짝 스치면 속도만 잃지만, 세게 박으면 넘어집니다.',
  '타이어 개조는 코너 속도를, 엔진 개조는 직선 속도를 올려 줍니다.',
  '노란 화살표 노면 표시가 보이면 곧 급코너입니다.',
  '할배는 앞서면 딴짓을 하고, 뒤처지면 핸디캡을 하나 풉니다. 승부는 마지막 구간에서 납니다.',
  '넘어지거나 추월당하면 멘탈 하트가 깨집니다. 남은 하트만큼 상금이 붙습니다.',
];

export const STORAGE_KEY = 'dgr_downhill_save_v1';
