// 게임 설정: 스테이지(실제 도로 구간), 바이크·개조, 할배, 날씨, 대사.

export const GAME_TITLE = '대관령 다운힐';
export const GAME_SUB = '씨티백 레전드';

/**
 * 스테이지 = 실제 코스(대관령 표지석 → 성산, 12.5 km)의 한 구간.
 * 굽이가 완만한 구간부터 심한 구간 순으로 레벨을 매겼다 (수치는 실제 선형에서 계산).
 * s0, s1: 코스 시작점부터의 거리(m). ref: 이 레벨에서 기대하는 개조 단계(평균).
 */
export const STAGES = [
  { id: 1, name: '성산 가는 길', place: '어흘리 → 성산', s0: 10620, s1: 12440, weather: 'day', ref: 0.0, k: 1.20, pass: 4.0,
    cargo: 'none', intro: '동네 마실길이래요. 살살 따라오우야.' },
  { id: 2, name: '박물관 앞 내리막', place: '가마골 아래 → 대관령박물관', s0: 9330, s1: 10560, weather: 'day', ref: 0.6, k: 1.195, pass: 3.5,
    cargo: 'box', intro: '철가방 식기 전에 내려가야 되잖소.' },
  { id: 3, name: '가마골 굽이', place: '가마골', s0: 8150, s1: 9300, weather: 'autumn', ref: 1.2, k: 1.175, pass: 3.2,
    cargo: 'rice', intro: '쌀 한 포대 싣고 가는 길이래요. 20키로밖에 안 되우.' },
  { id: 4, name: '정상 표지석 출발', place: '대관령 정상 → 신사임당 사친시비', s0: 30, s1: 1700, weather: 'day', ref: 1.8, k: 1.145, pass: 3.0,
    cargo: 'box', intro: '여가 대관령 꼭대기래요. 바람이 마카 날려 보내우야.' },
  { id: 5, name: '옛길 중턱', place: '해발 600 → 500 m', s0: 3280, s1: 4520, weather: 'sunset', ref: 2.4, k: 1.16, pass: 2.8,
    cargo: 'eggs', intro: '계란 서른 판이래요. 한 알도 안 깨지우.', obstacles: 'rocks' },
  { id: 6, name: '안개 낀 굽잇길', place: '해발 500 → 430 m', s0: 4540, s1: 5700, weather: 'fog', ref: 3.0, k: 1.16, pass: 2.6,
    cargo: 'rice', intro: '안개? 나는 눈 감고도 댕기는 길이래요.', obstacles: 'deer' },
  { id: 7, name: '밤의 대관령', place: '해발 330 → 250 m', s0: 6980, s1: 8130, weather: 'night', ref: 3.6, k: 1.135, pass: 2.4,
    cargo: 'gas', intro: '가스통은 흔들면 안 되잖소. 그래서 안 흔들리게 달리우.', obstacles: 'tractor' },
  { id: 8, name: '대관령1교 연속 굽이', place: '대관령1교 → 해발 330 m', s0: 5700, s1: 6960, weather: 'rain', ref: 4.2, k: 1.17, pass: 2.2,
    cargo: 'eggs', intro: '비 오는 날은 미끄럽잖소. 그러니 더 눕혀야지.', obstacles: 'rocks' },
  { id: 9, name: '아흔아홉 굽이의 심장', place: '해발 720 → 600 m', s0: 1740, s1: 3260, weather: 'autumn', ref: 4.7, k: 1.145, pass: 2.0,
    cargo: 'tower', intro: '오늘은 짐이 좀 많소. 그래도 봐주는 거 없소!', obstacles: 'mixed' },
  { id: 10, name: '풀코스 결전', place: '대관령 정상 → 성산 12.5 km', s0: 30, s1: 12440, weather: 'sunset', ref: 5.0, k: 1.11, pass: 6.0,
    cargo: 'gas', intro: '꼭대기서 성산까지, 한 번에 가우야. 감자 삶아 놓고 기다리겠소.', obstacles: 'mixed', boss: true },
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
  { key: 'engine', icon: '🔥', name: '엔진', desc: '가속과 최고속', max: 5,
    steps: ['순정', '흡기 튜닝', '풀배기 머플러', 'ECU 맵핑', '보어업', '터보 (미쳤소?)'],
    cost: [0, 60000, 140000, 300000, 560000, 980000] },
  { key: 'tire', icon: '🛞', name: '타이어', desc: '코너 접지력 · 최대 기울기', max: 5,
    steps: ['순정', '스포츠 타이어', '하이그립', '세미 슬릭', '레이싱 슬릭', '월드GP 스펙'],
    cost: [0, 70000, 160000, 330000, 600000, 1050000] },
  { key: 'brake', icon: '🛑', name: '브레이크', desc: '제동력 — 늦게 잡을수록 빠르다', max: 5,
    steps: ['순정', '메쉬 호스', '레이싱 패드', '대구경 디스크', '4P 캘리퍼', '카본 디스크'],
    cost: [0, 45000, 110000, 240000, 450000, 800000] },
  { key: 'susp', icon: '🪛', name: '서스펜션', desc: '기울이는 속도 · 연속 코너 대응', max: 5,
    steps: ['순정', '프리로드 조절', '강화 스프링', '카트리지 킷', '풀 어저스터블', '전자제어 서스'],
    cost: [0, 50000, 120000, 260000, 480000, 850000] },
  { key: 'light', icon: '🪶', name: '경량화', desc: '가속 · 민첩성', max: 5,
    steps: ['순정', '순정 부품 다이어트', '알루미늄 휠', '티타늄 볼트', '카본 카울', '마그네슘 휠'],
    cost: [0, 55000, 130000, 280000, 520000, 900000] },
  { key: 'nitro', icon: '💨', name: '니트로', desc: '직선에서 한 방 (횟수)', max: 3,
    steps: ['없음', '1회', '2회', '3회'],
    cost: [0, 90000, 260000, 620000] },
  { key: 'led', icon: '✨', name: 'LED 언더글로우', desc: '성능 +0 · 간지 +100', max: 1,
    steps: ['없음', '장착'], cost: [0, 150000], gag: true },
  { key: 'sticker', icon: '🏷️', name: '"할배 조심" 스티커', desc: '성능 +0 · 할배가 한마디 한다', max: 1,
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
  wakeGap: -18, // 이만큼 뒤처지면 각성 (m)
  wakeResume: -5,
  waitFactor: 0.84,
  wakeFactor: 1.075,
  freeZone: 0.84, // 진행률이 이 값을 넘으면 봐주기/각성 없이 실력대로
};

export const CARGO_LABEL = {
  none: '빈손 (마실 가는 길)', box: '철가방 (짜장면 2, 탕수육 1)', rice: '쌀 20kg 한 포대',
  eggs: '계란 30판', gas: 'LPG 가스통', tower: '철가방 + 쌀 + 계란 (전부)',
};

// ---------------------------------------------------------------------------
// 날씨·시간대
// ---------------------------------------------------------------------------
export const WEATHERS = {
  day: { label: '맑은 낮', season: 'summer', sunAz: 150, sunEl: 52, sun: '#fff3dc', sunI: 3.1, top: '#2f73c9', hor: '#b9d8f2', fog: '#b4d2ec', fogNear: 250, fogFar: 15000,
    hemiSky: '#cfe4ff', hemiGround: '#5d6b4a', hemiI: 1.25, exposure: 0.92, clouds: 0.42, grip: 1 },
  autumn: { label: '단풍 든 오후', season: 'autumn', sunAz: 215, sunEl: 34, sun: '#ffe6bd', sunI: 3.0, top: '#3a78c4', hor: '#d6dfe6', fog: '#ccd8e0', fogNear: 220, fogFar: 12000,
    hemiSky: '#d8e6f7', hemiGround: '#7a6238', hemiI: 1.15, exposure: 0.95, clouds: 0.5, grip: 1, particles: 'leaves' },
  sunset: { label: '해 질 녘', season: 'autumn', sunAz: 262, sunEl: 9, sun: '#ffb070', sunI: 2.6, top: '#3b5fa6', hor: '#ffc38a', fog: '#f0b88c', fogNear: 160, fogFar: 9000,
    hemiSky: '#c9c0e0', hemiGround: '#6a4a36', hemiI: 0.95, exposure: 1.0, clouds: 0.55, grip: 1 },
  fog: { label: '짙은 안개', season: 'summer', sunAz: 120, sunEl: 40, sun: '#e8ecef', sunI: 1.1, top: '#aab6bf', hor: '#c3ccd2', fog: '#c0c9cf', fogNear: 12, fogFar: 150,
    hemiSky: '#dfe6ea', hemiGround: '#6f7669', hemiI: 1.55, exposure: 0.9, clouds: 1, grip: 0.96, noShadow: true },
  night: { label: '한밤중', season: 'summer', sunAz: 200, sunEl: 48, sun: '#8fa6d8', sunI: 0.55, top: '#050914', hor: '#16203a', fog: '#0e1628', fogNear: 40, fogFar: 700,
    hemiSky: '#3a4d80', hemiGround: '#10141d', hemiI: 0.8, exposure: 1.05, clouds: 0.3, grip: 1, night: true, noShadow: true },
  rain: { label: '비 오는 날', season: 'summer', sunAz: 140, sunEl: 45, sun: '#c9d0d6', sunI: 0.9, top: '#6f7c88', hor: '#9aa5ad', fog: '#98a3ab', fogNear: 30, fogFar: 520,
    hemiSky: '#c7d0d8', hemiGround: '#4c5448', hemiI: 1.35, exposure: 0.9, clouds: 1, grip: 0.86, wet: true, particles: 'rain', noShadow: true },
};

export const SEASONS = {
  summer: {
    land: { 1: '#3d6b2c', 2: '#6f8a45', 3: '#9aa55a', 4: '#9a968c', 5: '#9b8c74', 6: '#3f6f8f' },
    rock: '#7d7669', verge: '#7b8552', high: '#7d8f5c', sea: '#2f6f9f', gravel: '#8e8a80',
    conifer: ['#2c5a2b', '#335f2c', '#27502a'], decid: ['#4f8a36', '#5f9a3d', '#447a31', '#6aa046'], trunk: '#5a4632',
  },
  autumn: {
    land: { 1: '#7a6a2e', 2: '#9a8444', 3: '#b59a55', 4: '#9a968c', 5: '#a08c6c', 6: '#44708a' },
    rock: '#857a68', verge: '#97864e', high: '#8f8556', sea: '#356d94', gravel: '#8e8a80',
    conifer: ['#2f5a2c', '#3a6230', '#2a4f2a'], decid: ['#c9532a', '#e0932f', '#d9b23a', '#b53a26', '#8f9a3c', '#e36f2c'], trunk: '#54412f',
  },
};

// ---------------------------------------------------------------------------
// 할배 대사 (강원도 사투리 풍). 실제 인물이 아닌 가상의 캐릭터.
// ---------------------------------------------------------------------------
export const LINES = {
  kick: ['아이고, 시동이 또 안 걸리네… 먼저 가우야!', '탈탈탈… 이놈이 삼십 년을 탔더니 꾀를 부리잖소.', '어여 먼저 가우야. 금방 따라가겠소.'],
  overtake: ['실례 좀 하우야~', '젊은이, 코너에선 브레이크 잡는 기 아이래요!', '그 비싼 오도바이가 아깝소!', '안쪽이 비었길래 지나가우야.', '빵빵! 배달 늦겠소!'],
  overtaken: ['오호? 제법이래요?', '허허, 그럼 나도 좀 댕겨 볼까.', '어이쿠, 요새 젊은이들 빠르네.'],
  wake: ['인제 몸 좀 풀렸소!', '허허, 삼단 넣어야 되겠네.', '씨티백은 사단부터가 진짜래요.'],
  wait: ['아이고 심심해라… 어여 오우야!', '커피 한 잔 타 놓고 기다릴까?', '거 살살 와도 되우야. 안 도망가우.', '오다가 넘어진 거 아이지?'],
  crash: ['거 봐, 살살 댕기라니까.', '오도바이는 멀쩡하우?', '가드레일이 마카 찌그러졌잖소!', '헬멧은 그래 쓰라고 있는 기래요.'],
  nitro: ['그기 뭐이나, 방구래요?', '어이쿠 깜짝이야! 불났소?'],
  bump: ['어이쿠, 받지 마우야!', '계란 깨지면 물어내야 되우!'],
  near: ['뒤에 바짝 붙었네? 코 닿겠소.', '따라올 만하우?'],
  sticker: ['"할배 조심"? 허허, 조심은 내가 하는 기래요.'],
  win: ['내려오느라 고생했소. 감자나 한 알 먹고 가우야.', '오도바이가 달리는 기 아이래요. 사람이 달리는 기지.', '그 오도바이, 내 씨티백 열 대 값이라 그랬소?', '다음엔 쌀 한 포대 더 싣고 올까?'],
  lose: ['허허… 오늘은 허리가 좀 안 좋았소.', '배달만 아이었으면… 다음엔 봐주는 거 없소!', '제법이래요. 내 젊을 때 같소.', '씨티백이 오늘 감기 걸렸나 보우.'],
  bossLose: ['허허허… 사십 년 만에 처음이래요. 자네가 인제 대관령 주인이우야.'],
};

export const TIPS = [
  '코너 앞에서 미리 감속하고, 들어가서는 브레이크를 놓으세요.',
  '브레이크를 잡은 채로는 바이크가 덜 눕습니다.',
  '할배 뒤에 바짝 붙으면 공기저항이 줄어 직선에서 따라붙기 쉽습니다.',
  '가드레일에 살짝 스치면 속도만 잃지만, 세게 박으면 넘어집니다.',
  '타이어 개조는 코너 속도를, 엔진 개조는 직선 속도를 올려 줍니다.',
  '화면 위 화살표는 다음 코너의 방향과 세기입니다. 빨갈수록 급합니다.',
  '할배는 앞서면 기다려 주고, 뒤처지면 각성합니다. 승부는 마지막 구간에서 납니다.',
];

export const STORAGE_KEY = 'dgr_downhill_save_v1';
