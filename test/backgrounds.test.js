import test from "node:test";
import assert from "node:assert/strict";
import { renderBackground } from "../src/engine.js";

test("each environment renders layered illustrated background details", () => {
  const cases = {
    library: ["kpe-wall", "kpe-floor", "url", "#9a6947"],
    park: ["kpe-wall", "kpe-floor", "#f5d779", "#b77b45"],
    room: ["kpe-wall", "kpe-floor", "#8bb9d6", "#c08b58"],
    plain: ["kpe-wall", "kpe-floor", "#f5f0e6"]
  };
  for (const [name, needles] of Object.entries(cases)) {
    const svg = renderBackground(name, 720, 1280);
    assert.match(svg, /<defs>/, name + " defines depth gradients");
    assert.match(svg, /<rect width="720" height="1280"/, name + " fills the canvas");
    for (const needle of needles) assert.ok(svg.includes(needle), name + " missing " + needle);
    assert.doesNotMatch(svg, /undefined|NaN/, name + " must not contain invalid values");
  }
});

test("backgrounds are stable for identical inputs", () => {
  assert.equal(renderBackground("library", 720, 1280), renderBackground("library", 720, 1280));
});
