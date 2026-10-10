// Phase 1 math checks for the 2-bone IK solver and the rig solve. Pure functions, no browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solveTwoBone } from '../../src/rig/ik.js';
import { loadRig, solvePose } from '../../src/rig/skeleton.js';

const L1 = 135, L2 = 120, MAX = L1 + L2;
const S = { x: 404, y: 770 };
const POLE = { x: 464, y: 810 };
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

test('IK: reachable targets at the brief heights are hit exactly', () => {
  for (const y of [800, 900, 1000]) for (const x of [380, 420, 470]) {
    const r = solveTwoBone({ root: S, target: { x, y }, pole: POLE, l1: L1, l2: L2 });
    assert.equal(r.status, 'reached', `(${x},${y})`);
    assert.ok(r.reachError < 1e-9, `reach error ${r.reachError}`);
    assert.ok(r.boneError < 1e-9, `bone error ${r.boneError}`);
  }
});

test('IK: target beyond max reach is clamped on the line toward it and flagged', () => {
  const T = { x: 404, y: 1200 };
  const r = solveTwoBone({ root: S, target: T, pole: POLE, l1: L1, l2: L2 });
  assert.equal(r.status, 'clamped_far');
  assert.equal(r.reachable, false);
  assert.ok(Math.abs(dist(S, r.hand) - MAX) < 1e-9, 'hand at full extension');
  assert.ok(r.reachError > 100, 'reported error reflects the shortfall');
  assert.ok(Math.abs(r.hand.x - S.x) < 1e-9, 'stays on the root->target line');
});

test('IK: target closer than min reach is clamped and flagged', () => {
  const r = solveTwoBone({ root: S, target: { x: 405, y: 771 }, pole: POLE, l1: L1, l2: L2 });
  assert.equal(r.status, 'clamped_near');
  assert.ok(Math.abs(dist(S, r.hand) - Math.abs(L1 - L2)) < 1e-9);
});

test('IK: zero distance and equal bones do not divide by zero', () => {
  const r = solveTwoBone({ root: S, target: S, pole: POLE, l1: 100, l2: 100 });
  for (const v of [r.elbow.x, r.elbow.y, r.hand.x, r.hand.y, r.reachError, r.boneError]) assert.ok(Number.isFinite(v));
  assert.equal(r.status, 'degenerate');
});

test('IK: invalid inputs throw instead of returning NaN', () => {
  assert.throws(() => solveTwoBone({ root: S, target: { x: NaN, y: 900 }, pole: POLE, l1: L1, l2: L2 }), TypeError);
  assert.throws(() => solveTwoBone({ root: S, target: { x: 1, y: 2 }, pole: POLE, l1: 0, l2: L2 }), RangeError);
  assert.throws(() => solveTwoBone({ root: S, target: { x: 1, y: 2 }, pole: POLE, l1: -5, l2: L2 }), RangeError);
  assert.throws(() => solveTwoBone({ root: S, target: { x: 1, y: 2 }, pole: null, l1: L1, l2: L2 }), TypeError);
});

test('IK: the pole chooses the bend side; mirrored pole gives the mirrored elbow', () => {
  const T = { x: 430, y: 900 };
  const a = solveTwoBone({ root: S, target: T, pole: POLE, l1: L1, l2: L2 });
  const mirrorPole = { x: S.x - (POLE.x - S.x), y: POLE.y };
  const b = solveTwoBone({ root: S, target: T, pole: mirrorPole, l1: L1, l2: L2 });
  assert.ok(cross(S, T, a.elbow) * cross(S, T, b.elbow) < 0, 'elbows on opposite sides');
  assert.ok(Math.abs(dist(a.elbow, S) - L1) < 1e-9 && Math.abs(dist(b.elbow, S) - L1) < 1e-9);
});

test('IK: sweeping the target in 2 px steps never jumps the elbow (no flips or explosions)', () => {
  let prev = null;
  let maxJump = 0;
  for (let i = 0; i <= 400; i += 1) {
    const T = { x: 380 + i * 0.2, y: 780 + i * 0.5 }; // path stays mostly in reach
    const r = solveTwoBone({ root: S, target: T, pole: POLE, l1: L1, l2: L2 });
    if (prev) maxJump = Math.max(maxJump, dist(prev, r.elbow));
    prev = r.elbow;
  }
  assert.ok(maxJump < 6, `max elbow jump per step ${maxJump.toFixed(2)} px`);
});

test('IK: pure function, so any time can be recomputed directly (order-independent)', () => {
  const targetAt = (t) => ({ x: 420 + 20 * Math.sin(t), y: 850 + 80 * Math.cos(t / 2) });
  const times = [0, 0.7, 2.3, 1.1, 0.7];
  const forward = times.map((t) => JSON.stringify(solveTwoBone({ root: S, target: targetAt(t), pole: POLE, l1: L1, l2: L2 })));
  const backward = [...times].reverse().map((t) => JSON.stringify(solveTwoBone({ root: S, target: targetAt(t), pole: POLE, l1: L1, l2: L2 }))).reverse();
  assert.deepEqual(forward, backward);
});

test('rig: solved bone lengths equal rig.json lengths; anchors match IK hands', () => {
  const rig = loadRig('human_basic');
  const solved = solvePose(rig, { root: { x: 360, y: 930 }, arms: { R: { x: 430, y: 900 }, L: { x: 290, y: 1000 } } });
  const J = solved.joints;
  const len = (a, b) => dist(J[a], J[b]);
  assert.ok(Math.abs(len('hip', 'chest') - 170) < 1e-9);
  assert.ok(Math.abs(len('hip_L', 'knee_L') - 150) < 1e-9);
  assert.ok(Math.abs(len('shoulder_R', 'elbow_R') - 135) < 1e-6);
  assert.ok(Math.abs(len('elbow_R', 'hand_R') - 120) < 1e-6);
  assert.deepEqual(solved.anchors.hand_R, J.hand_R);
  assert.deepEqual(solved.anchors.hand_L, J.hand_L);
  assert.equal(solved.arms.L.status, 'reached');
});

test('rig: unknown rig id and malformed pose are rejected', () => {
  assert.throws(() => loadRig('no_such_rig'));
  assert.throws(() => solvePose(loadRig('human_basic'), { root: { x: NaN, y: 1 } }), TypeError);
});
