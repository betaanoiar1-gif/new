// Phase 1 gate (browser part): the hand anchor must land on each target in the RENDERED DOM,
// not only in the math. Also checks recomputation (same pose -> same markup, any order).
import { writeFileSync, mkdirSync } from 'node:fs';
import { launchBrowser, openScene } from '../../src/renderer/capture.js';
import { renderCharacter } from '../../src/rig/character.js';

const OUT = 'output/phase1';
mkdirSync(OUT, { recursive: true });
const TEMPLATE = 'templates/stage.html';
const ROOT = { x: 360, y: 930 };
const TOL = 0.5; // px, measured in the rendered DOM

// Targets: the preliminary y values from the brief, for both hands, plus one unreachable case.
const cases = [
  { name: 'R-800', arm: 'R', target: { x: 430, y: 800 } },
  { name: 'R-900', arm: 'R', target: { x: 440, y: 900 } },
  { name: 'R-1000', arm: 'R', target: { x: 430, y: 1000 } },
  { name: 'L-800', arm: 'L', target: { x: 290, y: 800 } },
  { name: 'L-900', arm: 'L', target: { x: 280, y: 900 } },
  { name: 'L-1000', arm: 'L', target: { x: 290, y: 1000 } },
  { name: 'R-unreachable-1100', arm: 'R', target: { x: 430, y: 1100 }, expectClamp: true },
];

const pose = (arm, target) => ({ root: ROOT, arms: { [arm]: target }, expression: 'neutral' });
const markupFor = (c) => renderCharacter({ id: 'A', pose: pose(c.arm, c.target) });

// Recomputation: same inputs give identical markup, regardless of what was solved before.
const first = cases.map((c) => markupFor(c).svg);
const reversed = [...cases].reverse().map((c) => markupFor(c).svg).reverse();
const recomputeOk = first.every((m, i) => m === reversed[i]);
const noNaN = first.every((m) => !/NaN|Infinity/.test(m));

const { browser, found } = await launchBrowser();
const results = [];
try {
  const page = await openScene(browser, TEMPLATE, { width: 720, height: 1280, requiredIds: ['stage', 'layer'] });
  for (const c of cases) {
    const { svg, solved } = markupFor(c);
    const arm = solved.arms[c.arm];
    const debug = `<circle cx="${c.target.x}" cy="${c.target.y}" r="7" fill="none" stroke="#dc2626" stroke-width="3"/>` +
      `<line x1="${c.target.x - 12}" y1="${c.target.y}" x2="${c.target.x + 12}" y2="${c.target.y}" stroke="#dc2626" stroke-width="2"/>` +
      `<line x1="${c.target.x}" y1="${c.target.y - 12}" x2="${c.target.x}" y2="${c.target.y + 12}" stroke="#dc2626" stroke-width="2"/>`;
    await page.evaluate((m, d) => window.__setFrame(m, d), svg, debug);
    const measured = await page.evaluate((side) => {
      const el = document.querySelector(`[data-anchor="hand_${side}"]`);
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, count: document.querySelectorAll(`[data-anchor="hand_${side}"]`).length };
    }, c.arm);
    const errToTarget = Math.hypot(measured.x - c.target.x, measured.y - c.target.y);
    const errToSolved = Math.hypot(measured.x - arm.hand.x, measured.y - arm.hand.y);
    const pass = c.expectClamp
      ? arm.status === 'clamped_far' && errToSolved < TOL && measured.count === 1
      : arm.status === 'reached' && errToTarget < TOL && measured.count === 1;
    const shotPath = `${OUT}/ik-${c.name}.png`;
    await page.screenshot({ path: shotPath, type: 'png' });
    results.push({ case: c.name, arm: c.arm, target: c.target, status: arm.status, reachable: arm.reachable,
      renderedHand: { x: +measured.x.toFixed(2), y: +measured.y.toFixed(2) },
      errToTargetPx: +errToTarget.toFixed(3), errToSolvedPx: +errToSolved.toFixed(3),
      solverReachError: +arm.reachError.toFixed(3), boneErr: arm.boneError, pass, screenshot: shotPath });
    console.log(`[P1] ${pass ? 'PASS' : 'FAIL'} ${c.name}: status=${arm.status} rendered=(${measured.x.toFixed(1)},${measured.y.toFixed(1)}) errToTarget=${errToTarget.toFixed(3)}px`);
  }
  // Rig looks: a 3-pose strip rendered together, used for visual inspection.
  const strip = cases.slice(0, 3).map((c, i) => renderCharacter({ id: `S${i}`, pose: pose(c.arm, c.target), style: i === 1 ? { skin: '#8d5524', shirt: '#16a34a', hair: '#111111', pants: '#7c2d12' } : {} }).svg).join('');
  await page.evaluate((m) => window.__setFrame(m, ''), strip);
  await page.screenshot({ path: `${OUT}/ik-strip.png`, type: 'png' });
} finally {
  await browser.close();
}

const pass = results.every((r) => r.pass) && recomputeOk && noNaN;
const out = { test: 'P1-rig-ik-browser', pass, tolerancePx: TOL, recomputeOk, noNaN, browser: found.version, cases: results };
writeFileSync(`${OUT}/p1-results.json`, JSON.stringify(out, null, 2));
console.log(`[P1] recompute=${recomputeOk} noNaN=${noNaN} overall=${pass ? 'PASS' : 'FAIL'}`);
process.exitCode = pass ? 0 : 1;
