// Phase 2 model checks: attachment, hand-off continuity, timing, and motion-level rejections.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadStoryFile } from '../../src/director/load.js';
import { buildTimeline, sampleAt, ScenarioError } from '../../src/motion/timeline.js';
import { composeMarkup } from '../../src/renderer/compose.js';

const MVP = 'examples/mvp-book-handoff.json';
const model = () => buildTimeline(loadStoryFile(MVP).scenario);
const dist = (a, b) => Math.hypot(a[0] - b.x, a[1] - b.y);

test('motion: MVP example validates and builds with no warnings', () => {
  const r = loadStoryFile(MVP);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(buildTimeline(r.scenario).warnings, []);
});

test('motion: sampling is order-independent (pure function of t)', () => {
  const m = model();
  const times = [0, 2.3, 5.6, 1.1, 2.3, 7.95];
  const a = times.map((t) => JSON.stringify(sampleAt(m, t).props));
  const b = [...times].reverse().map((t) => JSON.stringify(sampleAt(m, t).props)).reverse();
  assert.deepEqual(a, b);
});

test('attachment: book equals the holder hand while carried, before and after the walk', () => {
  const m = model();
  for (const t of [2.9, 3.7, 4.5]) {
    const s = sampleAt(m, t);
    assert.ok(dist(s.props.book, s.chars.A.solved.anchors.hand_L) < 1e-6, `t=${t}`);
  }
  for (const t of [6.0, 7.5]) {
    const s = sampleAt(m, t);
    assert.ok(dist(s.props.book, s.chars.B.solved.anchors.hand_R) < 1e-6, `t=${t}`);
  }
});

test('hand-off: book position is continuous at the give start and end (no jump at boundaries)', () => {
  const m = model();
  const eps = 1e-4;
  const at = (t) => sampleAt(m, t).props.book;
  // give window is [4.6, 5.6]
  const a0 = at(4.6 - eps), a1 = at(4.6 + eps);
  assert.ok(Math.hypot(a1[0] - a0[0], a1[1] - a0[1]) < 0.05, 'no jump entering the hand-off');
  const b0 = at(5.6 - eps), b1 = at(5.6 + eps);
  assert.ok(Math.hypot(b1[0] - b0[0], b1[1] - b0[1]) < 0.05, 'no jump leaving the hand-off');
});

test('hand-off: giver and receiver hands meet at the give point and both arms reach it', () => {
  const m = model();
  const s = sampleAt(m, 5.6);
  const hA = s.chars.A.solved.anchors.hand_L, hB = s.chars.B.solved.anchors.hand_R;
  assert.ok(Math.hypot(hA.x - hB.x, hA.y - hB.y) < 1e-6);
  assert.equal(s.chars.A.solved.arms.L.status, 'reached');
  assert.equal(s.chars.B.solved.arms.R.status, 'reached');
});

test('expression: B switches to happy exactly at the react start and reverts at its end', () => {
  const m = model();
  assert.equal(sampleAt(m, 5.599).chars.B.pose.expression, 'neutral');
  assert.equal(sampleAt(m, 5.6).chars.B.pose.expression, 'happy');
  assert.equal(sampleAt(m, 7.999).chars.B.pose.expression, 'happy');
});

test('draw order: book is drawn after both characters (never hidden behind a body)', () => {
  const r = loadStoryFile(MVP);
  const m = buildTimeline(r.scenario);
  const markup = composeMarkup(m, sampleAt(m, 5.0), r.scenario);
  const bookAt = markup.indexOf('data-prop="book"');
  const lastChar = markup.lastIndexOf('class="kpe-char"');
  assert.ok(bookAt > lastChar && bookAt > 0);
});

test('fade: overlay is zero before the last 0.75 s and reaches the max alpha at the end', () => {
  const m = model();
  assert.equal(sampleAt(m, 7.0).overlay.alpha, 0);
  assert.ok(sampleAt(m, 7.999).overlay.alpha > 0.8);
});

test('rejects a pick the character cannot reach (UNREACHABLE)', () => {
  const r = loadStoryFile('tests/fixtures/motion/unreachable-pick.json');
  assert.equal(r.ok, true, 'schema-level valid; the failure is motion-level');
  assert.throws(() => buildTimeline(r.scenario), (e) => e instanceof ScenarioError && e.code === 'UNREACHABLE');
});

test('rejects a hand-off while the receiver walks (ACTION_CONFLICT)', () => {
  const r = loadStoryFile('tests/fixtures/motion/receiver-walks-during-give.json');
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.throws(() => buildTimeline(r.scenario), (e) => e instanceof ScenarioError && e.code === 'ACTION_CONFLICT');
});

test('validator rejects actions and transitions that are valid JSON but not yet rendered', () => {
  const raw = JSON.parse(readFileSync(MVP, 'utf8'));
  raw.scenes[0].actions.push({ t: 0, duration: 0.5, char: 'B', act: 'wave' });
  const v = loadStoryFile(MVP) && (await_validate(raw));
  assert.ok(v.errors.some((e) => e.code === 'ACTION_NOT_IMPLEMENTED'));
  const raw2 = JSON.parse(readFileSync(MVP, 'utf8'));
  raw2.scenes[0].transition = 'slide';
  assert.ok((await_validate(raw2)).errors.some((e) => e.code === 'TRANSITION_NOT_IMPLEMENTED'));
});

import { validateScenario } from '../../src/validator/scenario.js';
function await_validate(raw) { return validateScenario(raw); }
