// Records the canvas as PNG frames for the README GIF.
// Needs a local server (npm run serve) and Chrome; install puppeteer-core separately:
//   npm i --no-save puppeteer-core
//   node tools/record-frames.mjs "http://localhost:8000/?demo=tidy%20up&speed=45#house-3" /tmp/frames 110
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const [, , url, dir = '/tmp/frames', count = '100', chrome = '/usr/bin/google-chrome'] = process.argv;
mkdirSync(dir, { recursive: true });
const browser = await puppeteer.launch({ executablePath: chrome, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1100, height: 900, deviceScaleFactor: 1 });
await page.goto(url, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 500));
for (let i = 0; i < Number(count); i++) {
  const data = await page.evaluate(() => document.getElementById('plan').toDataURL('image/png'));
  writeFileSync(`${dir}/f${String(i).padStart(4, '0')}.png`, Buffer.from(data.split(',')[1], 'base64'));
  await new Promise((r) => setTimeout(r, 100));
}
await browser.close();
