// 레벨이 오를수록 늘어나는 장애물: 낙석, 고라니, 경운기.
import * as THREE from 'three';
import { DS } from './track.js';
import { mulberry32, clamp } from './geo.js';

const lam = (hex) => new THREE.MeshLambertMaterial({ color: hex });
function part(parent, geo, mat, x, y, z) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; }

function makeRock(r, rnd) {
  const g = new THREE.Group();
  for (let k = 0; k < 3; k++) {
    const m = part(g, new THREE.IcosahedronGeometry(r * (0.55 + rnd() * 0.5), 0), lam(k ? 0x6f6a62 : 0x827c72), (rnd() - 0.5) * r, r * 0.3, (rnd() - 0.5) * r);
    m.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3); m.scale.y = 0.7;
  }
  return g;
}
function makeDeer() {
  const g = new THREE.Group(), fur = lam(0x9a7448), dark = lam(0x5c4428);
  part(g, new THREE.BoxGeometry(0.28, 0.32, 0.8), fur, 0, 0.62, 0);
  part(g, new THREE.BoxGeometry(0.14, 0.34, 0.16), fur, 0, 0.9, 0.42).rotation.x = -0.5;
  const head = part(g, new THREE.BoxGeometry(0.16, 0.16, 0.26), fur, 0, 1.08, 0.52);
  part(head, new THREE.BoxGeometry(0.05, 0.16, 0.03), dark, 0.07, 0.14, -0.06); part(head, new THREE.BoxGeometry(0.05, 0.16, 0.03), dark, -0.07, 0.14, -0.06);
  part(head, new THREE.BoxGeometry(0.03, 0.03, 0.02), lam(0x111111), 0.06, 0.02, 0.13); part(head, new THREE.BoxGeometry(0.03, 0.03, 0.02), lam(0x111111), -0.06, 0.02, 0.13);
  const legs = [];
  for (const [x, z] of [[0.1, 0.3], [-0.1, 0.3], [0.1, -0.3], [-0.1, -0.3]]) { const l = part(g, new THREE.BoxGeometry(0.06, 0.5, 0.06), dark, x, 0.25, z); legs.push(l); }
  g.userData.legs = legs;
  return g;
}
function makeTractor() {
  const g = new THREE.Group(), red = lam(0xb5261e), grey = lam(0x55595e), tire = lam(0x151515), wood = lam(0x7a5a36);
  part(g, new THREE.BoxGeometry(0.6, 0.5, 0.9), red, 0, 0.75, 1.5);
  part(g, new THREE.BoxGeometry(0.3, 0.3, 0.5), grey, 0, 0.5, 1.9);
  for (const sx of [0.42, -0.42]) { const w = part(g, new THREE.CylinderGeometry(0.4, 0.4, 0.16, 12), tire, sx, 0.4, 1.45); w.rotation.z = Math.PI / 2; }
  for (const sx of [0.3, -0.3]) part(g, new THREE.BoxGeometry(0.04, 0.04, 1.3), grey, sx, 1.0, 0.7).rotation.x = -0.25;
  part(g, new THREE.BoxGeometry(1.3, 0.1, 2.2), wood, 0, 0.6, -0.9);
  for (const sx of [0.62, -0.62]) part(g, new THREE.BoxGeometry(0.06, 0.4, 2.2), wood, sx, 0.82, -0.9);
  part(g, new THREE.BoxGeometry(1.3, 0.4, 0.06), wood, 0, 0.82, -2.0);
  for (const sx of [0.6, -0.6]) { const w = part(g, new THREE.CylinderGeometry(0.3, 0.3, 0.14, 12), tire, sx, 0.3, -1.1); w.rotation.z = Math.PI / 2; }
  // 배추 짐 + 밀짚모자 아저씨
  for (let k = 0; k < 6; k++) part(g, new THREE.IcosahedronGeometry(0.24, 0), lam(0x7fae4a), ((k % 2) - 0.5) * 0.6, 0.85, -0.4 - Math.floor(k / 2) * 0.55);
  part(g, new THREE.BoxGeometry(0.4, 0.55, 0.26), lam(0x3f5f8a), 0, 1.25, 0.15);
  part(g, new THREE.SphereGeometry(0.13, 10, 8), lam(0xd9a47a), 0, 1.65, 0.17);
  part(g, new THREE.CylinderGeometry(0.3, 0.3, 0.03, 12), lam(0xd9c27a), 0, 1.75, 0.17);
  part(g, new THREE.CylinderGeometry(0.12, 0.14, 0.12, 10), lam(0xd9c27a), 0, 1.81, 0.17);
  return g;
}

export function buildObstacles(world, stage, kind, scene) {
  const { track } = world;
  const group = new THREE.Group(); group.name = 'obstacles';
  const list = [];
  if (!kind) return { group, list, update() {} };
  const rnd = mulberry32(stage.id * 991 + 7);
  const o = {};
  const len = stage.i1 - stage.i0;
  const full = len > 3000; // 풀코스
  const place = (i, d) => { track.at(i * DS, d, o); return o; };
  const types = kind === 'mixed' ? ['rocks', 'deer', 'tractor'] : [kind];
  // 일정 간격의 창마다 "가장 곧은 지점"을 골라 놓는다 (굽은 스테이지에서도 반드시 배치되도록)
  const gapOf = { rocks: 85, deer: 110, tractor: 190 };
  const spots = [];
  let i = stage.i0 + 80, n = 0;
  while (i < stage.i1 - 70) {
    const type = types[n % types.length], win = Math.round((gapOf[type] || 100) * (full ? 2.6 : 1));
    let best = -1, bestK = 1e9;
    for (let j = i; j < Math.min(stage.i1 - 60, i + win); j += 2) {
      let k = 0;
      for (let m = -8; m <= 10; m += 2) k = Math.max(k, Math.abs(track.K[clamp(j + m, 0, track.n - 1)]));
      if (k < bestK) { bestK = k; best = j; }
    }
    if (best > 0 && bestK < 0.03 && !track.BR[best]) spots.push([best, type]);
    i += win; n++;
  }
  for (let k = 0; k < spots.length; k++) {
    const [i, type] = spots[k], hw = track.HW[i];
    if (rnd() < 0.15) continue;
    if (type === 'rocks') {
      const d = (rnd() < 0.5 ? -1 : 1) * (hw * 0.35 + rnd() * hw * 0.4), r = 0.45 + rnd() * 0.3;
      const m = makeRock(r, rnd); const p = place(i, d); m.position.set(p.x, p.y, p.z); group.add(m);
      list.push({ kind: 'rock', s: i * DS, d, w: r * 0.9, len: r, mesh: m, label: '낙석' });
    } else if (type === 'deer') {
      const m = makeDeer(); m.visible = false; group.add(m);
      list.push({ kind: 'deer', s: i * DS, d: hw + 1.5, w: 0.35, len: 0.5, mesh: m, label: '고라니', phase: 0, t: 0, from: rnd() < 0.5 ? 1 : -1, hw });
    } else if (type === 'tractor') {
      const m = makeTractor(); group.add(m);
      list.push({ kind: 'tractor', s: i * DS, d: -hw * 0.52, w: 0.75, len: 2.3, mesh: m, label: '경운기', v: 4.2 });
    }
  }
  scene.add(group);
  const update = (dt, player, onEvent) => {
    for (const ob of list) {
      if (ob.kind === 'tractor') {
        if (ob.s < stage.i1 * DS + 100) ob.s += ob.v * dt;
        const p = place(ob.s / DS, ob.d);
        ob.mesh.position.set(p.x, p.y + Math.sin(performance.now() * 0.03) * 0.012, p.z);
        ob.mesh.rotation.y = Math.atan2(p.tx, p.tz);
      } else if (ob.kind === 'deer') {
        // 55 m 앞에 오면 뛰어들어, 길 한가운데서 멈칫했다가 달아난다
        if (ob.phase === 0 && ob.s - player.s < 62 && ob.s - player.s > 0) { ob.phase = 1; ob.t = 0; ob.d = ob.from * (ob.hw + 1.5); ob.mesh.visible = true; onEvent('deer'); }
        if (ob.phase > 0 && ob.phase < 4) {
          ob.t += dt;
          const stopD = ob.from * -0.6;
          if (ob.phase === 1) { ob.d -= ob.from * 8.5 * dt; if ((ob.from > 0 && ob.d <= stopD) || (ob.from < 0 && ob.d >= stopD)) { ob.phase = 2; ob.t = 0; } }
          else if (ob.phase === 2) { if (ob.t > 0.75) ob.phase = 3; }
          else { ob.d -= ob.from * 11 * dt; if (Math.abs(ob.d) > ob.hw + 4) { ob.phase = 4; ob.mesh.visible = false; } }
          const p = place(ob.s / DS, ob.d);
          const hop = ob.phase === 2 ? 0 : Math.abs(Math.sin(ob.t * 14)) * 0.25;
          ob.mesh.position.set(p.x, p.y + hop, p.z);
          ob.mesh.rotation.y = Math.atan2(p.tx, p.tz) + (ob.phase === 2 ? Math.PI : (ob.from > 0 ? -Math.PI / 2 : Math.PI / 2));
          const legs = ob.mesh.userData.legs;
          for (let k = 0; k < 4; k++) legs[k].rotation.x = ob.phase === 2 ? 0 : Math.sin(ob.t * 14 + (k % 2) * Math.PI) * 0.7;
        }
      }
      // 충돌
      if (ob.kind === 'deer' && (ob.phase === 0 || ob.phase === 4)) continue;
      if (Math.abs(ob.s - player.s) < ob.len + 0.9 && Math.abs(ob.d - player.d) < ob.w + 0.38 && player.state === 'ride' && player.invuln <= 0) {
        player.crash(ob.kind);
      }
    }
  };
  return { group, list, update };
}
