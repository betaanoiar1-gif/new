// Deterministic frame capture: each frame is requested by absolute time (window.__seek(t)),
// never by accumulating dt. Frames are streamed to FFmpeg stdin with backpressure.
import puppeteer from 'puppeteer-core';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { findBrowser, BASE_LAUNCH_ARGS } from './chrome.js';
import { FrameEncoder } from '../encoder/ffmpeg.js';

export async function launchBrowser({ log = () => {} } = {}) {
  const found = await findBrowser({ log });
  const browser = await puppeteer.launch({
    executablePath: found.path,
    args: [...BASE_LAUNCH_ARGS, ...found.args.filter((a) => !BASE_LAUNCH_ARGS.includes(a))],
    headless: true,
    env: found.env,
    protocolTimeout: 180000,
  });
  return { browser, found };
}

/** Loads a template file and waits until the scene is ready and all required ids exist. */
export async function openScene(browser, templatePath, { width, height, requiredIds = [], timeoutMs = 20000 }) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));
  await page.goto(pathToFileURL(resolve(templatePath)).href, { waitUntil: 'load', timeout: timeoutMs });
  await page.waitForFunction('window.__kpeReady === true', { timeout: timeoutMs, polling: 50 });
  const missing = await page.evaluate((ids) => ids.filter((id) => !document.getElementById(id)), requiredIds);
  if (missing.length) throw new Error(`scene missing required elements: ${missing.join(', ')}`);
  if (errors.length) throw new Error(`page errors during load: ${errors.join(' | ')}`);
  page._kpeErrors = errors;
  return page;
}

/**
 * Renders frames [0, duration*fps) at exact times and encodes them to an MP4.
 * format: 'png' | 'jpeg'. Returns timing/size stats; throws on any render or encode failure.
 */
export async function renderToMp4({
  browser, ffmpeg, templatePath, output, width, height, fps, duration,
  format = 'png', quality = 90, requiredIds = [], crf = 18, preset = 'veryfast', onFrame,
}) {
  const page = await openScene(browser, templatePath, { width, height, requiredIds });
  const frameCount = Math.round(duration * fps);
  const enc = new FrameEncoder({
    ffmpeg, output, width, height, fps,
    inputFormat: format === 'jpeg' ? 'mjpeg' : 'png', crf, preset,
  }).start();

  const captureMs = [];
  const writeMs = [];
  const shotOpts = format === 'jpeg' ? { type: 'jpeg', quality } : { type: 'png' };
  const t0 = performance.now();
  let firstFrameMs = null;
  try {
    for (let i = 0; i < frameCount; i += 1) {
      const t = i / fps;
      await page.evaluate((tt) => (typeof window.__seek === 'function' ? window.__seek(tt) : undefined), t);
      const c0 = performance.now();
      const buf = await page.screenshot(shotOpts);
      const c1 = performance.now();
      captureMs.push(c1 - c0);
      await enc.writeFrame(buf);
      writeMs.push(performance.now() - c1);
      if (i === 0) firstFrameMs = performance.now() - t0;
      if (onFrame) onFrame(i, buf);
    }
    const res = await enc.finish();
    const wall = performance.now() - t0;
    if (res.frames !== frameCount) throw new Error(`frame loss: expected ${frameCount}, encoded ${res.frames}`);
    return {
      format, quality: format === 'jpeg' ? quality : null, width, height, fps, duration, frameCount,
      wallMs: +wall.toFixed(1),
      firstFrameMs: +firstFrameMs.toFixed(1),
      msPerFrame: +(wall / frameCount).toFixed(2),
      captureMsAvg: +avg(captureMs).toFixed(2),
      captureMsP95: +pct(captureMs, 0.95).toFixed(2),
      writeMsAvg: +avg(writeMs).toFixed(2),
      bytesSent: res.bytesIn,
      bytesPerFrameAvg: Math.round(res.bytesIn / frameCount),
      backpressureWaits: res.backpressureWaits,
      pageErrors: page._kpeErrors,
    };
  } catch (e) {
    enc.abort();
    throw e;
  } finally {
    await page.close().catch(() => {});
  }
}

export const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
export const pct = (a, p) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
