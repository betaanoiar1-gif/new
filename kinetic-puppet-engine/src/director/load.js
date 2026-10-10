// Loads a story from a file or string. Parse errors are returned, not thrown, so that
// callers (CLI, director) can report them and decide whether a bounded repair is allowed.
import { readFileSync } from 'node:fs';
import { validateScenario } from '../validator/scenario.js';

export function parseStoryText(text) {
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch (e) {
    return { ok: false, errors: [{ code: 'PARSE', path: '(root)', message: e.message }] };
  }
}

export function loadStoryFile(path) {
  const parsed = parseStoryText(readFileSync(path, 'utf8'));
  if (!parsed.ok) return { ok: false, errors: parsed.errors, warnings: [], scenario: null };
  return validateScenario(parsed.data);
}
