# Kinetic Puppet Engine v2 (KPE)

CPU-only engine that turns a structured story (`story.json`) into an MP4 animation with
local, deterministic rendering: Puppeteer/Chrome captures frames at exact times and FFmpeg
encodes them. No GPU, no CUDA, and no per-frame AI generation. The LLM (KiosAPI) is only
meant to produce `story.json`, and it is not used at render time.

## Status

| Phase | Scope | Status |
|---|---|---|
| 0 | Assumption checks: capture cost (PNG vs JPEG), browser discovery, scenario validation, render determinism, MP4 export | **PASS** (see `output/phase0/`) |
| 1 | Rig + 2-bone IK | not started |
| 2 | MVP: two characters, book hand-off, 8 s, 720×1280, 24 fps | not started |

## Requirements

- Node.js 22+
- A Chrome/Chromium binary. Discovery order: `CHROME_PATH` → `chromium`/`google-chrome` on PATH →
  common fixed paths → bundled `@sparticuz/chromium` (its shared libraries are extracted to
  `$TMPDIR/kpe-al2023` when the host lacks them). Nothing is hard-coded.
- FFmpeg/ffprobe. Discovery: `FFMPEG_PATH`/`FFPROBE_PATH` → bundled npm binaries → PATH.

## Install and tests

```bash
npm install
npm test            # unit tests: scenario validation, encoder, validator (no browser, no API)
npm run phase0      # full Phase 0 gate (launches Chrome, renders MP4s, writes output/phase0/)
```

No KiosAPI key is needed for any test. Fixed inputs live in `tests/fixtures/scenarios/`.

## Layout

```
src/
  renderer/   chrome.js (browser discovery), capture.js (seek-by-time frame loop)
  encoder/    ffmpeg.js (binary resolution, stdin FrameEncoder with backpressure and -xerror)
  validator/  video.js (ffprobe + full decode + luma checks), scenario.js (semantic story checks)
  schema/     story.js (Zod schema for story.json v2)
  director/   load.js (JSON parse + validation of a story file)
  util/       procstats.js (peak RSS of the process tree from /proc)
templates/    HTML scenes. Each exposes window.__seek(t) and window.__kpeReady.
tests/
  unit/       node:test suites (run by npm test)
  phase0/     A1 capture benchmark, A2 browser discovery, A4 determinism, run-all.mjs
  fixtures/   story JSON fixtures (valid and invalid)
output/       generated artifacts (git-ignored)
```

## Phase 0 findings (short)

- Frames are requested by absolute time (`window.__seek(t)`). Identical requests return identical
  bytes (PNG and JPEG), across order, idle time, page instances and browser processes.
- A `tick(dt)` integrator is path dependent: a duplicated or resized step changes the state.
  The engine therefore must not use it for rendering.
- Chrome's PNG output is lossless and deterministic. JPEG q90 is about 15–20% faster per frame here,
  with PSNR ≈ 44 dB against the PNG reference. The default is PNG.
- The MP4 built from PNG frames is about 4.5× larger than the one built from JPEG frames for the same
  static scene. The cause is x264's psy-rd/aq tuning spending bits on gradient noise from the RGB→YUV
  conversion. Measured: `-x264-params psy-rd=0:aq-mode=0` brings the PNG path down to ~15 KB, close to the JPEG path.
- FFmpeg without `-xerror` exits 0 after a decode error and drops the frame. The encoder now uses `-xerror`
  and the validator independently checks the frame count.
