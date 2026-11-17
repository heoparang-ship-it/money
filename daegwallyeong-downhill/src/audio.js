// 소리는 전부 Web Audio로 합성한다 (음원 파일 없음).
// 플레이어 엔진, 씨티백의 "탈탈탈", 바람, 타이어, 긁힘, 할배 라디오의 뽕짝 리듬 등.
import { clamp } from './geo.js';

export class GameAudio {
  constructor() { this.ctx = null; this.on = true; this.ready = false; this.gear = 1; this.trotOn = false; this.nextNote = 0; this.step = 0; }

  /** 첫 사용자 입력 때 호출 (브라우저 자동재생 정책) */
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = (this.ctx = new AC());
    this.master = c.createGain(); this.master.gain.value = this.on ? 0.8 : 0;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 6;
    this.master.connect(comp); comp.connect(c.destination);
    // 잡음 버퍼
    const len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    const noise = (type, freq, q) => {
      const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
      const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = c.createGain(); g.gain.value = 0;
      src.connect(f); f.connect(g); g.connect(this.master); src.start();
      return { f, g };
    };
    // 플레이어 엔진: 톱니파 + 한 옥타브 아래 사각파
    const e = (this.eng = {});
    e.o1 = c.createOscillator(); e.o1.type = 'sawtooth'; e.o2 = c.createOscillator(); e.o2.type = 'square';
    e.f = c.createBiquadFilter(); e.f.type = 'lowpass'; e.f.frequency.value = 600; e.f.Q.value = 2;
    e.g = c.createGain(); e.g.gain.value = 0;
    const g2 = c.createGain(); g2.gain.value = 0.5;
    e.o1.connect(e.f); e.o2.connect(g2); g2.connect(e.f); e.f.connect(e.g); e.g.connect(this.master);
    e.o1.start(); e.o2.start();
    // 씨티백: 낮은 사각파를 LFO로 끊어 "탈탈탈"
    const p = (this.putt = {});
    p.o = c.createOscillator(); p.o.type = 'square'; p.o.frequency.value = 60;
    p.lfo = c.createOscillator(); p.lfo.type = 'square'; p.lfo.frequency.value = 16;
    p.am = c.createGain(); p.am.gain.value = 0.5;
    const lg = c.createGain(); lg.gain.value = 0.5;
    p.lfo.connect(lg); lg.connect(p.am.gain);
    p.f = c.createBiquadFilter(); p.f.type = 'bandpass'; p.f.frequency.value = 420; p.f.Q.value = 1.2;
    p.g = c.createGain(); p.g.gain.value = 0;
    p.pan = c.createStereoPanner ? c.createStereoPanner() : null;
    p.o.connect(p.am); p.am.connect(p.f); p.f.connect(p.g);
    if (p.pan) { p.g.connect(p.pan); p.pan.connect(this.master); } else p.g.connect(this.master);
    p.o.start(); p.lfo.start();
    this.wind = noise('bandpass', 700, 0.6);
    this.squeal = noise('bandpass', 2100, 9);
    this.scrape = noise('highpass', 2600, 1);
    // 라디오 (뽕짝)
    this.radio = c.createGain(); this.radio.gain.value = 0;
    const rf = c.createBiquadFilter(); rf.type = 'bandpass'; rf.frequency.value = 1400; rf.Q.value = 0.7;
    this.radioPan = c.createStereoPanner ? c.createStereoPanner() : null;
    this.radioIn = c.createGain(); this.radioIn.connect(rf); rf.connect(this.radio);
    if (this.radioPan) { this.radio.connect(this.radioPan); this.radioPan.connect(this.master); } else this.radio.connect(this.master);
    this.ready = true;
  }

  setEnabled(v) { this.on = !!v; if (this.master) this.master.gain.value = this.on ? 0.8 : 0; }

  /** 매 프레임 연속음 갱신. st: { v, throttle, brake, boost, over, scrape, gV, gDist, gSide, racing } */
  update(st) {
    if (!this.ready) return;
    const c = this.ctx, t = c.currentTime, set = (param, v, tc = 0.05) => param.setTargetAtTime(v, t, tc);
    if (!st.racing) {
      set(this.eng.g.gain, st.idle ? 0.03 : 0); set(this.eng.o1.frequency, 62); set(this.eng.o2.frequency, 31);
      set(this.putt.g.gain, st.idle ? 0.05 : 0); set(this.putt.lfo.frequency, 9);
      set(this.wind.g.gain, 0); set(this.squeal.g.gain, 0); set(this.scrape.g.gain, 0); set(this.radio.gain, st.idle ? 0.035 : 0, 0.3);
      if (st.idle) this._trot(t);
      return;
    }
    // 가상 변속: 단수에 따라 회전수가 오르내린다
    const tops = [0, 15, 25, 36, 48, 62, 90];
    while (this.gear < 6 && st.v > tops[this.gear] * 0.97) this.gear++;
    while (this.gear > 1 && st.v < tops[this.gear - 1] * 0.72) this.gear--;
    const lo = tops[this.gear - 1] * 0.55, r = clamp((st.v - lo) / (tops[this.gear] - lo), 0, 1.05);
    const f = 62 + r * 215 + (st.boost ? 30 : 0);
    set(this.eng.o1.frequency, f, 0.04); set(this.eng.o2.frequency, f / 2, 0.04);
    set(this.eng.f.frequency, 500 + r * 1500 + st.throttle * 700);
    set(this.eng.g.gain, 0.045 + st.throttle * 0.075 + (st.boost ? 0.04 : 0));
    set(this.wind.g.gain, Math.min(0.2, (st.v / 62) * (st.v / 62) * 0.17)); set(this.wind.f.frequency, 500 + st.v * 16);
    set(this.squeal.g.gain, st.over > 0.15 ? Math.min(0.12, st.over * 0.12) : st.brake > 0.5 && st.v > 12 ? 0.02 : 0);
    set(this.scrape.g.gain, st.scrape ? 0.22 : 0, 0.02);
    const near = clamp(1 - st.gDist / 70, 0, 1), pan = clamp(st.gSide, -1, 1);
    set(this.putt.o.frequency, 46 + st.gV * 2.4); set(this.putt.lfo.frequency, 9 + st.gV * 0.9);
    set(this.putt.g.gain, near * near * 0.2);
    if (this.putt.pan) set(this.putt.pan.pan, pan);
    set(this.radio.gain, near * near * 0.11, 0.2);
    if (this.radioPan) set(this.radioPan.pan, pan);
    this._trot(t);
  }

  // 2박자 뽕짝 반주 + 단조 오음계 가락 (직접 지은 짧은 가락)
  _trot(now) {
    const c = this.ctx, bps = 132 / 60, stepDur = 1 / bps / 2;
    if (this.nextNote < now) this.nextNote = now + 0.05;
    const A = 220;
    const mel = [0, 3, 5, 7, 5, 3, 0, -2, 0, 3, 7, 10, 7, 5, 3, 5, 12, 10, 7, 5, 7, 3, 5, 0, -2, 0, 3, 5, 3, 0, -2, 0];
    while (this.nextNote < now + 0.25) {
      const s = this.step++, tt = this.nextNote;
      // 쿵 (베이스)
      if (s % 2 === 0) this._tone(tt, 'triangle', (s % 8 < 4 ? A : A * 0.75) / 2 * (s % 4 === 2 ? 1.5 : 1), 0.16, 0.5, this.radioIn);
      // 짝 (잡음)
      else this._noiseHit(tt, 0.05, 0.22, this.radioIn);
      const n = mel[s % mel.length];
      if (s % 32 < 30) this._tone(tt, 'square', A * 2 ** (n / 12), stepDur * 0.9, 0.16, this.radioIn);
      this.nextNote += stepDur;
    }
  }

  _tone(t, type, f, dur, vol, dest, f2) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || this.master); o.start(t); o.stop(t + dur + 0.02);
  }
  _noiseHit(t, dur, vol, dest, type = 'highpass', freq = 3000) {
    const c = this.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noiseBuf; f.type = type; f.frequency.value = freq;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(dest || this.master); s.start(t, Math.random()); s.stop(t + dur + 0.02);
  }

  play(name) {
    if (!this.ready || !this.on) return;
    const t = this.ctx.currentTime + 0.01;
    switch (name) {
      case 'click': this._tone(t, 'square', 660, 0.05, 0.08); break;
      case 'beep': this._tone(t, 'sine', 520, 0.16, 0.3); break;
      case 'go': this._tone(t, 'sine', 1040, 0.5, 0.35); break;
      case 'buy': [0, 4, 7, 12].forEach((n, i) => this._tone(t + i * 0.06, 'triangle', 660 * 2 ** (n / 12), 0.12, 0.2)); break;
      case 'deny': this._tone(t, 'sawtooth', 160, 0.2, 0.15, null, 110); break;
      case 'coin': this._tone(t, 'sine', 1320, 0.09, 0.2); this._tone(t + 0.07, 'sine', 1760, 0.14, 0.2); break;
      case 'horn': [0, 0.17].forEach((d) => { this._tone(t + d, 'square', 415, 0.12, 0.16); this._tone(t + d, 'square', 523, 0.12, 0.12); }); break;
      case 'scrape': this._noiseHit(t, 0.25, 0.4, null, 'highpass', 1800); break;
      case 'crash': this._noiseHit(t, 0.7, 0.7, null, 'lowpass', 1400); this._tone(t, 'sine', 90, 0.4, 0.6, null, 38); this._noiseHit(t + 0.25, 0.4, 0.3, null, 'highpass', 2500); break;
      case 'nitro': this._noiseHit(t, 1.0, 0.35, null, 'bandpass', 900); this._tone(t, 'sawtooth', 120, 0.9, 0.12, null, 520); break;
      case 'deer': this._tone(t, 'sawtooth', 700, 0.45, 0.2, null, 1500); this._tone(t + 0.02, 'square', 720, 0.4, 0.08, null, 1300); break;
      case 'wake': [0, 3, 7, 12, 15].forEach((n, i) => this._tone(t + i * 0.05, 'square', 330 * 2 ** (n / 12), 0.1, 0.13)); break;
      case 'win': [0, 4, 7, 12, 7, 12, 16].forEach((n, i) => this._tone(t + i * 0.11, 'triangle', 523 * 2 ** (n / 12), 0.22, 0.26)); break;
      case 'lose': [0, -1, -2, -3].forEach((n, i) => this._tone(t + i * 0.32, 'sawtooth', 233 * 2 ** (n / 12), i === 3 ? 0.9 : 0.3, 0.16, null, i === 3 ? 233 * 2 ** (-5 / 12) : undefined)); break;
      case 'clean': this._tone(t, 'sine', 880, 0.08, 0.14); this._tone(t + 0.06, 'sine', 1175, 0.12, 0.14); break;
      default: break;
    }
  }
}
