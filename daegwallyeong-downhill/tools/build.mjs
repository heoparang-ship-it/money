// 빌드: 지도 데이터를 압축해 번들에 넣고, 게임 전체를 index.html 한 파일로 만든다.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rd = (f) => fs.readFileSync(path.join(root, f));
const meta = JSON.parse(rd('data/dem.json'));
function packI16(file, nx, ny) {
  const b = rd(file), a = new Int16Array(b.buffer, b.byteOffset, nx * ny), o = new Int16Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    const r = j * nx;
    o[r] = j > 0 ? a[r] - a[r - nx] : a[r];
    for (let i = 1; i < nx; i++) o[r + i] = a[r + i] - a[r + i - 1];
  }
  return zlib.gzipSync(Buffer.from(o.buffer), { level: 9 }).toString('base64');
}
const course = JSON.parse(rd('data/course.json'));
const features = JSON.parse(rd('data/features.json'));
const data = {
  course, meta, features,
  near: packI16('data/dem_near.i16', meta.near.nx, meta.near.ny),
  far: packI16('data/dem_far.i16', meta.far.nx, meta.far.ny),
  lc: zlib.gzipSync(rd('data/landcover.u8'), { level: 9 }).toString('base64'),
};
fs.writeFileSync(path.join(root, 'src/_data.generated.js'), `// 자동 생성 파일 (tools/build.mjs). 직접 고치지 마세요.\nexport default ${JSON.stringify(data)};\n`);

const dev = process.argv.includes('--dev');
async function bundle(artifact) {
  const res = await esbuild.build({
    entryPoints: [path.join(root, 'src/main.js')], bundle: true, format: 'iife', minify: !dev, target: ['es2020'],
    write: false, legalComments: 'none', charset: 'utf8', logLevel: 'warning',
    define: { __ARTIFACT__: artifact ? 'true' : 'false' },
  });
  return res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
}
// 도트 글꼴(갈무리11, 쓰는 글자만 추린 woff2)을 스타일시트 안에 넣는다
const b64 = (f) => rd(f).toString('base64');
let tpl = rd('tools/template.html').toString('utf8');
for (const [mark, file] of [['/*__FONT_R__*/', 'data/font/Galmuri11.sub.woff2'], ['/*__FONT_B__*/', 'data/font/Galmuri11-Bold.sub.woff2']]) {
  if (!tpl.includes(mark)) throw new Error('font marker missing: ' + mark);
  tpl = tpl.replace(mark, () => b64(file));
}
if (!tpl.includes('/*__BUNDLE__*/')) throw new Error('template marker missing');
const js = await bundle(false);
const html = tpl.replace('/*__BUNDLE__*/', () => js);
fs.writeFileSync(path.join(root, 'index.html'), html);
const kb = (n) => (n / 1024).toFixed(0) + ' KB';
console.log(`index.html ${kb(html.length)} (js ${kb(js.length)}, 고도 ${kb(data.near.length + data.far.length)}, 피처 ${kb(JSON.stringify(features).length)}, 글꼴 ${kb(b64('data/font/Galmuri11.sub.woff2').length + b64('data/font/Galmuri11-Bold.sub.woff2').length)})`);

// 클로드 아티팩트용: 뷰어가 문서 골격을 씌우므로 <html>/<head>/<body> 없이 내용만 내보낸다.
const art = process.argv.find((a) => a.startsWith('--artifact='));
if (art) {
  const style = tpl.match(/<style>[\s\S]*?<\/style>/)[0];
  const body = tpl.slice(tpl.indexOf('<body>') + 6, tpl.indexOf('</body>'));
  const out = `<title>대관령 다운힐 씨티백 레전드</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n${style}\n${body.replace('/*__BUNDLE__*/', () => '')}`;
  const js2 = await bundle(true);
  const page = out.replace('<script></script>', () => `<script>${js2}</script>`);
  if (!page.includes(js2.slice(0, 200))) throw new Error('artifact bundle not inlined');
  fs.writeFileSync(art.split('=')[1], page);
  console.log(`artifact ${kb(page.length)} → ${art.split('=')[1]}`);
}
