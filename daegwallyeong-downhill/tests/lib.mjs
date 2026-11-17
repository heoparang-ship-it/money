// 테스트 공용: 정적 서버 + 헤드리스 크로미움 (Canvas 2D라 GPU 옵션이 필요 없다).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SHOTS = path.join(ROOT, 'tests/shots');

export async function launch() {
  const { chromium } = require('playwright');
  fs.mkdirSync(SHOTS, { recursive: true });
  const server = http.createServer((req, res) => {
    fs.readFile(path.join(ROOT, 'index.html'), (e, d) => {
      if (e) { res.writeHead(500); res.end(String(e)); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(d);
    });
  }).listen(0);
  const browser = await chromium.launch();
  const url = (q = '') => `http://127.0.0.1:${server.address().port}/index.html?${q}`;
  const close = async () => { await browser.close(); server.close(); };
  return { browser, url, close };
}

export async function openGame(browser, url, { width = 800, height = 450, dpr = 1, init } = {}) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: dpr });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  if (init) await page.addInitScript(init);
  await page.goto(url);
  await page.waitForFunction(() => window.__dh && window.__dh.game && window.__dh.game.world && window.__dh.game.mode !== 'loading' && window.__dh.game.mode !== 'boot', null, { timeout: 60000 });
  return { page, errors };
}

export function check(name, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!cond) process.exitCode = 1;
}
