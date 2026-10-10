// Validates a rendered MP4 with ffprobe (container, codec, dimensions, fps, duration,
// frame count) and a full decode pass with ffmpeg (catches corrupt/undecodable frames).
// File size alone is never treated as proof of validity.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, unlinkSync } from 'node:fs';

function parseRate(r) {
  if (!r || r === '0/0') return null;
  const [n, d] = String(r).split('/').map(Number);
  return d ? n / d : n;
}

export function probeVideo(file, ffprobe) {
  if (!existsSync(file)) return { exists: false };
  const size = statSync(file).size;
  let j;
  try {
    const out = execFileSync(ffprobe, [
      '-v', 'error', '-count_frames', '-print_format', 'json',
      '-show_format', '-show_streams', file,
    ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    j = JSON.parse(out);
  } catch (e) {
    return { exists: true, sizeBytes: size, probeError: String(e.stderr || e.message).split('\n')[0] };
  }
  const v = (j.streams || []).find((s) => s.codec_type === 'video');
  const fmt = j.format || {};
  return {
    exists: true,
    sizeBytes: size,
    formatName: fmt.format_name,
    codec: v?.codec_name,
    profile: v?.profile,
    pixFmt: v?.pix_fmt,
    width: v?.width,
    height: v?.height,
    avgFps: parseRate(v?.avg_frame_rate),
    rFps: parseRate(v?.r_frame_rate),
    durationSec: Number(v?.duration ?? fmt.duration),
    framesCounted: Number(v?.nb_read_frames),
    framesMetadata: Number(v?.nb_frames),
    audioStreams: (j.streams || []).filter((s) => s.codec_type === 'audio').length,
  };
}

/** Full decode: any error printed by ffmpeg, or non-zero exit, means the stream is broken. */
export function decodeCheck(file, ffmpeg) {
  const r = spawnSync(ffmpeg, ['-v', 'error', '-i', file, '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  const errors = (r.stderr || '').split('\n').map((s) => s.trim()).filter(Boolean);
  return { ok: r.status === 0 && errors.length === 0, exitCode: r.status, errorLines: errors.slice(0, 20) };
}

/**
 * Per-frame mean luma (YAVG, 0-255) via signalstats. Used to detect unintended white/blank frames.
 * Returns an array of numbers, one per decoded frame.
 */
export function lumaPerFrame(file, ffmpeg) {
  const tmp = `${file}.yavg.txt`;
  const r = spawnSync(ffmpeg, ['-v', 'error', '-i', file, '-vf', `signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=${tmp}`, '-f', 'null', '-'], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  const text = readFileSync(tmp, 'utf8');
  unlinkSync(tmp);
  return [...text.matchAll(/YAVG=([\d.]+)/g)].map((m) => Number(m[1]));
}

/**
 * expect: { width, height, fps, frames?, durationSec?, durationTolerance?, allowWhiteFrames? }
 * allowWhiteFrames: count of intentionally bright frames (e.g. a fade to white). Default 0.
 * Returns { ok, checks: [{name, pass, expected, actual}], probe, decode }.
 */
export function validateVideo(file, { ffprobe, ffmpeg }, expect) {
  const probe = probeVideo(file, ffprobe);
  const decode = probe.exists ? decodeCheck(file, ffmpeg) : { ok: false, errorLines: ['missing'] };
  const tol = expect.durationTolerance ?? 0.05;
  const checks = [];
  const add = (name, pass, expected, actual) => checks.push({ name, pass: Boolean(pass), expected, actual });
  add('file exists', probe.exists, true, probe.exists);
  add('size > 0', probe.sizeBytes > 0, '>0', probe.sizeBytes);
  add('probe succeeded', !probe.probeError, 'no error', probe.probeError || 'ok');
  add('container mp4', /mp4/.test(probe.formatName || ''), 'mp4', probe.formatName);
  add('codec h264', probe.codec === 'h264', 'h264', probe.codec);
  add('pix_fmt yuv420p', probe.pixFmt === 'yuv420p', 'yuv420p', probe.pixFmt);
  add('width', probe.width === expect.width, expect.width, probe.width);
  add('height', probe.height === expect.height, expect.height, probe.height);
  add('fps', probe.avgFps && Math.abs(probe.avgFps - expect.fps) < 0.01, expect.fps, probe.avgFps && +probe.avgFps.toFixed(3));
  if (expect.durationSec != null) {
    add('duration', Math.abs(probe.durationSec - expect.durationSec) <= tol, expect.durationSec, +probe.durationSec.toFixed(3));
  }
  if (expect.frames != null) {
    add('frame count (decoded)', probe.framesCounted === expect.frames, expect.frames, probe.framesCounted);
  }
  add('no audio track', probe.audioStreams === 0, 0, probe.audioStreams);
  if (probe.exists && decode.ok) {
    const luma = lumaPerFrame(file, ffmpeg);
    const white = luma ? luma.filter((y) => y >= 240).length : -1;
    add('no unintended white frames', white >= 0 && white <= (expect.allowWhiteFrames ?? 0), expect.allowWhiteFrames ?? 0, white);
    add('no blank (black) frames', luma && luma.every((y) => y > 8), 'all YAVG > 8', luma ? Math.min(...luma).toFixed(1) : null);
    probe.lumaMin = luma ? +Math.min(...luma).toFixed(1) : null;
    probe.lumaMax = luma ? +Math.max(...luma).toFixed(1) : null;
  }
  add('full decode clean', decode.ok, true, decode.ok);
  return { ok: checks.every((c) => c.pass), checks, probe, decode };
}
