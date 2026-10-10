// FFmpeg integration: binary resolution, and a stdin-fed encoder that respects
// backpressure and never silently drops frames.
import { spawn, execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function which(name) {
  const r = spawnSync('which', [name], { encoding: 'utf8' });
  return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : null;
}

function bundledPath(pkg, file) {
  try {
    const pkgJson = fileURLToPath(import.meta.resolve(`${pkg}/package.json`));
    const p = join(dirname(pkgJson), file);
    return existsSync(p) ? p : null;
  } catch { return null; }
}

function versionLine(bin) {
  return execFileSync(bin, ['-version'], { encoding: 'utf8', timeout: 20000 }).split('\n')[0].trim();
}

/** Resolves ffmpeg/ffprobe: env override → bundled npm binary → PATH. Verifies each by running it. */
export async function resolveFfmpeg() {
  const ffmpeg = process.env.FFMPEG_PATH || bundledPath('@ffmpeg-installer/linux-x64', 'ffmpeg') || which('ffmpeg');
  let ffprobe = process.env.FFPROBE_PATH;
  if (!ffprobe) {
    try { ffprobe = (await import('ffprobe-static')).default.path; } catch { /* fall through */ }
  }
  ffprobe = ffprobe || which('ffprobe');
  if (!ffmpeg || !ffprobe) throw new Error(`ffmpeg/ffprobe not found (ffmpeg=${ffmpeg}, ffprobe=${ffprobe})`);
  return { ffmpeg, ffprobe, ffmpegVersion: versionLine(ffmpeg), ffprobeVersion: versionLine(ffprobe) };
}

/**
 * Streams raw image frames (PNG or MJPEG, via image2pipe) into FFmpeg stdin and encodes H.264 MP4.
 * - writeFrame() waits for 'drain' when stdin reports backpressure.
 * - stdin/process errors reject the next writeFrame() and finish().
 * - finish() resolves only when ffmpeg exits with code 0.
 */
export class FrameEncoder {
  constructor({ ffmpeg, output, width, height, fps, inputFormat = 'png', crf = 18, preset = 'veryfast' }) {
    if (!['png', 'mjpeg'].includes(inputFormat)) throw new Error(`unsupported inputFormat ${inputFormat}`);
    this.opts = { ffmpeg, output, width, height, fps, inputFormat, crf, preset };
    this.frames = 0;
    this.bytesIn = 0;
    this.backpressureWaits = 0;
    this.error = null;
    this.stderrTail = '';
    this.exited = null;
  }

  start() {
    const { ffmpeg, output, fps, inputFormat, crf, preset } = this.opts;
    const args = [
      '-y', '-hide_banner', '-loglevel', 'error',
      // -xerror: a decode error must abort with a non-zero exit. Without it ffmpeg
      // logs "Error while decoding" and still exits 0 after dropping the bad frame.
      '-xerror',
      '-f', 'image2pipe', '-framerate', String(fps), '-c:v', inputFormat, '-i', 'pipe:0',
      '-an', '-c:v', 'libx264', '-preset', preset, '-crf', String(crf),
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-r', String(fps),
      output,
    ];
    this.proc = spawn(ffmpeg, args, { stdio: ['pipe', 'ignore', 'pipe'] });
    this.closed = new Promise((resolve) => {
      this.proc.on('error', (err) => { this.fail(err); resolve(); });
      this.proc.on('close', (code, signal) => {
        this.exited = { code, signal };
        if (code !== 0 && !this.error) this.fail(new Error(`ffmpeg exited code=${code} signal=${signal}: ${this.stderrTail.trim()}`));
        resolve();
      });
    });
    this.proc.stderr.on('data', (d) => { this.stderrTail = (this.stderrTail + d.toString()).slice(-4000); });
    this.proc.stdin.on('error', (err) => this.fail(new Error(`ffmpeg stdin error: ${err.message}`)));
    return this;
  }

  fail(err) {
    if (!this.error) this.error = err;
    if (this.onFail) this.onFail(err);
  }

  /** Writes one encoded frame (Buffer). Resolves once stdin accepted it. */
  async writeFrame(buf) {
    if (this.error) throw this.error;
    this.frames += 1;
    this.bytesIn += buf.length;
    const { stdin } = this.proc;
    if (stdin.write(buf)) return;
    this.backpressureWaits += 1;
    await new Promise((resolve, reject) => {
      const done = () => { cleanup(); resolve(); };
      const bad = (err) => { cleanup(); reject(this.error || err); };
      const cleanup = () => { stdin.off('drain', done); stdin.off('error', bad); this.onFail = null; };
      stdin.once('drain', done);
      stdin.once('error', bad);
      this.onFail = (err) => { cleanup(); reject(err); };
    });
    if (this.error) throw this.error;
  }

  /** Ends input, waits for ffmpeg to exit. Throws unless exit code is 0. */
  async finish() {
    this.proc.stdin.end();
    await this.closed;
    if (this.error) throw this.error;
    return { frames: this.frames, bytesIn: this.bytesIn, backpressureWaits: this.backpressureWaits, exit: this.exited };
  }

  abort() {
    try { this.proc.kill('SIGKILL'); } catch { /* already gone */ }
  }
}
