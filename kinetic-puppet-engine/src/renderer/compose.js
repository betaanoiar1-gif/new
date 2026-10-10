// Turns a sampled scene state into SVG markup. Draw order: furniture, characters, props, overlay.
// Props are drawn after characters so a held or passed object is never hidden behind a body.
import { renderCharacter } from '../rig/character.js';

const f = (n) => (Math.round(n * 100) / 100).toString();

function drawTable(p) {
  const x = p.position.x - 110, y = p.position.y;
  return `<g data-prop="${p.id}"><rect x="${x}" y="${y}" width="220" height="22" rx="4" fill="#8e5a2b"/>` +
    `<rect x="${x + 10}" y="${y + 22}" width="12" height="210" fill="#6b4423"/><rect x="${x + 198}" y="${y + 22}" width="12" height="210" fill="#6b4423"/></g>`;
}

function drawBook(id, pos) {
  const [x, y] = pos;
  return `<g data-prop="${id}" data-x="${f(x)}" data-y="${f(y)}"><rect x="${f(x - 27)}" y="${f(y - 20)}" width="54" height="40" rx="3" fill="#b91c1c"/>` +
    `<rect x="${f(x - 24)}" y="${f(y + 6)}" width="48" height="10" fill="#f8fafc"/></g>`;
}

export function composeMarkup(model, sample, story) {
  const parts = [];
  for (const p of story.props) if (p.type === 'table') parts.push(drawTable(p));
  for (const id of model.charOrder) {
    const c = model.chars[id];
    parts.push(renderCharacter({ id, pose: sample.chars[id].pose, style: c.style }).svg);
  }
  for (const p of story.props) if (p.type === 'book') parts.push(drawBook(p.id, sample.props[p.id]));
  if (sample.overlay.alpha > 0) {
    parts.push(`<rect data-overlay="transition" x="0" y="0" width="${model.width}" height="${model.height}" fill="${sample.overlay.color}" opacity="${f(sample.overlay.alpha)}"/>`);
  }
  return parts.join('');
}
