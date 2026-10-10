# Kinetic Puppet Engine v2

A CPU-first story-to-animation prototype. A language model can optionally turn a prompt into a validated JSON plan; a deterministic evaluator turns semantic actions into character and prop states; SVG renders the scene in headless Chrome; FFmpeg encodes frames into MP4. No GPU, CUDA, diffusion model, or per-frame AI calls are required.

## Status

This is an MVP, not professional animation quality. Browser rendering and performance depend on the target runtime. Run the benchmark before making speed or RAM claims.

## Features

- JSON schema and cross-reference validation with Zod.
- Headless Chrome path detection and CHROME_PATH override.
- CPU rendering with GPU disabled.
- SVG characters with configurable skin, hair, shirt, and pants colors.
- Deterministic absolute-time evaluation.
- Character positions and prop ownership/attachments carry across scene boundaries.
- Semantic actions: walkTo, wave, pick, give, sitOn, react, talk, idle.
- Prop attachment and handoff between characters.
- Two-bone IK with unreachable-target clamping.
- PNG/JPEG frame transport to FFmpeg stdin with backpressure handling.
- ffprobe checks for codec, resolution, FPS, duration, and decoded frame count.
- Optional KiosAPI story generation; example JSON works without an API key.

## Requirements

Node.js 20+, FFmpeg and ffprobe on PATH, and Chrome/Chromium. Set CHROME_PATH if automatic detection fails.

## Google Colab setup

    !apt-get update -qq
    !apt-get install -y ffmpeg
    %cd /content
    !git clone https://github.com/betaanoiar1-gif/new.git kinetic-puppet-engine
    %cd /content/kinetic-puppet-engine
    !npm install

The engine checks common paths including /opt/chrome-linux64/chrome and /usr/bin/chromium. If Chrome is missing, install a compatible Chrome for Testing build and set CHROME_PATH. Avoid relying on the chromium-browser snap wrapper in Colab.

## Quick start without API

    npm install
    npm test
    npm run demo

Output: output/kpe-demo.mp4

Two-scene handoff example:

    npm run demo:multi

Output: output/kpe-multi-scene.mp4

Or:

    node src/cli.js --story examples/book-handoff.json --output output/book-handoff.mp4

## KiosAPI generation

Set environment variables; never commit real keys.

    export KIOSAPI_BASE_URL=https://kiosapi.com/v1
    export KIOSAPI_API_KEY=YOUR_KEY
    export KIOSAPI_MODEL=deepseek-ai/deepseek-v4.1-flash
    node src/cli.js --prompt "Two friends share a book in a library" --output output/generated.mp4

KIOSAPI_SECRET and OPENAI_API_KEY are accepted as fallback key names. The model is called once to produce a story plan; rendering is local. Use KIOSAPI_MODEL for another supported model.

## PNG vs JPEG benchmark

    node src/cli.js --benchmark

The benchmark renders the same story with both transports and validates the MP4 files. It reports elapsed time, input screenshot bytes, output size, sampled peak Node-process RSS, and video metadata. This does not include the separate Chrome and FFmpeg processes; use Colab psutil/cgroup metrics or /usr/bin/time -v to measure total peak memory.

Choose one transport manually with --format png or --format jpeg and optional --quality 85.

## Architecture

Optional prompt -> KiosAPI -> story JSON -> Zod validation -> deterministic evaluator -> SVG -> Puppeteer/Chrome with GPU disabled -> PNG/JPEG stdin -> FFmpeg/libx264 -> ffprobe validation.

## Current limitations

- Character artwork is a stylized SVG prototype, not professional frame-by-frame art.
- The single- and multi-scene book handoff examples are the primary demos; general physical planning and collision avoidance are not implemented.
- IK is unit-tested, but elbow continuity and collisions need visual validation.
- talk has a basic mouth animation and idle has subtle body motion; these are placeholders, not lip-sync or high-quality acting.
- sitOn is schema-validated and changes placement, but a convincing seated pose is not implemented yet.
- Backgrounds are procedural SVG; there is no AI image generation.
- Audio/TTS, subtitles, visual editor, and long-form planning are out of scope.
- Performance must be measured in the actual runtime.

## Tests

    npm test

Tests cover schema validation, duplicate IDs, deterministic seeking, prop transfer across scenes, basic speech state, SVG output, and IK reachability. GitHub Actions also runs a real MP4 smoke render with Chrome and FFmpeg.
