// Two-bone analytic IK in the plane (law of cosines).
// Pure function: the same inputs always give the same outputs, so any frame can be
// recomputed directly from its time and target (no accumulated state).
//
// Handles: targets beyond max reach (clamped to the line toward the target, flagged),
// targets inside min reach |l1-l2| (clamped, flagged), zero distance (degenerate direction),
// bend direction (pole point decides which side the elbow lies on), invalid numbers (throws).

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const cross = (ax, ay, bx, by) => ax * by - ay * bx;

export function solveTwoBone({ root, target, pole, l1, l2, eps = 1e-6 }) {
  for (const [name, p] of [['root', root], ['target', target], ['pole', pole]]) {
    if (!p || !isNum(p.x) || !isNum(p.y)) throw new TypeError(`${name} must be finite {x,y}`);
  }
  if (!isNum(l1) || !isNum(l2) || l1 <= 0 || l2 <= 0) throw new RangeError('bone lengths must be positive');

  const dx = target.x - root.x;
  const dy = target.y - root.y;
  const dRaw = Math.hypot(dx, dy);
  const minReach = Math.abs(l1 - l2);
  const maxReach = l1 + l2;

  // Direction toward the target; if the target sits on the root, use the pole direction.
  let ux, uy;
  if (dRaw < eps) {
    const px = pole.x - root.x, py = pole.y - root.y;
    const pl = Math.hypot(px, py) || 1;
    ux = px / pl; uy = py / pl;
  } else {
    ux = dx / dRaw; uy = dy / dRaw;
  }

  let status = 'reached';
  let d = dRaw;
  if (dRaw > maxReach) { d = maxReach; status = 'clamped_far'; }
  else if (dRaw < minReach) { d = minReach; status = 'clamped_near'; }
  if (d < eps) { d = eps; status = status === 'reached' ? 'degenerate' : status; }

  // Angle at the root between the root->target line and the upper bone.
  const cosA = clamp((d * d + l1 * l1 - l2 * l2) / (2 * d * l1), -1, 1);
  const alpha = Math.acos(cosA);
  const base = Math.atan2(uy, ux);

  const candidates = [base + alpha, base - alpha].map((a) => ({
    x: root.x + l1 * Math.cos(a),
    y: root.y + l1 * Math.sin(a),
  }));
  // Choose the elbow on the same side of the root->target line as the pole.
  const poleSide = Math.sign(cross(ux, uy, pole.x - root.x, pole.y - root.y)) || 1;
  const elbow = candidates.find((c) => Math.sign(cross(ux, uy, c.x - root.x, c.y - root.y)) === poleSide) || candidates[0];

  const hand = status === 'reached'
    ? { x: target.x, y: target.y }
    : { x: root.x + ux * d, y: root.y + uy * d };

  const bone1 = Math.hypot(elbow.x - root.x, elbow.y - root.y);
  const bone2 = Math.hypot(hand.x - elbow.x, hand.y - elbow.y);
  const result = {
    elbow, hand, status,
    reachError: Math.hypot(target.x - hand.x, target.y - hand.y),
    boneError: Math.max(Math.abs(bone1 - l1), Math.abs(bone2 - l2)),
    reachable: status === 'reached',
  };
  if (![result.elbow.x, result.elbow.y, result.hand.x, result.hand.y, result.reachError, result.boneError].every(Number.isFinite)) {
    throw new Error('IK produced a non-finite value');
  }
  return result;
}
