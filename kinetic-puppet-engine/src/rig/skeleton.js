// Skeleton solve: rest joints (from rig.json) + lean + IK arms -> world joint positions.
// Pure function of (rig, pose). Legs stay in rest pose; arms are solved with two-bone IK.
import { readFileSync } from 'node:fs';
import { solveTwoBone } from './ik.js';

const RIG_CACHE = new Map();
export function loadRig(id = 'human_basic') {
  if (!RIG_CACHE.has(id)) {
    const url = new URL(`./${id}.rig.json`, import.meta.url);
    const rig = JSON.parse(readFileSync(url, 'utf8'));
    if (rig.id !== id) throw new Error(`rig file id mismatch: ${rig.id} != ${id}`);
    RIG_CACHE.set(id, Object.freeze(rig));
  }
  return RIG_CACHE.get(id);
}

const rot = (x, y, rad) => ({ x: x * Math.cos(rad) - y * Math.sin(rad), y: x * Math.sin(rad) + y * Math.cos(rad) });

/**
 * pose: { root:{x,y}, lean?:deg, arms?:{L?:{x,y}|null, R?:{x,y}|null}, expression? }
 * Returns { joints, arms, anchors, bones } with world coordinates.
 */
export function solvePose(rig, pose) {
  const root = pose.root;
  if (!root || !Number.isFinite(root.x) || !Number.isFinite(root.y)) throw new TypeError('pose.root must be finite {x,y}');
  const leanRad = ((pose.lean ?? 0) * Math.PI) / 180;
  const upper = new Set(rig.upper_body_joints);

  const joints = { hip: { x: root.x, y: root.y } };
  for (const [name, [ox, oy]] of Object.entries(rig.joints_rest)) {
    const r = upper.has(name) ? rot(ox, oy, leanRad) : { x: ox, y: oy };
    joints[name] = { x: root.x + r.x, y: root.y + r.y };
  }

  // Gait: legs swing from the root's x position (pure function of pose, no accumulated state).
  if (pose.gait && pose.gait.amp > 0) {
    for (const side of ['L', 'R']) {
      const sw = Math.sin(pose.gait.phase + (side === 'R' ? Math.PI : 0)) * pose.gait.amp;
      joints[`knee_${side}`] = { x: joints[`knee_${side}`].x + sw * 14, y: joints[`knee_${side}`].y };
      joints[`foot_${side}`] = { x: joints[`foot_${side}`].x + sw * 30, y: joints[`foot_${side}`].y - Math.max(0, sw) * 12 };
    }
  }

  const arms = {};
  for (const side of ['L', 'R']) {
    const spec = rig.arms[side];
    const shoulder = joints[spec.root];
    const sign = side === 'L' ? -1 : 1;
    const requested = pose.arms?.[side];
    // Default: relaxed arm hanging slightly outward.
    const target = requested ?? { x: shoulder.x + sign * 22, y: shoulder.y + spec.upper.length + spec.fore.length - 8 };
    const pole = { x: shoulder.x + spec.pole_dir[0] * 100, y: shoulder.y + spec.pole_dir[1] * 100 };
    const ik = solveTwoBone({ root: shoulder, target, pole, l1: spec.upper.length, l2: spec.fore.length });
    arms[side] = { ...ik, target: { x: target.x, y: target.y } };
    joints[spec.elbow] = ik.elbow;
    joints[spec.hand] = ik.hand;
  }

  const anchors = {
    hand_L: joints.hand_L,
    hand_R: joints.hand_R,
  };
  const lapOff = rig.anchors.lap.offset;
  anchors.lap = { x: joints.hip.x + lapOff[0], y: joints.hip.y + lapOff[1] };

  return { joints, arms, anchors, expression: pose.expression ?? 'neutral' };
}
