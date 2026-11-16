// 구글 지도 연동.
//  - 키 없이: 공식 Maps URL(스트리트뷰·위성지도 새 창), 지도 임베드.
//  - Google Maps Platform 키가 있으면: Map Tiles API 위성사진을 실제 지형에 입히고, Maps Embed API 스트리트뷰를 보여 준다.
// 키는 사용자가 설정 화면에 직접 넣으며 저장소·코드에는 절대 넣지 않는다.
import * as THREE from 'three';

const TILE = 'https://tile.googleapis.com';

export function streetViewLink(lat, lon, heading) {
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat.toFixed(7)},${lon.toFixed(7)}&heading=${Math.round(heading)}&pitch=0&fov=80`;
}
export function satelliteLink(lat, lon, zoom = 16) {
  return `https://www.google.com/maps/@?api=1&map_action=map&center=${lat.toFixed(7)},${lon.toFixed(7)}&zoom=${zoom}&basemap=satellite`;
}
export function embedUrl(lat, lon, heading, key) {
  if (key) return `https://www.google.com/maps/embed/v1/streetview?key=${encodeURIComponent(key)}&location=${lat.toFixed(7)},${lon.toFixed(7)}&heading=${Math.round(heading)}&pitch=0&fov=80`;
  return `https://www.google.com/maps?q=${lat.toFixed(7)},${lon.toFixed(7)}&z=16&t=k&output=embed`;
}

// Web Mercator 전역 픽셀 좌표 (256 px 타일)
export function mercPx(lon, lat, z) {
  const n = 256 * 2 ** z, la = (lat * Math.PI) / 180;
  return [((lon + 180) / 360) * n, ((1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2) * n];
}

export class GoogleTiles {
  constructor() { this.key = ''; this.token = null; this.expiry = 0; this.cache = new Map(); this.copyright = ''; this.lastError = ''; }
  setKey(k) { if (k !== this.key) { this.key = (k || '').trim(); this.token = null; this.cache.clear(); this.lastError = ''; } }
  get ready() { return !!this.key; }

  async session() {
    if (this.token && Date.now() / 1000 < this.expiry - 300) return this.token;
    const r = await fetch(`${TILE}/v1/createSession?key=${encodeURIComponent(this.key)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mapType: 'satellite', language: 'ko-KR', region: 'KR' }),
    });
    if (!r.ok) {
      let msg = `HTTP ${r.status}`;
      try { const j = await r.json(); if (j.error && j.error.message) msg = j.error.message; } catch (e) { /* 본문 없음 */ }
      throw new Error(msg);
    }
    const j = await r.json();
    this.token = j.session; this.expiry = Number(j.expiry) || Date.now() / 1000 + 3600;
    return this.token;
  }

  /** bbox(경위도)를 덮는 위성사진 모자이크. maxPx 안에 들어가는 가장 높은 줌을 고른다. */
  async mosaic(lonMin, latMin, lonMax, latMax, maxPx, zMax = 19, onProgress) {
    const ck = [lonMin, latMin, lonMax, latMax, maxPx].map((v) => v.toFixed(5)).join(',');
    if (this.cache.has(ck)) return this.cache.get(ck);
    const token = await this.session();
    let z = zMax, a, b;
    for (; z > 3; z--) {
      a = mercPx(lonMin, latMax, z); b = mercPx(lonMax, latMin, z);
      if (b[0] - a[0] <= maxPx && b[1] - a[1] <= maxPx) break;
    }
    const tx0 = Math.floor(a[0] / 256), ty0 = Math.floor(a[1] / 256), tx1 = Math.floor(b[0] / 256), ty1 = Math.floor(b[1] / 256);
    const W = (tx1 - tx0 + 1) * 256, H = (ty1 - ty0 + 1) * 256;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    g.fillStyle = '#3a5a34'; g.fillRect(0, 0, W, H);
    const jobs = [];
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) jobs.push([tx, ty]);
    let done = 0, failed = 0;
    const worker = async () => {
      while (jobs.length) {
        const [tx, ty] = jobs.pop();
        try {
          const r = await fetch(`${TILE}/v1/2dtiles/${z}/${tx}/${ty}?session=${token}&key=${encodeURIComponent(this.key)}`);
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const bmp = await createImageBitmap(await r.blob());
          g.drawImage(bmp, (tx - tx0) * 256, (ty - ty0) * 256);
          if (bmp.close) bmp.close();
        } catch (e) { failed++; }
        done++;
        if (onProgress) onProgress(done / ((tx1 - tx0 + 1) * (ty1 - ty0 + 1)));
      }
    };
    await Promise.all(Array.from({ length: 8 }, worker));
    if (failed > done * 0.5) throw new Error(`타일 ${failed}/${done}장 실패`);
    const m = { canvas: cv, z, px0: tx0 * 256, py0: ty0 * 256, W, H, lonMin, latMin, lonMax, latMax };
    this.cache.set(ck, m);
    // 저작권 표기 문자열
    try {
      const r = await fetch(`${TILE}/tile/v1/viewport?session=${token}&key=${encodeURIComponent(this.key)}&zoom=${z}&north=${latMax}&south=${latMin}&east=${lonMax}&west=${lonMin}`);
      if (r.ok) { const j = await r.json(); if (j.copyright) this.copyright = j.copyright; }
    } catch (e) { /* 표기 문자열만 못 받은 경우 기본 문구 사용 */ }
    return m;
  }

  /**
   * 지형용 위성사진 세트. nearBox/farBox: 지역좌표 [x0, z0, x1, z1].
   * 반환: { texNear, texFar, uv(x, z, near), inNear(x, z, size), attribution }
   */
  async build(proj, nearBox, farBox, maxPxNear, onProgress) {
    const ll = (bx) => { const a = proj.toLonLat(bx[0], bx[3]), b = proj.toLonLat(bx[2], bx[1]); return [a[0], a[1], b[0], b[1]]; };
    const nb = ll(nearBox), fb = ll(farBox);
    const far = await this.mosaic(fb[0], fb[1], fb[2], fb[3], 2048, 13, (p) => onProgress && onProgress(p * 0.3));
    const near = await this.mosaic(nb[0], nb[1], nb[2], nb[3], maxPxNear, 19, (p) => onProgress && onProgress(0.3 + p * 0.7));
    const mk = (m) => { const t = new THREE.CanvasTexture(m.canvas); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
    const uvOf = (m, x, z) => { const l = proj.toLonLat(x, z), p = mercPx(l[0], l[1], m.z); return [(p[0] - m.px0) / m.W, 1 - (p[1] - m.py0) / m.H]; };
    return {
      texNear: mk(near), texFar: mk(far), zoomNear: near.z,
      uv: (x, z, isNear) => uvOf(isNear ? near : far, x, z),
      inNear: (x, z, s) => x >= nearBox[0] && x + s <= nearBox[2] && z >= nearBox[1] && z + s <= nearBox[3],
      attribution: this.copyright || `지도 데이터 ©${new Date().getFullYear()} Google`,
    };
  }
}
