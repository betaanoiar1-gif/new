// Motion model. Every channel is a list of segments; each segment starts from the value the
// channel had at its start time (continuity by construction). sampleAt(model, t) is a pure
// function of t: frames can be requested in any order and recomputed directly.
import { loadRig, solvePose } from '../rig/skeleton.js';
import { RENDER_ACTIONS } from '../validator/scenario.js';

export class ScenarioError extends Error {
  constructor(code, message, details = {}) { super(message); this.code = code; this.details = details; }
}

export const ROOT_Y = 930;          // characters stand on this hip line (feet ~1230 on a 1280 frame)
export const DEFAULT_START_X = 360;
export const HANG = { L: [-66, 87], R: [66, 87] };   // relaxed arm, offset from the hip
export const STRIDE = 150;           // px per gait cycle
export const FADE_SEC = 0.75;
export const FADE_MAX_ALPHA = 0.85;
const DARK = '#1b1f2a';

const lerp = (a, b, u) => a + (b - a) * u;
const lerpPt = (a, b, u) => [lerp(a[0], b[0], u), lerp(a[1], b[1], u)];
export const ease = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const isPt = (v) => Array.isArray(v);

function valueOf(ch, t) {
  let v = ch.initial;
  for (const s of ch.segs) {
    if (t < s.t0) break;
    if (t >= s.t1) { v = s.to; continue; }
    const u = ease((t - s.t0) / (s.t1 - s.t0));
    return isPt(s.to) ? lerpPt(s.from, s.to, u) : lerp(s.from, s.to, u);
  }
  return v;
}

function addSeg(ch, t0, t1, to, label) {
  const last = ch.segs[ch.segs.length - 1];
  if (last && t0 < last.t1 - 1e-9) {
    throw new ScenarioError('TIME_OVERLAP', `${label} overlaps an earlier change on the same channel`, { t0, prevEnd: last.t1 });
  }
  if (!(t1 > t0)) throw new ScenarioError('ZERO_DURATION', `${label} must have positive duration`);
  ch.segs.push({ t0, t1, from: valueOf(ch, t0), to });
}

/** Builds the model from a validated scenario. Throws ScenarioError on motion-level problems. */
export function buildTimeline(story) {
  const chars = {};
  for (const c of story.characters) {
    chars[c.id] = {
      id: c.id,
      style: c.style,
      root: { initial: c.start?.x ?? DEFAULT_START_X, segs: [] },
      armL: { initial: HANG.L, segs: [] },
      armR: { initial: HANG.R, segs: [] },
      expr: [{ t0: 0, value: 'neutral' }],
      walks: [],
    };
  }
  const props = {};
  for (const p of story.props) props[p.id] = { id: p.id, type: p.type, rest: [p.position.x, p.position.y], events: [] };
  const fades = [];

  // Map every action to global time, then process in time order so channels stay sorted.
  const jobs = [];
  let offset = 0;
  for (const sc of story.scenes) {
    for (const a of sc.actions) jobs.push({ a, t0: offset + a.t, t1: offset + a.t + a.duration });
    if (sc.transition === 'fade') fades.push({ t1: offset + sc.duration });
    offset += sc.duration;
  }
  jobs.sort((x, y) => x.t0 - y.t0 || (x.a.char < y.a.char ? -1 : 1));

  const warnings = [];
  const rootAt = (id, t) => valueOf(chars[id].root, t);
  for (const { a, t0, t1 } of jobs) {
    if (!RENDER_ACTIONS.includes(a.act)) throw new ScenarioError('ACTION_NOT_IMPLEMENTED', `action ${a.act} not implemented`);
    const c = chars[a.char];
    const label = `${a.char}.${a.act}@${t0.toFixed(2)}`;
    switch (a.act) {
      case 'walkTo': {
        addSeg(c.root, t0, t1, a.to[0], label);
        c.walks.push([t0, t1]);
        if (Math.abs(a.to[1] - ROOT_Y) > 1e-6) warnings.push({ code: 'WALK_Y_IGNORED', message: `${label}: y=${a.to[1]} ignored, characters stand at y=${ROOT_Y}` });
        break;
      }
      case 'pick': {
        const p = props[a.target];
        if (p.events.length && p.events[p.events.length - 1].to.char !== a.char) {
          throw new ScenarioError('PROP_NOT_REACHABLE', `${label}: ${a.target} is not at rest`);
        }
        const rootX = rootAt(a.char, t1);
        const side = p.rest[0] <= rootX ? 'L' : 'R';
        const arm = side === 'L' ? c.armL : c.armR;
        addSeg(arm, t0, t1, [p.rest[0] - rootX, p.rest[1] - ROOT_Y], label);
        p.events.push({ type: 'pick', t0, t1, from: { pos: p.rest }, to: { char: a.char, arm: side } });
        break;
      }
      case 'give': {
        const holderEv = props[a.prop].events[props[a.prop].events.length - 1];
        if (!holderEv || holderEv.to.char !== a.char) throw new ScenarioError('PROP_NOT_HELD', `${label}: giver does not hold ${a.prop}`);
        const giver = c;
        const recv = chars[a.target];
        const gSide = holderEv.to.arm;
        const rSide = rootAt(a.target, t0) < rootAt(a.char, t0) ? 'R' : 'L';
        for (const other of [giver.id, recv.id]) {
          if (chars[other].walks.some(([w0, w1]) => w0 < t1 && w1 > t0)) {
            throw new ScenarioError('ACTION_CONFLICT', `${label}: ${other} is walking during the hand-off`);
          }
        }
        const gx = (rootAt(a.char, t1) + rootAt(a.target, t1)) / 2;
        const gy = ROOT_Y - 30;
        addSeg(gSide === 'L' ? giver.armL : giver.armR, t0, t1, [gx - rootAt(a.char, t1), gy - ROOT_Y], label + ':giver');
        addSeg(rSide === 'L' ? recv.armL : recv.armR, t0, t1, [gx - rootAt(a.target, t1), gy - ROOT_Y], label + ':receiver');
        props[a.prop].events.push({ type: 'give', t0, t1, from: { char: a.char, arm: gSide }, to: { char: a.target, arm: rSide } });
        break;
      }
      case 'react': {
        recvExpr(c, t0, a.emotion);
        c.expr.push({ t0: t1, value: 'neutral' });
        break;
      }
      case 'idle':
        break;
      default:
        throw new ScenarioError('ACTION_NOT_IMPLEMENTED', `action ${a.act} not implemented`);
    }
  }
  // Expression list must be sorted by time (react reverts can overlap a later react).
  for (const c of Object.values(chars)) c.expr.sort((x, y) => x.t0 - y.t0);

  const model = { rig: loadRig('human_basic'), width: story.project.width, height: story.project.height, duration: story.project.duration, fps: story.project.fps, chars, props, fades, warnings, charOrder: story.characters.map((c) => c.id), propOrder: story.props.map((p) => p.id) };
  verifyReach(model);
  return model;
}

function recvExpr(c, t0, emotion) { c.expr.push({ t0, value: emotion }); }

function exprAt(c, t) {
  let v = 'neutral';
  for (const e of c.expr) { if (e.t0 <= t) v = e.value; }
  return v;
}

function propPos(p, t, anchor) {
  let ev = null;
  for (const e of p.events) { if (e.t0 <= t) ev = e; }
  if (!ev) return p.rest;
  const toPos = anchor(ev.to.char, ev.to.arm);
  if (t >= ev.t1) return toPos;
  const fromPos = 'pos' in ev.from ? ev.from.pos : anchor(ev.from.char, ev.from.arm);
  return lerpPt(fromPos, toPos, ease((t - ev.t0) / (ev.t1 - ev.t0)));
}

/** Pure sample of the whole scene at time t (seconds). */
export function sampleAt(model, t) {
  const chars = {};
  for (const id of model.charOrder) {
    const c = model.chars[id];
    const root = valueOf(c.root, t);
    const aL = valueOf(c.armL, t);
    const aR = valueOf(c.armR, t);
    let amp = 0;
    for (const [w0, w1] of c.walks) {
      if (t > w0 - 0.25 && t < w1 + 0.25) amp = Math.max(amp, ease(Math.min((t - w0) / 0.25, (w1 - t) / 0.25)));
    }
    const pose = {
      root: { x: root, y: ROOT_Y },
      arms: { L: { x: root + aL[0], y: ROOT_Y + aL[1] }, R: { x: root + aR[0], y: ROOT_Y + aR[1] } },
      expression: exprAt(c, t),
      gait: { amp: Math.min(1, Math.max(0, amp)), phase: (root * 2 * Math.PI) / STRIDE },
    };
    chars[id] = { root, pose, solved: solvePose(model.rig, pose) };
  }
  const props = {};
  const anchor = (charId, arm) => { const h = chars[charId].solved.anchors[`hand_${arm}`]; return [h.x, h.y]; };
  for (const id of model.propOrder) props[id] = propPos(model.props[id], t, anchor);

  let overlay = 0;
  for (const f of model.fades) {
    const start = f.t1 - FADE_SEC;
    if (t >= start) overlay = Math.max(overlay, FADE_MAX_ALPHA * ease((t - start) / FADE_SEC));
  }
  return { t, chars, props, overlay: { color: DARK, alpha: Math.min(1, overlay) } };
}

/** Every arm target that a pick/give relies on must be reached (not clamped) at the event end. */
function verifyReach(model) {
  for (const p of Object.values(model.props)) {
    for (const ev of p.events) {
      const s = sampleAt(model, ev.t1);
      const checks = [[ev.to.char, ev.to.arm]];
      if (ev.type === 'give') checks.push([ev.from.char, ev.from.arm]);
      for (const [cid, arm] of checks) {
        const st = s.chars[cid].solved.arms[arm];
        if (st.status !== 'reached') {
          throw new ScenarioError('UNREACHABLE', `${cid} cannot reach the ${ev.type} point (${st.status}, error ${st.reachError.toFixed(1)}px)`, { character: cid, arm, t: ev.t1 });
        }
      }
    }
  }
}
