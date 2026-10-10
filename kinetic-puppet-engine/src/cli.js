#!/usr/bin/env node
// CLI. Story file mode works offline. Prompt mode needs an LLM director, which is not wired up
// yet, so it fails with a clear message instead of guessing.
import { parseArgs } from 'node:util';
import { mkdirSync } from 'node:fs';
import { loadStoryFile } from './director/load.js';
import { buildTimeline, sampleAt } from './motion/timeline.js';
import { composeMarkup } from './renderer/compose.js';
import { launchBrowser, renderToMp4 } from './renderer/capture.js';
import { resolveFfmpeg } from './encoder/ffmpeg.js';
import { validateVideo } from './validator/video.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    story: { type: 'string' },
    out: { type: 'string', default: 'output/cli/video.mp4' },
    format: { type: 'string', default: 'png' },
  },
});

async function main() {
  if (!values.story) {
    const prompt = positionals.join(' ').trim();
    if (!prompt) { console.error('usage: npm start -- --story <file.json> [--out file.mp4] | npm start -- "<story prompt>"'); return 2; }
    console.error('story prompt mode: the LLM director is not configured in this build (no KiosAPI key is set in this environment).');
    console.error('use --story <file.json> with a validated story, e.g. examples/mvp-book-handoff.json');
    return 2;
  }
  const loaded = loadStoryFile(values.story);
  if (!loaded.ok) { console.error('story rejected:', JSON.stringify(loaded.errors, null, 2)); return 1; }
  const story = loaded.scenario;
  const model = buildTimeline(story);
  const { width, height, fps, duration } = story.project;
  const outDir = values.out.split('/').slice(0, -1).join('/') || '.';
  mkdirSync(outDir, { recursive: true });
  const bins = await resolveFfmpeg();
  const { browser } = await launchBrowser();
  try {
    const stats = await renderToMp4({
      browser, ffmpeg: bins.ffmpeg, templatePath: 'templates/stage.html', output: values.out,
      width, height, fps, duration, format: values.format, requiredIds: ['stage', 'layer'],
      frameFn: (t) => composeMarkup(model, sampleAt(model, t), story),
    });
    console.log(`rendered ${stats.frameCount} frames in ${stats.wallMs} ms -> ${values.out}`);
  } finally {
    await browser.close();
  }
  const v = validateVideo(values.out, bins, { width, height, fps, frames: Math.round(duration * fps), durationSec: duration, allowWhiteFrames: 0 });
  console.log(v.ok ? 'MP4 validation: PASS' : `MP4 validation: FAIL ${JSON.stringify(v.checks.filter((c) => !c.pass))}`);
  return v.ok ? 0 : 1;
}

main().then((code) => { process.exitCode = code; }, (e) => { console.error(e.code ? `${e.code}: ${e.message}` : e); process.exitCode = 1; });
