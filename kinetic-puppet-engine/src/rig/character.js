// SVG character renderer. Structure is fixed by rig.json; only colours (style) vary.
// Output is plain SVG markup in stage coordinates (no transforms), so anchors can be measured directly.
import { loadRig, solvePose } from './skeleton.js';

export const DEFAULT_STYLE = Object.freeze({
  skin: '#f1c27d',
  shirt: '#3b82f6',
  pants: '#334155',
  hair: '#2b1d12',
  shoes: '#1f2937',
});

const HEX = /^#[0-9a-fA-F]{6}$/;
const f = (n) => (Math.round(n * 100) / 100).toString();

function line(a, b, color, width) {
  return `<line x1="${f(a.x)}" y1="${f(a.y)}" x2="${f(b.x)}" y2="${f(b.y)}" stroke="${color}" stroke-width="${width}" stroke-linecap="round"/>`;
}

function expressionSvg(h, expr, hx, hy) {
  const eyeY = hy - 6;
  const eyes = `<circle cx="${f(hx - 22)}" cy="${f(eyeY)}" r="6" fill="#111827"/><circle cx="${f(hx + 22)}" cy="${f(eyeY)}" r="6" fill="#111827"/>`;
  const my = hy + 30;
  let mouth;
  if (expr === 'happy') mouth = `<path d="M ${f(hx - 20)} ${f(my - 6)} Q ${f(hx)} ${f(my + 16)} ${f(hx + 20)} ${f(my - 6)}" fill="none" stroke="#7c2d12" stroke-width="4" stroke-linecap="round"/>`;
  else if (expr === 'sad') mouth = `<path d="M ${f(hx - 18)} ${f(my + 6)} Q ${f(hx)} ${f(my - 8)} ${f(hx + 18)} ${f(my + 6)}" fill="none" stroke="#7c2d12" stroke-width="4" stroke-linecap="round"/>`;
  else if (expr === 'surprised') mouth = `<ellipse cx="${f(hx)}" cy="${f(my)}" rx="8" ry="11" fill="#7c2d12"/>`;
  else mouth = `<line x1="${f(hx - 14)}" y1="${f(my)}" x2="${f(hx + 14)}" y2="${f(my)}" stroke="#7c2d12" stroke-width="4" stroke-linecap="round"/>`;
  return eyes + mouth;
}

/** Returns SVG markup for one character at a pose. style: partial colour overrides (#rrggbb). */
export function renderCharacter({ id, rigId = 'human_basic', pose, style = {} }) {
  const rig = loadRig(rigId);
  const st = { ...DEFAULT_STYLE, ...style };
  for (const k of Object.keys(st)) if (!HEX.test(st[k])) throw new TypeError(`style.${k} must be #rrggbb`);
  const solved = solvePose(rig, pose);
  const J = solved.joints;
  const col = (part) => (part === 'skin' ? st.skin : part === 'shirt' ? st.shirt : part === 'pants' ? st.pants : st.skin);
  const parts = [];

  // Legs (behind torso).
  for (const b of ['thigh_L', 'shin_L', 'thigh_R', 'shin_R']) {
    const bone = rig.bones[b];
    parts.push(line(J[bone.from], J[bone.to], col(bone.part), bone.width));
  }
  parts.push(`<ellipse cx="${f(J.foot_L.x + 8)}" cy="${f(J.foot_L.y + 6)}" rx="24" ry="11" fill="${st.shoes}"/>`);
  parts.push(`<ellipse cx="${f(J.foot_R.x + 8)}" cy="${f(J.foot_R.y + 6)}" rx="24" ry="11" fill="${st.shoes}"/>`);

  // Torso: shoulders + hips polygon with rounded join.
  const torso = [J.shoulder_L, J.shoulder_R, J.hip_R, J.hip_L]
    .map((p) => `${f(p.x)},${f(p.y)}`).join(' ');
  parts.push(`<polygon points="${torso}" fill="${st.shirt}" stroke="${st.shirt}" stroke-width="34" stroke-linejoin="round"/>`);
  parts.push(line(J.chest, J.neck, st.skin, rig.bones.neck_bone.width));

  // Arms: upper (sleeve) and forearm (skin), hands as anchor circles.
  for (const side of ['L', 'R']) {
    const spec = rig.arms[side];
    parts.push(line(J[spec.root], J[spec.elbow], st.shirt, spec.upper.width));
    parts.push(line(J[spec.elbow], J[spec.hand], st.skin, spec.fore.width));
    const h = J[spec.hand];
    parts.push(`<circle cx="${f(h.x)}" cy="${f(h.y)}" r="17" fill="${st.skin}" data-anchor="hand_${side}" data-char="${id ?? ''}"/>`);
  }

  // Head: skin disc, hair cap, face.
  const hd = J.head;
  const R = rig.head.radius;
  parts.push(`<circle cx="${f(hd.x)}" cy="${f(hd.y)}" r="${R}" fill="${st.skin}"/>`);
  parts.push(`<path d="M ${f(hd.x - R)} ${f(hd.y - 4)} A ${R} ${R} 0 0 1 ${f(hd.x + R)} ${f(hd.y - 4)} Q ${f(hd.x + 40)} ${f(hd.y - 30)} ${f(hd.x)} ${f(hd.y - 28)} Q ${f(hd.x - 40)} ${f(hd.y - 30)} ${f(hd.x - R)} ${f(hd.y - 4)} Z" fill="${st.hair}"/>`);
  parts.push(expressionSvg(hd, solved.expression, hd.x, hd.y));

  return { svg: `<g class="kpe-char" data-char="${id ?? ''}">${parts.join('')}</g>`, solved };
}
