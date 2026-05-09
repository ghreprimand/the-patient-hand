// Dev-only smoke test (NOT shipped, NOT a runtime dep): open the running
// dev server in a real Chromium with WebGL2, capture console + page errors,
// and screenshot.  Used during overnight build to verify the glass shader
// compiles + draws something non-trivial before committing.
//
//   node scripts/shader-smoke.mjs http://localhost:5175/ [out.png]
//
// Uses the playwright build cached under ~/.npm/_npx by previous npx runs
// so it doesn't add a project dependency.

// Playwright import: try the project node_modules first, then fall back to
// any installed-by-npx cache.  We don't want playwright as a project dep
// (heavy, dev-only).  If neither path finds it, prompt the operator.
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
  console.error(
    'playwright not found.  Run once to populate the npx cache:\n' +
      '  npx --yes playwright@1.59 --version',
  );
  process.exit(2);
}
const { chromium } = await import(pathToFileURL(playwrightPath).href);

const url = process.argv[2] || 'http://localhost:5175/';
const outPath = process.argv[3] || '/tmp/tph-shader-smoke.png';

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
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

// Known-noisy GL driver messages that SwiftShader emits whenever readPixels
// is called (i.e. when we screenshot).  Not our bugs.
const noiseRe = /GPU stall due to ReadPixels|GL_CLOSE_PATH_NV/i;
page.on('console', (m) => {
  const t = m.type();
  if (t !== 'error' && t !== 'warning') return;
  const text = m.text();
  if (noiseRe.test(text)) return;
  errors.push(`console.${t}: ${text}`);
});

await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
await page.waitForTimeout(700);

const probe = await page.evaluate(() => {
  const c = /** @type {HTMLCanvasElement} */ (document.querySelector('#stage'));
  if (!c) return { ok: false, why: 'no canvas' };
  const gl = c.getContext('webgl2');
  if (!gl) return { ok: false, why: 'no webgl2' };
  return {
    ok: true,
    contextLost: gl.isContextLost(),
    width: c.width,
    height: c.height,
    glError: gl.getError(),
    bootstrapErrorOverlay:
      !!document.querySelector('pre[style*="parchment"]') ||
      document.body.innerText.includes('could not start'),
  };
});

// Take the screenshot through the compositor — sidesteps
// preserveDrawingBuffer:false issues and gives us actual pixels.
const screenshotBuf = await page.screenshot({ path: outPath, fullPage: false });
await browser.close();

// Decode the PNG IDAT and walk pixels.  Avoid pulling in `pngjs` etc; use
// the platform-provided ImageDecoder if available, otherwise rely on a
// minimal hand-rolled PNG sampler that grabs every Nth pixel by parsing
// chunks.  Easiest: re-open headless to use OffscreenCanvas... actually
// just shell-out to node's WICG `ImageData` is not available, but we can
// use the screenshot's filesize / a much simpler approach: open the image
// in a fresh chromium tab, drawImage onto a 2D canvas, sample. That works.
const browser2 = await chromium.launch({ args: ['--no-sandbox'] });
const page2 = await browser2.newPage();
const dataUrl = 'data:image/png;base64,' + screenshotBuf.toString('base64');
await page2.setContent(`<img id="i" src="${dataUrl}">`);
await page2.waitForFunction(() => {
  const i = /** @type {HTMLImageElement} */ (document.getElementById('i'));
  return i && i.complete && i.naturalWidth > 0;
});
const pixelStats = await page2.evaluate(() => {
  const i = /** @type {HTMLImageElement} */ (document.getElementById('i'));
  const cv = document.createElement('canvas');
  cv.width = 96;
  cv.height = 72;
  const cx = cv.getContext('2d');
  cx.drawImage(i, 0, 0, cv.width, cv.height);
  const id = cx.getImageData(0, 0, cv.width, cv.height);
  const seen = new Set();
  let maxR = 0,
    maxG = 0,
    maxB = 0;
  let warmCount = 0;
  let brightCount = 0;
  let redLiquidCount = 0;
  for (let p = 0; p < id.data.length; p += 4) {
    const r = id.data[p],
      g = id.data[p + 1],
      b = id.data[p + 2];
    seen.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
    if (r > maxR) maxR = r;
    if (g > maxG) maxG = g;
    if (b > maxB) maxB = b;
    if (r > 60 && r > b + 8 && g < r) warmCount++;
    if (r + g + b > 480) brightCount++;
    if (r > 110 && r > g + 25 && r > b + 25) redLiquidCount++;
  }
  return {
    uniqueBuckets: seen.size,
    maxR,
    maxG,
    maxB,
    warmCount,
    brightCount,
    redLiquidCount,
    totalSamples: (id.data.length / 4) | 0,
  };
});
await browser2.close();
probe.pixelStats = pixelStats;

console.log(JSON.stringify({ probe, errors }, null, 2));

const fail = [];
if (errors.length) fail.push(`${errors.length} console/page errors`);
if (!probe.ok) fail.push(`probe: ${probe.why}`);
if (probe.ok) {
  if (probe.bootstrapErrorOverlay) fail.push('bootstrap error overlay rendered');
  if (probe.contextLost) fail.push('GL context lost');
  if (probe.glError !== 0) fail.push(`gl.getError = ${probe.glError}`);
  if (probe.pixelStats.uniqueBuckets < 24)
    fail.push(`canvas too monochrome (${probe.pixelStats.uniqueBuckets} buckets)`);
  if (probe.pixelStats.warmCount < 80)
    fail.push(`too few warm pixels — backdrop missing? (${probe.pixelStats.warmCount})`);
  if (probe.pixelStats.redLiquidCount < 6)
    fail.push(`liquid not visible (${probe.pixelStats.redLiquidCount} red pixels)`);
}

if (fail.length) {
  console.error('FAIL: ' + fail.join('; '));
  process.exit(1);
}
console.log('OK: shader compiled, drew non-trivial scene');
