// Day 5 smoke test: scripts a click sequence to start a pour, then
// captures a screenshot mid-animation to prove the tilt + layer-drain
// rendering path works end-to-end.

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';

function findPlaywright() {
  const tryPaths = [
    join(process.cwd(), 'node_modules', 'playwright', 'index.mjs'),
  ];
  const npxRoot = join(homedir(), '.npm', '_npx');
  if (existsSync(npxRoot)) {
    for (const dir of readdirSync(npxRoot)) {
      tryPaths.push(join(npxRoot, dir, 'node_modules', 'playwright', 'index.mjs'));
    }
  }
  for (const p of tryPaths) if (existsSync(p)) return p;
  return null;
}

const playwrightPath = findPlaywright();
if (!playwrightPath) {
  console.error('playwright not found.');
  process.exit(2);
}
const { chromium } = await import(pathToFileURL(playwrightPath).href);

const url = process.argv[2] || 'http://localhost:5175/';
const out = process.argv[3] || '/tmp/tph-day5-pour.png';

const browser = await chromium.launch({
  args: [
    '--use-gl=swiftshader',
    '--enable-webgl2',
    '--ignore-gpu-blocklist',
    '--disable-dev-shm-usage',
    '--no-sandbox',
  ],
});
const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 } });
const page = await ctx.newPage();

const errors = [];
const noiseRe = /GPU stall due to ReadPixels|GL_CLOSE_PATH_NV/i;
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  const t = m.type();
  if (t !== 'error' && t !== 'warning') return;
  const txt = m.text();
  if (noiseRe.test(txt)) return;
  errors.push(`${t}: ${txt}`);
});

await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
await page.waitForTimeout(400);

// Level 001 has 4 tubes laid out across 1024 wide.  Tube spacing in
// tube-space is TUBE_RADIUS * 2.7 = 0.115 * 2.7 = 0.3105.  4 tubes
// centered around x=0: [-0.466, -0.155, 0.155, 0.466] in tube-space.
// At aspect 1024/768 ≈ 1.333, tube-space x range is [-1.333, +1.333],
// so screen-x = (tubeX/aspect + 1) * 0.5 * 1024.
const aspect = 1024 / 768;
const tubeX = [-0.466, -0.155, 0.155, 0.466];
function screenXof(tx) { return ((tx / aspect) + 1) * 0.5 * 1024; }
// Tube cy ≈ -0.36 + 0.42 - 0.01 = 0.05; in screen-space:
//   uv.y = (cy + 1) / 2 = 0.525, screen-y = (1 - 0.525) * 768 ≈ 364
const tubeY = ((0.05 + 1) / 2) * 768; // y up in tube-space; flipped for DOM
const screenY = 768 - tubeY;

// Click tube[0] (cinnabar/lapis striped) then tube[2] (empty).
// canPour(t0, t2) is true: t0 has tokens, t2 is empty.
await page.mouse.click(screenXof(tubeX[0]), screenY);
await page.waitForTimeout(40); // give the click handler a frame
await page.mouse.click(screenXof(tubeX[2]), screenY);

// Pour anim: 0.18 (tilt-up) + 0.16 * 0.85 (cinnabar visc) (drain 1 token)
// + 0.18 (tilt-down) ≈ 0.50s for a 1-token pour.
// Capture mid-drain: wait 0.18 + 0.05 ≈ 230ms.
await page.waitForTimeout(240);
await page.screenshot({ path: out, fullPage: false });
await browser.close();

console.log(JSON.stringify({ errors }, null, 2));
process.exit(errors.length ? 1 : 0);
