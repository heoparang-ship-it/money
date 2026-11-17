// 입력: 키보드, 터치(왼쪽 패드 = 기울이기, 오른쪽 = 브레이크·니트로), 게임패드.
import { clamp } from './geo.js';

export class Input {
  constructor() {
    this.keys = new Set();
    this.steer = 0; this.kSteer = 0;
    this.touchSteer = null; this.touchBrake = false; this.boostQueued = false; this.pauseQueued = false;
    this.usingTouch = false; this.padBoostPrev = false;
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyX' || e.code === 'KeyN') this.boostQueued = true;
      if (e.code === 'KeyP' || e.code === 'Escape') this.pauseQueued = true;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    this._bindTouch();
  }

  _bindTouch() {
    const st = document.getElementById('t-steer'), knob = st.querySelector('.knob'), br = document.getElementById('t-brake'), ni = document.getElementById('t-nitro');
    let id = null, x0 = 0;
    const set = (v) => { this.touchSteer = v; knob.style.transform = `translateX(${(v || 0) * -63}px)`; };
    st.addEventListener('pointerdown', (e) => { this.usingTouch = true; id = e.pointerId; x0 = e.clientX; st.setPointerCapture(id); set(0); e.preventDefault(); });
    st.addEventListener('pointermove', (e) => { if (e.pointerId === id) set(clamp((x0 - e.clientX) / 62, -1, 1)); });
    const end = (e) => { if (e.pointerId === id) { id = null; set(null); } };
    st.addEventListener('pointerup', end); st.addEventListener('pointercancel', end);
    const hold = (el, on, off) => {
      el.addEventListener('pointerdown', (e) => { this.usingTouch = true; el.classList.add('down'); on(); e.preventDefault(); });
      const up = () => { el.classList.remove('down'); off(); };
      el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('pointerleave', up);
    };
    hold(br, () => (this.touchBrake = true), () => (this.touchBrake = false));
    hold(ni, () => (this.boostQueued = true), () => {});
  }

  /** 프레임당 한 번 호출. 왼쪽 = +steer */
  read(dt, out = {}) {
    const k = this.keys;
    const left = k.has('ArrowLeft') || k.has('KeyA'), right = k.has('ArrowRight') || k.has('KeyD');
    const tgt = (left ? 1 : 0) - (right ? 1 : 0);
    // 키보드는 서서히 기울고, 놓으면 조금 더 빨리 돌아온다
    const rate = tgt === 0 ? 5.5 : Math.sign(tgt) !== Math.sign(this.kSteer) && this.kSteer !== 0 ? 9 : 3.6;
    this.kSteer += clamp(tgt - this.kSteer, -rate * dt, rate * dt);
    let steer = this.kSteer, brake = k.has('ArrowDown') || k.has('KeyS') || k.has('Space') ? 1 : 0, boost = this.boostQueued;
    if (this.touchSteer !== null) steer = this.touchSteer;
    if (this.touchBrake) brake = 1;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const ax = p.axes[0] || 0;
      if (Math.abs(ax) > 0.12) steer = -Math.sign(ax) * Math.pow((Math.abs(ax) - 0.12) / 0.88, 1.4);
      const b = (i) => (p.buttons[i] ? p.buttons[i].value : 0);
      brake = Math.max(brake, b(6), b(1), b(2));
      const nb = b(0) > 0.5 || b(5) > 0.5;
      if (nb && !this.padBoostPrev) boost = true;
      this.padBoostPrev = nb;
      if (b(9) > 0.5 && !this._padPause) this.pauseQueued = true;
      this._padPause = b(9) > 0.5;
      break;
    }
    out.steer = clamp(steer, -1, 1); out.brake = brake; out.throttle = 1; out.boost = boost;
    out.pause = this.pauseQueued;
    this.boostQueued = false; this.pauseQueued = false;
    return out;
  }
}
