// 주행 중 화면 표시(HUD): 속도, 순위·격차, 진행도, 코너 안내, 미니맵, 할배 말풍선.
import { clamp } from './geo.js';

const $ = (id) => document.getElementById(id);
const fmt = (t) => { const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`; };
export const fmtTime = fmt;

export class Hud {
  constructor() {
    this.el = $('hud'); this.kmh = $('h-kmh'); this.time = $('h-time'); this.rank = $('h-rank'); this.gap = $('h-gap'); this.lv = $('h-lv');
    this.pp = $('h-pp'); this.pg = $('h-pg'); this.corner = $('h-corner'); this.warn = $('h-warn'); this.sayEl = $('h-say'); this.sayT = $('h-say-t');
    this.toastEl = $('h-toast'); this.countEl = $('h-count'); this.nitro = $('h-nitro'); this.tags = $('h-tags'); this.attr = $('h-attr');
    this.map = $('h-map'); this.ctx = this.map.getContext('2d'); this.touch = $('touch');
    this.frame = 0; this.sayTimer = 0; this.toastTimer = 0; this._last = {};
  }
  show(on) { this.el.classList.toggle('on', on); }
  setTouch(on) { this.touch.classList.toggle('on', on); }

  setStage(stage, track, satAttr) {
    this.lv.textContent = `Lv.${stage.id} ${stage.name}`;
    this.attr.textContent = (satAttr ? satAttr + ' · ' : '') + '© OpenStreetMap';
    // 미니맵 경로 (북쪽이 위)
    const pts = [];
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let i = Math.max(0, stage.i0 - 30); i <= Math.min(track.n - 1, stage.i1 + 30); i += 3) {
      pts.push(track.X[i], track.Z[i]);
      x0 = Math.min(x0, track.X[i]); x1 = Math.max(x1, track.X[i]); z0 = Math.min(z0, track.Z[i]); z1 = Math.max(z1, track.Z[i]);
    }
    const W = this.map.width, pad = 26, sc = (W - pad * 2) / Math.max(x1 - x0, z1 - z0, 60);
    const ox = (W - (x1 - x0) * sc) / 2 - x0 * sc, oz = (W - (z1 - z0) * sc) / 2 - z0 * sc;
    this.mm = { pts, sc, ox, oz, track, stage };
    this.nitroMax = -1; this._last = {};
    document.getElementById('h-mark').style.display = 'none';
    this.sayEl.classList.remove('on'); this.toastEl.style.opacity = 0; this.corner.style.opacity = 0; this.warn.style.display = 'none'; this.countEl.style.display = 'none';
  }

  _drawMap(game) {
    const { pts, sc, ox, oz, track, stage } = this.mm, c = this.ctx, W = this.map.width;
    c.clearRect(0, 0, W, W);
    c.lineJoin = c.lineCap = 'round';
    c.beginPath();
    for (let i = 0; i < pts.length; i += 2) { const x = pts[i] * sc + ox, y = pts[i + 1] * sc + oz; if (i) c.lineTo(x, y); else c.moveTo(x, y); }
    c.strokeStyle = 'rgba(0,0,0,.7)'; c.lineWidth = 11; c.stroke();
    c.strokeStyle = '#f2f2ee'; c.lineWidth = 5; c.stroke();
    const dot = (s, d, col, r) => {
      const a = track.at(s, d, (this._o ||= {}));
      c.beginPath(); c.arc(a.x * sc + ox, a.z * sc + oz, r, 0, 7); c.fillStyle = col; c.fill(); c.lineWidth = 3; c.strokeStyle = '#000'; c.stroke();
    };
    dot(stage.s1, 0, '#111', 7);
    dot(game.grandpa.s, game.grandpa.d, '#e2382b', 10);
    dot(game.player.s, game.player.d, '#ffd21f', 11);
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
    if (rk !== L.rk) { this.rank.textContent = rk; this.rank.className = ahead ? 'p1' : ''; L.rk = rk; }
    if (this.frame % 6 === 0) {
      this.gap.textContent = `${ahead ? '할배 앞' : '할배 뒤'} ${Math.abs(h.gapS).toFixed(1)}초 · ${Math.abs(h.gapM).toFixed(0)}m`;
      this.gap.className = ahead ? 'ahead' : 'behind';
    }
    this.pp.style.left = (h.pp * 100).toFixed(1) + '%'; this.pg.style.left = (h.pg * 100).toFixed(1) + '%';
    // 코너 안내
    if (h.corner) {
      const c = h.corner, sev = c.r < 19 ? 3 : c.r < 30 ? 2 : c.r < 45 ? 1 : 0;
      const key = `${c.dir}${sev}${c.turn > 2 ? 'U' : ''}`;
      if (key !== L.ck) {
        const arr = c.dir > 0 ? '◀' : '▶';
        this.corner.innerHTML = `${c.dir > 0 ? arr.repeat(sev + 1) : arr.repeat(sev + 1)}<small>${c.turn > 2 ? '헤어핀' : sev >= 3 ? '급커브' : sev === 2 ? '커브' : '완만'}</small>`;
        this.corner.style.color = ['#ffffff', '#ffd21f', '#ff9a2e', '#ff4d3d'][sev];
        L.ck = key;
      }
      this.corner.style.opacity = c.d < 6 ? 0.35 : 0.95;
    } else if (L.ck !== null) { this.corner.style.opacity = 0; L.ck = null; }
    if (h.warn) { const w = `⚠ ${h.warn.label} ${Math.round(h.warn.d / 10) * 10}m`; if (w !== L.w) { this.warn.textContent = w; this.warn.style.display = 'block'; L.w = w; } }
    else if (L.w) { this.warn.style.display = 'none'; L.w = null; }
    // 니트로
    if (this.nitroMax < 0) { this.nitroMax = h.nitro; document.getElementById('t-nitro').style.display = h.nitro > 0 ? 'flex' : 'none'; }
    const nk = `${h.nitro}/${this.nitroMax}`;
    if (nk !== L.nk) { this.nitro.innerHTML = Array.from({ length: this.nitroMax }, (_, i) => `<i class="${i < h.nitro ? 'on' : ''}"></i>`).join(''); L.nk = nk; }
    const tg = (h.boost ? '<span style="color:#4fd2ff">니트로</span>' : '') + (h.draft ? '<span style="color:#9be88f">슬립스트림</span>' : '') + (h.over ? '<span style="color:#ff8a7d">과속! 밀린다</span>' : '') + (h.wake ? '<span style="color:#ffd21f">할배 각성</span>' : '') + (h.wait ? '<span>할배가 기다리는 중</span>' : '');
    if (tg !== L.tg) { this.tags.innerHTML = tg; L.tg = tg; }
    const mk = this.mark || (this.mark = document.getElementById('h-mark'));
    if (h.mark) { mk.style.display = 'block'; mk.style.left = h.mark.x.toFixed(1) + '%'; mk.style.top = h.mark.y.toFixed(1) + '%'; if (this.frame % 5 === 0) mk.firstElementChild.textContent = `할배 ${Math.round(h.mark.d)}m`; }
    else if (mk.style.display !== 'none') mk.style.display = 'none';
    if (this.frame % 3 === 0) this._drawMap(game);
    if (this.sayTimer > 0) { this.sayTimer -= dt; if (this.sayTimer <= 0) this.sayEl.classList.remove('on'); }
    if (this.toastTimer > 0) { this.toastTimer -= dt; if (this.toastTimer <= 0) this.toastEl.style.opacity = 0; }
  }

  help(html, secs = 7) {
    const el = document.getElementById('h-help');
    el.innerHTML = html; el.style.display = html ? 'block' : 'none';
    clearTimeout(this._helpT);
    if (html) this._helpT = setTimeout(() => (el.style.display = 'none'), secs * 1000);
  }
  say(text) { this.sayT.textContent = text; this.sayEl.classList.add('on'); this.sayTimer = 3.4; }
  toast(text) { this.toastEl.textContent = text; this.toastEl.style.opacity = 1; this.toastTimer = 1.3; }
  count(n) {
    this.countEl.style.display = 'block';
    this.countEl.textContent = n > 0 ? n : '출발!';
    this.countEl.style.color = n > 0 ? '#fff' : '#ffd21f';
    if (n <= 0) setTimeout(() => (this.countEl.style.display = 'none'), 900);
  }
}
