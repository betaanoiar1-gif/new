// A2: browser discovery. Lists every candidate actually probed, the one selected,
// and verifies it can launch and render a page. No fixed path is assumed.
import { writeFileSync, mkdirSync, existsSync, accessSync, constants } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { findBrowser, probeVersion } from '../../src/renderer/chrome.js';
import { launchBrowser } from '../../src/renderer/capture.js';

mkdirSync('output/phase0', { recursive: true });
const probed = [];
const fixed = ['/opt/chrome-linux64/chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/snap/bin/chromium'];
for (const name of ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable', 'chrome']) {
  const r = spawnSync('which', [name], { encoding: 'utf8' });
  probed.push({ how: `PATH:${name}`, found: r.status === 0 ? r.stdout.trim() : null });
}
for (const p of fixed) probed.push({ how: 'fixed-path', path: p, exists: existsSync(p) });

const found = await findBrowser({ log: (m) => console.log('[A2]', m) });
const { browser } = await launchBrowser();
let render;
try {
  const page = await browser.newPage();
  await page.setContent('<div id="a" style="width:100px;height:50px;background:#f00"></div>');
  const w = await page.$eval('#a', (e) => e.getBoundingClientRect().width);
  const png = await page.screenshot({ type: 'png' });
  render = { layoutWidth: w, pngSignature: png.slice(1, 4).toString('ascii') === 'PNG', pngBytes: png.length };
  await page.close();
  render.browserVersion = await browser.version();
  render.userAgent = await (await browser.newPage()).evaluate(() => navigator.userAgent);
} finally {
  await browser.close();
}
const pass = render.layoutWidth === 100 && render.pngSignature;
const result = {
  test: 'A2', pass,
  selected: { path: found.path, version: found.version, source: found.source },
  probed,
  renderCheck: render,
  note: 'System Chrome absent on this host (apt mirrors unreachable). Bundled Chromium from npm used, with its AL2023 libs extracted to /tmp/kpe-al2023 and LD_LIBRARY_PATH set for the launch.',
};
writeFileSync('output/phase0/a2-browser.json', JSON.stringify(result, null, 2));
console.log(`[A2] ${pass ? 'PASS' : 'FAIL'} selected=${found.path} (${found.version}) source=${found.source}`);
console.log('[A2] render check:', JSON.stringify(render));
process.exitCode = pass ? 0 : 1;
