// 주행 중 화면 표시(HUD): 멘탈 하트, 순위·격차, 할배 진심도, 진행도, 미니맵, 코너 안내, 할배의 한마디 창.
import { PORTRAIT_GRANDPA, PORTRAIT_DOG, pixCanvas } from './px/sprites.js';
import { DS } from './track.js';

const $ = (id) => document.getElementById(id);
const fmt = (t) => { const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`; };
export const fmtTime = fmt;
const INK = '#2b1464';

export function drawFace(canvas, dog) {
  const c = canvas.getContext('2d');
  c.clearRect(0, 0, 16, 16);
  c.drawImage(pixCanvas(dog ? PORTRAIT_DOG : PORTRAIT_GRANDPA), 0, 0);
}

export class Hud {
  constructor() {
    this.el = $('hud'); this.kmh = $('h-kmh'); this.time = $('h-time'); this.rank = $('h-rank'); this.gap = $('h-gap'); this.lv = $('h-lv');
    this.pp = $('h-pp'); this.pg = $('h-pg'); this.corner = $('h-corner'); this.warn = $('h-warn'); this.sayEl = $('h-say'); this.sayT = $('h-say-t'); this.sayWho = $('h-say-who'); this.face = $('h-face');
    this.toastEl = $('h-toast'); this.countEl = $('h-count'); this.nitro = $('h-nitro'); this.tags = $('h-tags'); this.attr = $('h-attr');
    this.heartsEl = $('h-hearts'); this.hc = $('h-hc'); this.sinc = $('h-sinc'); this.sincBar = this.sinc.querySelector('b'); this.sincN = $('h-sinc-n');
    this.map = $('h-map'); this.ctx = this.map.getContext('2d'); this.touch = $('touch');
    this.frame = 0; this.sayTimer = 0; this.toastTimer = 0; this._last = {}; this.full = ''; this.shown = 0; this.dog = null;
    this.heartsEl.innerHTML = '<i></i>'.repeat(5);
    drawFace(this.face, false);
  }
  show(on) { this.el.classList.toggle('on', on); }
  setTouch(on) { this.touch.classList.toggle('on', on); }

  setStage(stage, world, attr) {
    this.lv.textContent = `Lv.${stage.id} ${stage.name}`;
    this.attr.textContent = (attr ? attr + ' · ' : '') + '© OpenStreetMap';
    // 미니맵: 주행 화면과 같은 방향으로 코스를 미리 그려 둔다
    const t = world.track, W = this.map.width, o = {}, pts = [];
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (let i = Math.max(0, stage.i0 - 12); i <= Math.min(t.n - 1, stage.i1 + 12); i += 2) {
      world.toPx(t.X[i], t.Z[i], o); pts.push(o.x, o.y);
      x0 = Math.min(x0, o.x); x1 = Math.max(x1, o.x); y0 = Math.min(y0, o.y); y1 = Math.max(y1, o.y);
    }
    const pad = 6, sc = (W - pad * 2) / Math.max(x1 - x0, y1 - y0, 200);
    const ox = (W - (x1 - x0) * sc) / 2 - x0 * sc, oy = (W - (y1 - y0) * sc) / 2 - y0 * sc;
    const path = document.createElement('canvas'); path.width = W; path.height = W;
    const g = path.getContext('2d');
    const plot = (col, r) => {
      g.fillStyle = col;
      for (let i = 0; i < pts.length - 2; i += 2) {
        const ax = pts[i] * sc + ox, ay = pts[i + 1] * sc + oy, bx = pts[i + 2] * sc + ox, by = pts[i + 3] * sc + oy, n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)));
        for (let k = 0; k <= n; k++) g.fillRect(Math.round(ax + ((bx - ax) * k) / n) - r, Math.round(ay + ((by - ay) * k) / n) - r, r * 2 + 1, r * 2 + 1);
      }
    };
    plot(INK, 1); plot('#ffffff', 0);
    this.mm = { path, sc, ox, oy, world, stage };
    this.nitroMax = -1; this._last = {};
    this.sayEl.classList.remove('on'); this.toastEl.style.opacity = 0; this.corner.style.opacity = 0; this.warn.style.display = 'none'; this.countEl.style.display = 'none';
    this.sayTimer = 0; this.toastTimer = 0;
    this.hearts(5, true);
  }

  _drawMap(game) {
    const { path, sc, ox, oy, world, stage } = this.mm, c = this.ctx, W = this.map.width, o = (this._o ||= {});
    c.clearRect(0, 0, W, W);
    c.drawImage(path, 0, 0);
    const dot = (s, d, col, r) => {
      world.trackPx(s, d, o);
      const x = Math.round(o.x * sc + ox), y = Math.round(o.y * sc + oy);
      c.fillStyle = INK; c.fillRect(x - r - 1, y - r - 1, r * 2 + 3, r * 2 + 3);
      c.fillStyle = col; c.fillRect(x - r, y - r, r * 2 + 1, r * 2 + 1);
    };
    dot(stage.i1 * DS, 0, '#ffffff', 1);
    dot(game.grandpa.s, game.grandpa.d, '#ff5a7a', 1);
    dot(game.player.s, game.player.d, '#ffe14a', 1);
  }

  hearts(n, quiet) {
    const els = this.heartsEl.children;
    for (let i = 0; i < els.length; i++) {
      const off = i >= n;
      if (!quiet && off && !els[i].classList.contains('off')) { els[i].classList.remove('pop'); void els[i].offsetWidth; els[i].classList.add('pop'); }
      els[i].classList.toggle('off', off);
      if (quiet) els[i].classList.remove('pop');
    }
  }

  update(h, game, dt) {
    this.frame++;
    const L = this._last;
    const sp = Math.round(h.speed);
    if (sp !== L.sp) { this.kmh.textContent = sp; L.sp = sp; }
    const tt = fmt(h.time || 0);
    if (tt !== L.tt) { this.time.textContent = tt; L.tt = tt; }
    const ahead = h.gapM > 0;
    const rk = ahead ? '1위' : '2위';
    if (rk !== L.rk) { this.rank.textContent = rk; this.rank.classList.toggle('p1', ahead); L.rk = rk; }
    if (this.frame % 6 === 0) {
      this.gap.textContent = `${ahead ? '할배 앞' : '할배 뒤'} ${Math.abs(h.gapS).toFixed(1)}초`;
      this.gap.className = 't-out ' + (ahead ? 'ahead' : 'behind');
    }
    this.pp.style.left = (h.pp * 100).toFixed(1) + '%'; this.pg.style.left = (h.pg * 100).toFixed(1) + '%';
    // 할배 진심도: 평소에는 바닥을 긴다
    const sk = Math.round(h.sinc);
    if (sk !== L.sk) { this.sincBar.style.width = sk + '%'; this.sincN.textContent = sk + '%'; this.sinc.classList.toggle('max', sk >= 100); L.sk = sk; }
    if (h.tag !== L.hc) { this.hc.textContent = h.tag ? '할배 · ' + h.tag : ''; L.hc = h.tag; }
    // 코너 안내 (바이크 기준 좌우)
    if (h.corner) {
      const c = h.corner, sev = c.r < 19 ? 3 : c.r < 30 ? 2 : c.r < 45 ? 1 : 0;
      const key = `${c.dir}${sev}${c.turn > 2 ? 'U' : ''}`;
      if (key !== L.ck) {
        this.corner.innerHTML = `${(c.dir > 0 ? '◀' : '▶').repeat(sev + 1)}<small>${c.dir > 0 ? '좌' : '우'} ${c.turn > 2 ? '헤어핀' : sev >= 3 ? '급커브' : sev === 2 ? '커브' : '완만'}</small>`;
        this.corner.style.color = ['#ffffff', '#ffe14a', '#ffb92e', '#ff5a7a'][sev];
        L.ck = key;
      }
      this.corner.style.opacity = c.d < 6 ? 0.4 : 1;
    } else if (L.ck !== null) { this.corner.style.opacity = 0; L.ck = null; }
    if (h.warn) { const w = `! ${h.warn.label} ${Math.round(h.warn.d / 10) * 10}m`; if (w !== L.w) { this.warn.textContent = w; this.warn.style.display = 'block'; L.w = w; } }
    else if (L.w) { this.warn.style.display = 'none'; L.w = null; }
    // 니트로
    if (this.nitroMax < 0) { this.nitroMax = h.nitro; $('t-nitro').style.display = h.nitro > 0 ? 'flex' : 'none'; }
    const nk = `${h.nitro}/${this.nitroMax}`;
    if (nk !== L.nk) { this.nitro.innerHTML = Array.from({ length: this.nitroMax }, (_, i) => `<i class="${i < h.nitro ? 'on' : ''}"></i>`).join(''); L.nk = nk; }
    const tg = (h.boost ? '<span style="color:#7fe0ff">NITRO</span>' : '') + (h.draft ? '<span style="color:#6dffb0">슬립스트림</span>' : '') + (h.over ? '<span style="color:#ff5a7a">과속! 밀린다</span>' : '');
    if (tg !== L.tg) { this.tags.innerHTML = tg; L.tg = tg; }
    if (this.frame % 3 === 0) this._drawMap(game);
    this.tick(dt);
  }

  /** 말풍선 타자 효과와 토스트 수명 (주행 중이 아닐 때도 돈다) */
  tick(dt) {
    if (this.sayTimer > 0) {
      if (this.shown < this.full.length) { this.shown = Math.min(this.full.length, this.shown + dt * 46); this.sayT.textContent = this.full.slice(0, Math.ceil(this.shown)); }
      this.sayTimer -= dt;
      if (this.sayTimer <= 0) this.sayEl.classList.remove('on');
    }
    if (this.toastTimer > 0) { this.toastTimer -= dt; if (this.toastTimer <= 0) this.toastEl.style.opacity = 0; }
  }

  help(html, secs = 7) {
    const el = $('h-help');
    el.innerHTML = html; el.style.display = html ? 'block' : 'none';
    clearTimeout(this._helpT);
    if (html) this._helpT = setTimeout(() => (el.style.display = 'none'), secs * 1000);
  }
  /** 할배의 한마디. "(멍!)"으로 시작하면 감자가 말한다 */
  say(text) {
    const dog = text.startsWith('(멍');
    if (dog !== this.dog) { this.dog = dog; drawFace(this.face, dog); this.sayWho.textContent = dog ? '감자의 한마디 (통역: 황 영감)' : '황 영감의 한마디'; }
    this.full = text; this.shown = 0; this.sayT.textContent = '';
    this.sayEl.classList.add('on'); this.sayTimer = 2.6 + text.length * 0.07;
  }
  toast(text) {
    this.toastEl.textContent = text; this.toastEl.classList.toggle('sm', text.length > 9);
    this.toastEl.style.opacity = 1; this.toastTimer = text.length > 9 ? 2.2 : 1.3;
  }
  count(n) {
    this.countEl.style.display = 'block';
    this.countEl.textContent = n > 0 ? n : 'START!';
    this.countEl.style.color = n > 0 ? '#fff' : '#ffe14a';
    if (n <= 0) setTimeout(() => (this.countEl.style.display = 'none'), 900);
  }
}
