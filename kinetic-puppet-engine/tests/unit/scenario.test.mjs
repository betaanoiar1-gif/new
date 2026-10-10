// A3: scenario validity. Every invalid fixture must be rejected with the expected code;
// the valid one must pass. No LLM and no API key involved.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadStoryFile } from '../../src/director/load.js';
import { validateScenario } from '../../src/validator/scenario.js';

const F = (name) => `tests/fixtures/scenarios/${name}`;
const codes = (r) => r.errors.map((e) => e.code);

test('A3: valid scenario is accepted', () => {
  const r = loadStoryFile(F('valid.json'));
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.scenario.version, '2.0');
});

const cases = [
  ['unknown-character.json', 'UNKNOWN_CHARACTER', 'unknown character'],
  ['missing-target.json', 'MISSING_REFERENCE', 'missing target / prop'],
  ['out-of-bounds.json', 'OUT_OF_BOUNDS', 'prop outside the frame'],
  ['unsupported-action.json', 'SCHEMA', 'unsupported action "jump"'],
  ['overlap.json', 'OVERLAP', 'overlapping actions for one character'],
  ['time-range.json', 'TIME_RANGE', 'action runs past scene end'],
  ['duration-mismatch.json', 'DURATION_MISMATCH', 'scene durations do not add up'],
  ['bad-json.json', 'PARSE', 'malformed JSON'],
  ['self-give.json', 'SELF_GIVE', 'character gives to itself'],
  ['prop-already-held.json', 'PROP_ALREADY_HELD', 'picking a prop that is held'],
  ['give-not-held.json', 'PROP_NOT_HELD', 'giving a prop the actor does not hold'],
  ['bad-color.json', 'SCHEMA', 'invalid color value'],
  ['duplicate-id.json', 'DUPLICATE_ID', 'duplicate prop id'],
  ['wrong-prop-type.json', 'WRONG_PROP_TYPE', 'picking furniture'],
];

for (const [file, code, label] of cases) {
  test(`A3: rejects ${label} (${file})`, () => {
    const r = loadStoryFile(F(file));
    assert.equal(r.ok, false, `${file} should be rejected`);
    assert.ok(codes(r).includes(code), `expected ${code}, got ${codes(r)}`);
    assert.equal(r.scenario, null);
  });
}

test('A3: out-of-bounds walk target is corrected (clamped) with a warning, not silently', () => {
  const raw = JSON.parse(readFileSync(F('valid.json'), 'utf8'));
  raw.scenes[0].actions[0].to = [900, -40];
  const r = validateScenario(raw);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.scenario.scenes[0].actions[0].to, [720, 0]);
  assert.equal(r.warnings[0].code, 'OUT_OF_BOUNDS_CLAMPED');
  assert.deepEqual(raw.scenes[0].actions[0].to, [900, -40], 'input object must not be mutated');
});

test('A3: unknown target character in give is rejected, not auto-fixed', () => {
  const raw = JSON.parse(readFileSync(F('valid.json'), 'utf8'));
  raw.scenes[0].actions[2].target = 'Q';
  const r = validateScenario(raw);
  assert.equal(r.ok, false);
  assert.ok(codes(r).includes('MISSING_REFERENCE'));
});
