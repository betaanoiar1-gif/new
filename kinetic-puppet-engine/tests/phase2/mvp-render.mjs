// Phase 2 MVP: render examples/mvp-book-handoff.json to MP4 and measure it.
// Checks: MP4 validity, frame count, no unintended white/black frames, fine-grid continuity
// of the book and hands, DOM positions match the model, all arm targets reached, timing, RAM.
import { writeFileSync, mkdirSync } from 'node:fs';
import { loadStoryFile } from '../../src/director/load.js';
import { buildTimeline, sampleAt } from '../../src/motion/timeline.js';
import { composeMarkup } from '../../src/renderer/compose.js';
import { launchBrowser, renderToMp4, openScene } from '../../src/renderer/capture.js';
import { resolveFfmpeg } from '../../src/encoder/ffmpeg.js';
import { validateVideo } from '../../src/validator/video.js';
import { PeakMemorySampler } from '../../src/util/procstats.js';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const STORY = args.story ?? 'examples/mvp-book-handoff.json';
const OUT_DIR = args.out ?? 'output/mvp';
const OUT = `${OUT_DIR}/kpe-mvp.mp4`;
const format = args.format ?? 'png';
const TEMPLATE = 'templates/stage.html';
mkdirSync(OUT_DIR, { recursive: true });

const loaded = loadStoryFile(STORY);
if (!loaded.ok) { console.error(loaded.errors); process.exit(1); }
const story = loaded.scenario;
const model = buildTimeline(story);
const { width: W, height: H, fps, duration } = story.project;
const frameCount = Math.round(duration * fps);
const checks = [];
const check = (name, pass, detail) => { checks.push({ name, pass: !!pass, detail }); console.log(`[P2] ${pass ? 'PASS' : 'FAIL'} ${name}${detail !== undefined ? ' :: ' + JSON.stringify(detail) : ''}`); };

// 1) Model-level continuity on a fine grid (1/240 s): no jumps of the book or hands.
const GRID = 1 / 240;
let maxBookJump = 0, maxHandJump = 0, prev = null, allReached = true, nanSeen = false;
for (let t = 0; t <= duration + 1e-9; t += GRID) {
  const s = sampleAt(model, t);
  const cur = { book: s.props.book, hA: s.chars.A.solved.anchors.hand_L, hB: s.chars.B.solved.anchors.hand_R };
  if (!Number.isFinite(cur.book[0]) || !Number.isFinite(cur.book[1])) nanSeen = true;
  for (const side of ['L', 'R']) for (const c of ['A', 'B']) if (s.chars[c].solved.arms[side].status !== 'reached') allReached = false;
  if (prev) {
    maxBookJump = Math.max(maxBookJump, Math.hypot(cur.book[0] - prev.book[0], cur.book[1] - prev.book[1]));
    maxHandJump = Math.max(maxHandJump, Math.hypot(cur.hA.x - prev.hA.x, cur.hA.y - prev.hA.y), Math.hypot(cur.hB.x - prev.hB.x, cur.hB.y - prev.hB.y));
  }
  prev = cur;
}
check('book never jumps (max step per 1/240 s < 3 px)', maxBookJump < 3, { maxBookJumpPx: +maxBookJump.toFixed(3) });
check('hands never jump (max step per 1/240 s < 3 px)', maxHandJump < 3, { maxHandJumpPx: +maxHandJump.toFixed(3) });
check('every arm target reached on every 1/240 s sample', allReached);
check('no NaN in model state', !nanSeen);

// Book equals the receiver's hand exactly after the hand-off, and the giver's hand before it.
const after = sampleAt(model, 6.0), before = sampleAt(model, 4.0);
const gap = (a, b) => Math.hypot(a[0] - b.x, a[1] - b.y);   // array vs point
const gapPt = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);  // point vs point
check('after hand-off the book is in B\'s hand', gap(after.props.book, after.chars.B.solved.anchors.hand_R) < 1e-6);
check('during carry the book is in A\'s hand', gap(before.props.book, before.chars.A.solved.anchors.hand_L) < 1e-6);
check('B expression is neutral before the react, happy after', sampleAt(model, 5.5).chars.B.pose.expression === 'neutral' && sampleAt(model, 5.6).chars.B.pose.expression === 'happy');

// 2) Render the full clip.
const bins = await resolveFfmpeg();
const { browser, found } = await launchBrowser({ log: console.log });
const mem = new PeakMemorySampler(50).start();
let stats, domChecks = [];
try {
  stats = await renderToMp4({
    browser, ffmpeg: bins.ffmpeg, templatePath: TEMPLATE, output: OUT, width: W, height: H, fps, duration,
    format, quality: 90, requiredIds: ['stage', 'layer'],
    frameFn: (t) => composeMarkup(model, sampleAt(model, t), story),
  });
  const peak = mem.stop();
  stats.peakTreeMB = peak.peakTreeMB;
  stats.peakNodeMB = peak.peakNodeMB;

  // 3) DOM check at several times: rendered book and hands vs model.
  const page = await openScene(browser, TEMPLATE, { width: W, height: H, requiredIds: ['stage', 'layer'] });
  for (const t of [0.5, 1.8, 2.3, 3.7, 4.6, 4.9, 5.3, 5.6, 7.0, 7.95]) {
    const s = sampleAt(model, t);
    await page.evaluate((m) => window.__setFrame(m, ''), composeMarkup(model, s, story));
    const dom = await page.evaluate(() => {
      const r = (sel) => { const e = document.querySelector(sel); const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; };
      return { book: r('[data-prop="book"]'), hA: r('[data-anchor="hand_L"][data-char="A"]'), hB: r('[data-anchor="hand_R"][data-char="B"]') };
    });
    const eb = gap(s.props.book, { x: dom.book.x, y: dom.book.y });
    const ea = gapPt(s.chars.A.solved.anchors.hand_L, dom.hA);
    const eB = gapPt(s.chars.B.solved.anchors.hand_R, dom.hB);
    domChecks.push({ t, bookErrPx: +eb.toFixed(3), handAErrPx: +ea.toFixed(3), handBErrPx: +eB.toFixed(3) });
  }
  await page.close();
  check('DOM positions match the model (book, hands) within 0.5 px', domChecks.every((d) => d.bookErrPx < 0.5 && d.handAErrPx < 0.5 && d.handBErrPx < 0.5), domChecks);
} finally {
  await browser.close();
}
const peakMB = stats.peakTreeMB;
const v = validateVideo(OUT, bins, { width: W, height: H, fps, frames: frameCount, durationSec: duration, allowWhiteFrames: 0 });
for (const c of v.checks) checks.push({ name: `mp4: ${c.name}`, pass: c.pass, detail: c.actual });
check('MP4 passes validator (container, codec, size, fps, frames, decode, no white frames)', v.ok, v.checks.filter((c) => !c.pass).map((c) => c.name));
check('render time under 35 s (target)', stats.wallMs < 35000, { wallMs: stats.wallMs });
check('peak RAM under 700 MB (target)', peakMB < 700, { peakTreeMB: peakMB });

const ok = checks.every((c) => c.pass);
const result = {
  test: 'P2-mvp', pass: ok, story: STORY, format,
  env: { node: process.version, browser: found.version, browserPath: found.path, ffmpeg: bins.ffmpegVersion, cpus: (await import('node:os')).cpus().length },
  output: OUT, warnings: model.warnings,
  render: stats, mp4: { ...v.probe, lumaMin: v.probe.lumaMin, lumaMax: v.probe.lumaMax },
  continuity: { maxBookJumpPx: +maxBookJump.toFixed(3), maxHandJumpPx: +maxHandJump.toFixed(3), gridSec: GRID },
  domChecks, checks,
};
writeFileSync(`${OUT_DIR}/mvp-results.json`, JSON.stringify(result, null, 2));
console.log(`[P2] render ${stats.wallMs} ms, ${stats.msPerFrame} ms/frame, peakTree ${peakMB} MB, size ${v.probe.sizeBytes} B, frames ${v.probe.framesCounted}`);
console.log(`[P2] overall ${ok ? 'PASS' : 'FAIL'}`);
process.exitCode = ok ? 0 : 1;
