// Runs every Phase 0 gate in order and stops at the first failure.
// Needs no KiosAPI key: all Phase 0 tests use fixed inputs.
import { spawnSync } from 'node:child_process';

const steps = [
  ['A2 browser discovery', ['tests/phase0/a2-browser.mjs']],
  ['A3 scenario validity (unit)', ['--test', 'tests/unit/scenario.test.mjs']],
  ['Encoder + validator (unit, real MP4s)', ['--test', 'tests/unit/video.test.mjs']],
  ['A4 render determinism + time control', ['tests/phase0/a4-determinism.mjs']],
  ['A1 PNG vs JPEG capture + MP4 export', ['tests/phase0/a1-capture-format.mjs', '--reps=3', '--fps=24,30']],
];
let failed = null;
for (const [name, argv] of steps) {
  console.log(`\n===== ${name} =====`);
  const r = spawnSync(process.execPath, argv, { stdio: 'inherit' });
  if (r.status !== 0) { failed = name; break; }
}
console.log(failed ? `\nPHASE 0: FAIL at ${failed}` : '\nPHASE 0: all gates passed');
process.exitCode = failed ? 1 : 0;
