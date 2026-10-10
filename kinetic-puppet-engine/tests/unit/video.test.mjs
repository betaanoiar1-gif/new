// Encoder + validator behaviour on real, generated MP4s (no browser, no API).
// Positive path: frames in -> valid MP4 out. Negative paths: the validator must fail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, truncateSync, statSync, existsSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';
import { resolveFfmpeg, FrameEncoder } from '../../src/encoder/ffmpeg.js';
import { validateVideo } from '../../src/validator/video.js';

const DIR = 'output/unit';
mkdirSync(DIR, { recursive: true });
const W = 180, H = 320, FPS = 24;
const bins = await resolveFfmpeg();

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}
/** Minimal truecolor PNG generator (no deps). */
function makePng(w, h, shade) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = (shade + x) & 255; raw[o + 1] = (shade + y) & 255; raw[o + 2] = shade;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

async function encodeFrames(name, n, makeFrame = (i) => makePng(W, H, (i * 7) % 255)) {
  const out = `${DIR}/${name}.mp4`;
  const enc = new FrameEncoder({ ffmpeg: bins.ffmpeg, output: out, width: W, height: H, fps: FPS, inputFormat: 'png' }).start();
  let thrown = null;
  try {
    for (let i = 0; i < n; i++) await enc.writeFrame(makeFrame(i));
    const res = await enc.finish();
    return { out, res, thrown };
  } catch (e) {
    enc.abort();
    return { out, res: null, thrown: e };
  }
}

test('encoder: 24 generated frames encode to a valid MP4 that passes validation', async () => {
  const { out, res, thrown } = await encodeFrames('good', 24);
  assert.equal(thrown, null, String(thrown));
  assert.equal(res.frames, 24);
  const v = validateVideo(out, bins, { width: W, height: H, fps: FPS, frames: 24, durationSec: 1 });
  assert.equal(v.ok, true, JSON.stringify(v.checks.filter((c) => !c.pass)));
});

test('validator: wrong expected fps is rejected', async () => {
  const { out } = await encodeFrames('fps-mismatch', 24);
  const v = validateVideo(out, bins, { width: W, height: H, fps: 30 });
  assert.equal(v.ok, false);
  assert.ok(v.checks.some((c) => c.name === 'fps' && !c.pass));
});

test('validator: missing file is rejected, not treated as valid', () => {
  const v = validateVideo(`${DIR}/does-not-exist.mp4`, bins, { width: W, height: H, fps: FPS });
  assert.equal(v.ok, false);
  assert.ok(v.checks.some((c) => c.name === 'file exists' && !c.pass));
});

test('validator: truncated MP4 is rejected (file size alone is not proof)', async () => {
  const { out } = await encodeFrames('truncate-src', 24);
  const bad = `${DIR}/truncated.mp4`;
  const { copyFileSync } = await import('node:fs');
  copyFileSync(out, bad);
  truncateSync(bad, Math.floor(statSync(bad).size / 2));
  assert.ok(statSync(bad).size > 0);
  const v = validateVideo(bad, bins, { width: W, height: H, fps: FPS, frames: 24 });
  assert.equal(v.ok, false, 'truncated file must not validate');
});

test('encoder: a corrupt frame aborts finish() with an error (no silent frame loss)', async () => {
  const N = 12;
  const { out, res, thrown } = await encodeFrames('corrupt-frame', N, (i) => (i === 5 ? Buffer.from('not a png at all') : makePng(W, H, i * 9)));
  assert.ok(thrown, 'finish() must reject when ffmpeg drops a frame');
  assert.match(String(thrown.message), /ffmpeg exited code=1/);
  assert.equal(res, null);
  // Validator must also refuse the partial output on its own (defence in depth).
  const v = validateVideo(out, bins, { width: W, height: H, fps: FPS, frames: N });
  assert.equal(v.ok, false);
});

test('encoder: large frames exercise stdin backpressure and still deliver every frame', async () => {
  // 720x1280 noise-like PNGs are large enough to fill the pipe, forcing drain waits.
  const big = (i) => makePng(720, 1280, i * 3);
  const { out, res, thrown } = await encodeFrames('backpressure', 30, big);
  assert.equal(thrown, null, String(thrown));
  assert.equal(res.frames, 30);
  assert.ok(res.bytesIn > 1_000_000, `bytes sent ${res.bytesIn}`);
  const v = validateVideo(out, bins, { width: 720, height: 1280, fps: FPS, frames: 30 });
  assert.equal(v.ok, true, JSON.stringify(v.checks.filter((c) => !c.pass)));
  assert.ok(existsSync(out));
  console.log(`# backpressure waits observed: ${res.backpressureWaits}`);
});
