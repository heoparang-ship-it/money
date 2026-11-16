// 번들에 포함된 실제 지도 데이터(코스·고도·피처)를 풀어 게임 객체로 만든다.
import packed from './_data.generated.js';
import { makeProjection, Dem, LandCover } from './geo.js';
import { Track } from './track.js';

async function gunzipB64(b64) {
  const bin = atob(b64), u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  if (typeof DecompressionStream === 'undefined') throw new Error('이 브라우저는 너무 오래되어 실행할 수 없습니다 (DecompressionStream 미지원).');
  const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
function undelta(u8, nx, ny) {
  const a = new Int16Array(u8.buffer, u8.byteOffset, nx * ny);
  for (let j = 0; j < ny; j++) {
    const o = j * nx;
    if (j > 0) a[o] = (a[o] + a[o - nx]) | 0;
    for (let i = 1; i < nx; i++) a[o + i] = (a[o + i] + a[o + i - 1]) | 0;
  }
  return a;
}

export async function loadWorldData() {
  const { course, meta, features } = packed;
  const [near, far, lc] = await Promise.all([gunzipB64(packed.near), gunzipB64(packed.far), gunzipB64(packed.lc)]);
  const proj = makeProjection(meta.lon0, meta.lat0, meta.R);
  const dem = new Dem(meta, undelta(near, meta.near.nx, meta.near.ny), undelta(far, meta.far.nx, meta.far.ny));
  const landcover = new LandCover(features.landcover, lc);
  const track = new Track(course, proj, dem, features);
  return { course, meta, features, proj, dem, landcover, track };
}
