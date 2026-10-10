// Browser discovery. Never assumes a fixed Chrome path: it probes candidates and
// verifies each one by actually running `--version`. Fallback: @sparticuz/chromium
// (Chromium binary shipped inside the npm tarball), with its shared libs extracted
// on demand when the host lacks them.
import { accessSync, constants, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const FIXED_CANDIDATES = [
  '/opt/chrome-linux64/chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/snap/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];
const COMMAND_NAMES = ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable', 'chrome'];

const isExecutable = (p) => {
  try { accessSync(p, constants.X_OK); return true; } catch { return false; }
};

function which(name) {
  const r = spawnSync('which', [name], { encoding: 'utf8' });
  return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : null;
}

/** Runs `<bin> --version` and returns the version string, or throws with the real reason. */
export function probeVersion(bin, env = process.env) {
  const out = execFileSync(bin, ['--version'], { encoding: 'utf8', timeout: 20000, env, stdio: ['ignore', 'pipe', 'pipe'] });
  return out.trim();
}

function listSystemCandidates() {
  const found = new Map();
  if (process.env.CHROME_PATH) found.set(process.env.CHROME_PATH, 'env:CHROME_PATH');
  for (const n of COMMAND_NAMES) {
    const p = which(n);
    if (p) found.set(p, `PATH:${n}`);
  }
  for (const p of FIXED_CANDIDATES) if (existsSync(p)) found.set(p, 'fixed-path');
  return [...found.entries()].map(([path, source]) => ({ path, source }));
}

/** Extracts Amazon-Linux-2023 shared libraries shipped by @sparticuz/chromium. Returns the lib dir. */
export function extractBundledLibs(force = false) {
  const pkgRoot = join(dirname(fileURLToPath(import.meta.resolve('@sparticuz/chromium'))), '..');
  const archive = join(pkgRoot, 'bin', 'al2023.tar.br');
  const base = join(tmpdir(), 'kpe-al2023');
  const libDir = join(base, 'lib');
  if (!force && existsSync(join(libDir, 'libnss3.so'))) return libDir;
  mkdirSync(base, { recursive: true });
  const tarPath = join(base, 'al2023.tar');
  writeFileSync(tarPath, zlib.brotliDecompressSync(readFileSync(archive)));
  const r = spawnSync('tar', ['-xf', tarPath, '-C', base], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`tar extraction of al2023 libs failed: ${r.stderr}`);
  return libDir;
}

/** Returns the bundled fallback descriptor (without launching it). */
export async function bundledFallback() {
  const mod = (await import('@sparticuz/chromium')).default;
  const path = await mod.executablePath();
  const libDir = extractBundledLibs();
  const env = { ...process.env, LD_LIBRARY_PATH: [libDir, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') };
  return { path, args: mod.args, env, source: 'bundled:@sparticuz/chromium' };
}

/**
 * Finds a working browser. Returns { path, version, source, args, env }.
 * `args` are extra launch args recommended for this binary; `env` must be passed to launch.
 * Throws an Error listing every attempt when nothing works.
 */
export async function findBrowser({ allowBundled = true, log = () => {} } = {}) {
  const attempts = [];
  for (const c of listSystemCandidates()) {
    if (!isExecutable(c.path)) { attempts.push(`${c.path}: not executable`); continue; }
    try {
      const version = probeVersion(c.path);
      log(`browser ok: ${c.path} (${version}) via ${c.source}`);
      return { path: c.path, version, source: c.source, args: [], env: process.env };
    } catch (e) {
      attempts.push(`${c.path}: ${String(e.stderr || e.message).split('\n')[0]}`);
    }
  }
  if (allowBundled) {
    try {
      const fb = await bundledFallback();
      const version = probeVersion(fb.path, fb.env);
      log(`browser ok: ${fb.path} (${version}) via ${fb.source}`);
      return { ...fb, version, args: fb.args };
    } catch (e) {
      attempts.push(`bundled: ${String(e.stderr || e.message).split('\n')[0]}`);
    }
  }
  throw new Error('No usable Chrome/Chromium found. Attempts:\n  ' + attempts.join('\n  '));
}

/** Args that keep Chrome CPU-only and quiet. Used for every launch. */
export const BASE_LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-gpu',
  '--disable-dev-shm-usage',
  '--no-zygote',
  '--hide-scrollbars',
  '--mute-audio',
  '--font-render-hinting=none',
];
