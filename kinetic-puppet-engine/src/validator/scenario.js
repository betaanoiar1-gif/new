// Scenario validation: Zod shape check, then semantic checks (references, bounds,
// time ranges, per-character overlap, prop possession). Unsafe values are rejected;
// only out-of-bounds walk targets are corrected (clamped) and reported as warnings.
import { storySchema, PORTABLE_PROPS, FURNITURE } from '../schema/story.js';

const EPS = 1e-9;
const err = (errors, code, path, message) => errors.push({ code, path, message });

export function validateScenario(raw) {
  const errors = [];
  const warnings = [];
  const parsed = storySchema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      err(errors, 'SCHEMA', issue.path.join('.') || '(root)', issue.message);
    }
    return { ok: false, errors, warnings, scenario: null };
  }
  // Work on a copy: callers' objects are never mutated.
  const s = structuredClone(parsed.data);
  const { width: W, height: H, duration: D } = s.project;

  // Unique ids.
  const uniq = (list, kind, path) => {
    const seen = new Set();
    for (const item of list) {
      if (seen.has(item.id)) err(errors, 'DUPLICATE_ID', `${path}.${item.id}`, `duplicate ${kind} id "${item.id}"`);
      seen.add(item.id);
    }
    return seen;
  };
  const charIds = uniq(s.characters, 'character', 'characters');
  const props = new Map(s.props.map((p) => [p.id, p]));
  uniq(s.props, 'prop', 'props');
  uniq(s.scenes, 'scene', 'scenes');

  // Props must start inside the frame.
  s.props.forEach((p, i) => {
    if (p.position.x < 0 || p.position.x > W || p.position.y < 0 || p.position.y > H) {
      err(errors, 'OUT_OF_BOUNDS', `props[${i}].position`, `prop "${p.id}" at (${p.position.x},${p.position.y}) is outside ${W}x${H}`);
    }
  });

  // Scene durations must add up to the project duration.
  const total = s.scenes.reduce((a, sc) => a + sc.duration, 0);
  if (Math.abs(total - D) > 1e-6) {
    err(errors, 'DURATION_MISMATCH', 'scenes', `scene durations sum to ${total}, project.duration is ${D}`);
  }

  // Possession state carried across the whole story (continuity of props).
  const holder = new Map(); // propId -> charId | null
  const ordered = s.scenes.map((sc, si) => ({ sc, si }));
  for (const { sc, si } of ordered) {
    const base = `scenes[${si}]`;
    const actionsByChar = new Map();
    const sortedByTime = sc.actions.map((a, ai) => ({ a, ai })).sort((x, y) => x.a.t - y.a.t || x.ai - y.ai);

    for (const { a, ai } of sortedByTime) {
      const p = `${base}.actions[${ai}]`;
      if (!charIds.has(a.char)) err(errors, 'UNKNOWN_CHARACTER', `${p}.char`, `unknown character "${a.char}"`);
      if (a.t + a.duration > sc.duration + EPS) {
        err(errors, 'TIME_RANGE', p, `action ends at ${a.t + a.duration}s, after scene duration ${sc.duration}s`);
      }
      if (!actionsByChar.has(a.char)) actionsByChar.set(a.char, []);
      actionsByChar.get(a.char).push({ start: a.t, end: a.t + a.duration, p });

      switch (a.act) {
        case 'walkTo': {
          const [x, y] = a.to;
          const cx = Math.min(W, Math.max(0, x));
          const cy = Math.min(H, Math.max(0, y));
          if (cx !== x || cy !== y) {
            warnings.push({ code: 'OUT_OF_BOUNDS_CLAMPED', path: `${p}.to`, message: `walkTo (${x},${y}) clamped to (${cx},${cy})` });
            a.to = [cx, cy];
          }
          break;
        }
        case 'pick': {
          const pr = props.get(a.target);
          if (!pr) { err(errors, 'MISSING_REFERENCE', `${p}.target`, `unknown prop "${a.target}"`); break; }
          if (!PORTABLE_PROPS.includes(pr.type)) err(errors, 'WRONG_PROP_TYPE', `${p}.target`, `"${a.target}" (${pr.type}) cannot be picked up`);
          if (holder.get(a.target)) err(errors, 'PROP_ALREADY_HELD', p, `"${a.target}" is held by "${holder.get(a.target)}"`);
          else holder.set(a.target, a.char);
          break;
        }
        case 'give': {
          const pr = props.get(a.prop);
          if (!pr) err(errors, 'MISSING_REFERENCE', `${p}.prop`, `unknown prop "${a.prop}"`);
          if (!charIds.has(a.target)) err(errors, 'MISSING_REFERENCE', `${p}.target`, `unknown character "${a.target}"`);
          if (a.target === a.char) err(errors, 'SELF_GIVE', p, `character "${a.char}" cannot give to itself`);
          if (pr && holder.get(a.prop) !== a.char) err(errors, 'PROP_NOT_HELD', p, `"${a.char}" does not hold "${a.prop}"`);
          if (pr && charIds.has(a.target)) holder.set(a.prop, a.target);
          break;
        }
        case 'sitOn': {
          const pr = props.get(a.target);
          if (!pr) err(errors, 'MISSING_REFERENCE', `${p}.target`, `unknown prop "${a.target}"`);
          else if (!FURNITURE.includes(pr.type)) err(errors, 'WRONG_PROP_TYPE', `${p}.target`, `"${a.target}" (${pr.type}) is not sittable`);
          break;
        }
        default: break;
      }
    }

    // One action at a time per character.
    for (const [cid, list] of actionsByChar) {
      list.sort((x, y) => x.start - y.start);
      for (let i = 1; i < list.length; i += 1) {
        if (list[i].start < list[i - 1].end - EPS) {
          err(errors, 'OVERLAP', list[i].p, `"${cid}" action overlaps the previous action (${list[i - 1].start}-${list[i - 1].end}s)`);
        }
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings, scenario: errors.length === 0 ? s : null };
}
