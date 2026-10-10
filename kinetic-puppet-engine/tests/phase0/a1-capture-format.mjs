// A1: PNG vs JPEG frame capture + FFmpeg encode, 720x1280, 8 s, at 24 and 30 fps.
// Usage: node tests/phase0/a1-capture-format.mjs [--reps=3] [--duration=8] [--fps=24,30]
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { launchBrowser, renderToMp4, avg } from '../../src/renderer/capture.js';
import { resolveFfmpeg } from '../../src/encoder/ffmpeg.js';
import { validateVideo } from '../../src/validator/video.js';
import { PeakMemorySampler } from '../../src/util/procstats.js';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const reps = Number(args.reps ?? 3);
const duration = Number(args.duration ?? 8);
const fpsList = String(args.fps ?? '24,30').split(',').map(Number);
const W = 720, H = 1280;
const OUT = 'output/phase0/a1';
const TEMPLATE = 'templates/phase0-static.html';
mkdirSync(OUT, { recursive: true });

const bins = await resolveFfmpeg();
const { browser, found } = await launchBrowser({ log: console.log });
const runs = [];

try {
  for (const fps of fpsList) {
    for (let rep = 0; rep < reps; rep += 1) {
      // Alternate order each repetition so warm-up effects do not favour one format.
      const order = rep % 2 === 0 ? ['png', 'jpeg'] : ['jpeg', 'png'];
      for (const format of order) {
        const out = `${OUT}/run-${format}-${fps}fps-r${rep}.mp4`;
        const mem = new PeakMemorySampler(50).start();
        const stats = await renderToMp4({
          browser, ffmpeg: bins.ffmpeg, templatePath: TEMPLATE, output: out,
          width: W, height: H, fps, duration, format, quality: 90, requiredIds: ['stage'],
        });
        const peak = mem.stop();
        const v = validateVideo(out, bins, { width: W, height: H, fps, frames: Math.round(duration * fps), durationSec: duration });
        if (!v.ok) throw new Error(`video validation failed for ${out}: ${JSON.stringify(v.checks.filter((c) => !c.pass))}`);
        runs.push({ ...stats, rep, peakTreeMB: peak.peakTreeMB, peakNodeMB: peak.peakNodeMB, sizeBytes: v.probe.sizeBytes, codec: v.probe.codec, pixFmt: v.probe.pixFmt, probeFps: v.probe.avgFps, probeDuration: +v.probe.durationSec.toFixed(3), framesDecoded: v.probe.framesCounted, validatorOk: v.ok });
        console.log(`[A1] ${format} ${fps}fps r${rep}: wall=${stats.wallMs}ms ms/frame=${stats.msPerFrame} capture=${stats.captureMsAvg}ms bytes=${stats.bytesSent} peakTree=${peak.peakTreeMB}MB size=${v.probe.sizeBytes} frames=${v.probe.framesCounted}`);
      }
    }
  }

  // Visual comparison: one frame at t=0 as PNG (reference) vs JPEG at several qualities, measured in the browser.
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  const { pathToFileURL } = await import('node:url');
  const { resolve } = await import('node:path');
  await page.goto(pathToFileURL(resolve(TEMPLATE)).href, { waitUntil: 'load' });
  await page.waitForFunction('window.__kpeReady === true');
  const refPng = await page.screenshot({ type: 'png' });
  writeFileSync(`${OUT}/frame-ref.png`, refPng);
  const qualities = [60, 75, 90, 95];
  const quality = [];
  for (const q of qualities) {
    const jpg = await page.screenshot({ type: 'jpeg', quality: q });
    const c0 = performance.now();
    const jpg2 = await page.screenshot({ type: 'jpeg', quality: q });
    const jpegMs = performance.now() - c0;
    const cmp = await page.evaluate(async (refB64, jpgB64) => {
      const load = (b64) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = 'data:image/png;base64,' + b64; });
      const a = await load(refB64);
      const jpgImg = new Image();
      await new Promise((res, rej) => { jpgImg.onload = res; jpgImg.onerror = rej; jpgImg.src = 'data:image/jpeg;base64,' + jpgB64; });
      const w = a.width, h = a.height;
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      const ctx = cv.getContext('2d');
      ctx.drawImage(a, 0, 0); const d1 = ctx.getImageData(0, 0, w, h).data;
      ctx.clearRect(0, 0, w, h); ctx.drawImage(jpgImg, 0, 0); const d2 = ctx.getImageData(0, 0, w, h).data;
      let se = 0, mae = 0;
      for (let i = 0; i < d1.length; i += 4) for (let k = 0; k < 3; k++) { const e = d1[i + k] - d2[i + k]; se += e * e; mae += Math.abs(e); }
      const n = (d1.length / 4) * 3;
      const mse = se / n;
      return { mae: +(mae / n).toFixed(3), psnrDb: +(10 * Math.log10(255 * 255 / Math.max(mse, 1e-9))).toFixed(2), w, h };
    }, refPng.toString('base64'), jpg.toString('base64'));
    quality.push({ quality: q, bytes: jpg.length, encodeMsSingle: +jpegMs.toFixed(1), refPngBytes: refPng.length, ...cmp, sameBytesAsRepeat: jpg.equals(jpg2) });
  }
  await page.close();

  const summarize = (format, fps) => {
    const rs = runs.filter((r) => r.format === format && r.fps === fps);
    const med = (f) => { const s = rs.map(f).sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
    return {
      format, fps, n: rs.length,
      wallMsMedian: med((r) => r.wallMs),
      msPerFrameMedian: med((r) => r.msPerFrame),
      captureMsAvgMedian: med((r) => r.captureMsAvg),
      bytesSentMedian: med((r) => r.bytesSent),
      bytesPerFrameAvg: med((r) => r.bytesPerFrameAvg),
      peakTreeMBMax: Math.max(...rs.map((r) => r.peakTreeMB)),
      peakNodeMBMax: Math.max(...rs.map((r) => r.peakNodeMB)),
      mp4BytesMedian: med((r) => r.sizeBytes),
      allValid: rs.every((r) => r.validatorOk),
      frameLoss: rs.some((r) => r.framesDecoded !== r.frameCount),
    };
  };
  const summary = fpsList.flatMap((fps) => ['png', 'jpeg'].map((f) => summarize(f, fps)));
  const result = {
    test: 'A1', resolution: `${W}x${H}`, duration, fpsList, reps,
    browser: { version: found.version, path: found.path, source: found.source },
    ffmpeg: bins.ffmpegVersion, ffprobe: bins.ffprobeVersion,
    node: process.version, cpus: (await import('node:os')).cpus().length,
    summary, runs, jpegQuality: quality,
    avgJpegMsSingle: +avg(quality.map((q) => q.encodeMsSingle)).toFixed(1),
  };
  writeFileSync(`${OUT}/a1-results.json`, JSON.stringify(result, null, 2));
  console.log('[A1] summary:');
  console.table(summary);
  console.log('[A1] jpeg quality:');
  console.table(quality.map(({ quality: q, bytes, psnrDb, mae, sameBytesAsRepeat }) => ({ q, bytes, psnrDb, mae, deterministic: sameBytesAsRepeat })));
  console.log(`[A1] PASS=${summary.every((s) => s.allValid && !s.frameLoss)}`);
} finally {
  await browser.close();
}
