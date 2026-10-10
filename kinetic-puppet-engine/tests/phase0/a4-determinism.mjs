// A4: render determinism and time control.
//  1) Timeline driven by absolute time (__seek) must give identical pixels for a given t,
//     regardless of request order, repetition, idle time, page instance, or browser process.
//  2) Incremental tick(dt) integration is history dependent; this test measures how.
//  3) Timeline numeric check: seek(t) must place the element where the easing says it should.
import { createHash } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { launchBrowser, openScene } from '../../src/renderer/capture.js';

const TEMPLATE = 'templates/phase0-timeline.html';
const OUT = 'output/phase0';
mkdirSync(OUT, { recursive: true });
const sha = (b) => createHash('sha256').update(b).digest('hex').slice(0, 16);
const FPS = 24;
const checks = [];
const check = (name, pass, detail) => { checks.push({ name, pass, detail }); console.log(`[A4] ${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + detail : ''}`); };

async function shot(page, t, type = 'png') {
  await page.evaluate((tt) => window.__seek(tt), t);
  return page.screenshot(type === 'png' ? { type: 'png' } : { type: 'jpeg', quality: 90 });
}

const { browser: b1, found } = await launchBrowser({ log: console.log });
let b2 = null;
const details = {};
try {
  const page = await openScene(b1, TEMPLATE, { width: 720, height: 1280, requiredIds: ['stage', 'ball', 'spinner', 'label', 'tick'] });

  // 1) Order / repetition independence.
  const order = [1.0, 0.25, 3.5, 1.0, 6.0, 0.25, 1.0, 7.9, 1.0];
  const hashes = [];
  for (const t of order) hashes.push({ t, h: sha(await shot(page, t)) });
  const byT = (t) => [...new Set(hashes.filter((x) => x.t === t).map((x) => x.h))];
  check('seek: t=1.0 identical across 4 requests separated by other times', byT(1).length === 1, `${byT(1).length} distinct`);
  check('seek: t=0.25 identical across 2 requests', byT(0.25).length === 1);
  details.hashesByTime = Object.fromEntries([0.25, 1, 3.5, 6, 7.9].map((t) => [t, byT(t)[0]]));
  check('seek: frames differ when time differs (not a constant render)', new Set(hashes.map((x) => x.h)).size >= 5, `${new Set(hashes.map((x) => x.h)).size} distinct frames`);

  // Idle stability: wait while the page is idle, then re-request.
  await new Promise((r) => setTimeout(r, 1200));
  const idle = sha(await shot(page, 1.0));
  check('seek: identical after 1.2 s idle (no drifting ticker)', idle === byT(1)[0]);

  // JPEG determinism.
  const j1 = sha(await shot(page, 2.0, 'jpeg'));
  await shot(page, 5.0, 'jpeg');
  const j2 = sha(await shot(page, 2.0, 'jpeg'));
  check('seek: JPEG q90 bytes identical for same t', j1 === j2);

  // 2) Fresh page and fresh browser process.
  const fresh = await openScene(b1, TEMPLATE, { width: 720, height: 1280, requiredIds: ['stage'] });
  check('seek: fresh page reproduces t=1.0', sha(await shot(fresh, 1.0)) === byT(1)[0]);
  await fresh.close();
  b2 = (await launchBrowser()).browser;
  const p2 = await openScene(b2, TEMPLATE, { width: 720, height: 1280, requiredIds: ['stage'] });
  check('seek: separate browser process reproduces t=1.0', sha(await shot(p2, 1.0)) === byT(1)[0], `process ${found.version}`);
  await p2.close();

  // 3) Numeric time control. GSAP naming: 'power2' = cubic (power1 = quad), so
  //    power2.inOut(p) = 4p^3 for p<0.5 and 1-(-2p+2)^3/2 otherwise. Ball: x 0->600 over 4 s.
  const cubicInOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
  const expectX = (t) => 600 * cubicInOut(Math.min(1, Math.max(0, t / 4)));
  const numeric = {};
  for (const t of [0.5, 1, 2, 3.25, 4, 6]) {
    await page.evaluate((tt) => window.__seek(tt), t);
    const x = await page.evaluate(() => gsap.getProperty('#ball', 'x'));
    numeric[t] = { x: +x.toFixed(4), expected: +expectX(t).toFixed(4) };
  }
  const maxDev = Math.max(...Object.values(numeric).map((v) => Math.abs(v.x - v.expected)));
  check('time: seek(t) places ball on the easing curve at 6 sampled times', maxDev < 1e-3, `max deviation ${maxDev.toExponential(2)} px`);
  details.seekNumeric = numeric;

  // 4) Tick(dt) history dependence. Same target time t=1.0 reached three ways.
  const dt = 1 / FPS;
  const stepTo = (page2, frames) => page2.evaluate((n, d) => { window.__tickReset(); for (let i = 0; i < n; i++) window.__tickStep(d); return window.__tick.x; }, frames, dt);
  // (a) pure sequential replay
  await stepTo(page, 24);
  const hSeq = sha(await page.screenshot({ type: 'png' }));
  const xSeq = await page.evaluate(() => window.__tick.x);
  // (b) a duplicated step (retry / re-requested frame without reset)
  await page.evaluate(() => { window.__tickReset(); for (let i = 0; i < 24; i++) window.__tickStep(1 / 24); window.__tickStep(1 / 24); });
  const xDup = await page.evaluate(() => window.__tick.x);
  // (c) same frame index reached with a skipped frame (dt doubled once)
  await page.evaluate(() => { window.__tickReset(); for (let i = 0; i < 12; i++) window.__tickStep(1 / 24); window.__tickStep(2 / 24); for (let i = 0; i < 11; i++) window.__tickStep(1 / 24); });
  const xSkip = await page.evaluate(() => window.__tick.x);
  // (d) repeat sequential: must match (a) exactly
  await stepTo(page, 24);
  const xSeq2 = await page.evaluate(() => window.__tick.x);
  check('tick: sequential replay from reset is reproducible', xSeq === xSeq2, `${xSeq}`);
  check('tick: duplicated step changes the state (history dependent)', Math.abs(xDup - xSeq) > 1e-6, `seq=${xSeq.toFixed(4)} dup=${xDup.toFixed(4)}`);
  check('tick: skipped/resized step changes the state', Math.abs(xSkip - xSeq) > 1e-6, `seq=${xSeq.toFixed(4)} skip=${xSkip.toFixed(4)}`);
  // Float accumulation of dt versus i/fps.
  let acc = 0, maxErr = 0;
  for (let i = 1; i <= 24 * 60; i++) { acc += dt; maxErr = Math.max(maxErr, Math.abs(acc - i / FPS)); }
  check('tick: accumulated dt over 60 s stays within 1e-9 s of i/fps', maxErr < 1e-9, `max error ${maxErr.toExponential(2)} s`);
  details.tick = { xSeq, xDup, xSkip, accumulatedMaxErrSec: maxErr };
  details.determinismNote = 'Seek-based frames are byte-identical across order, idle time, JPEG repeat, page instance and browser process in this scene. Tick-based state is path dependent; any retry or skipped frame changes it.';
} finally {
  await b1.close();
  if (b2) await b2.close();
}

const pass = checks.every((c) => c.pass);
writeFileSync(`${OUT}/a4-results.json`, JSON.stringify({ test: 'A4', browser: found.version, fps: FPS, pass, checks, details }, null, 2));
console.log(`[A4] overall ${pass ? 'PASS' : 'FAIL'} (${checks.filter((c) => c.pass).length}/${checks.length})`);
process.exitCode = pass ? 0 : 1;
