// Node에서 원자료를 직접 읽어 게임과 같은 객체(Track 등)를 만든다 (시뮬레이션·분석용).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeProjection, Dem, LandCover } from '../../src/geo.js';
import { Track } from '../../src/track.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data');
const i16 = (f) => { const b = fs.readFileSync(path.join(root, f)); return new Int16Array(b.buffer, b.byteOffset, b.length / 2); };

export function loadWorldData() {
  const course = JSON.parse(fs.readFileSync(path.join(root, 'course.json'), 'utf8'));
  const meta = JSON.parse(fs.readFileSync(path.join(root, 'dem.json'), 'utf8'));
  const features = JSON.parse(fs.readFileSync(path.join(root, 'features.json'), 'utf8'));
  const proj = makeProjection(meta.lon0, meta.lat0, meta.R);
  const dem = new Dem(meta, i16('dem_near.i16'), i16('dem_far.i16'));
  const lcb = fs.readFileSync(path.join(root, 'landcover.u8'));
  const landcover = new LandCover(features.landcover, new Uint8Array(lcb.buffer, lcb.byteOffset, lcb.length));
  const track = new Track(course, proj, dem, features);
  return { course, meta, features, proj, dem, landcover, track };
}
