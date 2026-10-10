import test from "node:test";
import assert from "node:assert/strict";
import { renderPropIcon } from "../src/icon-library.js";
import { validateStory, evaluateScene, renderSvg } from "../src/engine.js";

test("illustrated SVG asset library renders every supported prop", () => {
  for (const type of ["book", "ball", "cup", "box", "chair"]) {
    const svg = renderPropIcon({ type, x: 100, y: 120, color: "#d94841" });
    assert.match(svg, /<g transform="translate\(100 120\)"/);
    assert.match(svg, /stroke="#342f3a"/);
    assert.match(svg, new RegExp('aria-label="' + type + '"'));
  }
});

test("scene camera push is deterministic and affects SVG framing", () => {
  const story = validateStory({
    version: "2.0",
    title: "Camera test",
    project: { width: 720, height: 1280, fps: 24, duration: 2 },
    characters: [{ id: "A", position: [180, 920] }],
    props: [{ id: "book", type: "book", position: { x: 360, y: 900 } }],
    scenes: [{
      id: "camera-push",
      duration: 2,
      background: "plain",
      transition: "none",
      camera: { motion: "push" },
      actions: []
    }]
  });
  const start = evaluateScene(story, 0, 0);
  const end = evaluateScene(story, 0, 2);
  assert.equal(start.camera.zoom, 1);
  assert.ok(end.camera.zoom > start.camera.zoom);
  assert.equal(end.camera.zoom, 1.12);
  const svg = renderSvg(end);
  assert.match(svg, /scale\(1\.12\)/);
  assert.match(svg, /aria-label="book"/);
});

test("existing scenes retain a static default camera", () => {
  const story = validateStory({
    version: "2.0",
    title: "Default camera",
    project: { width: 720, height: 1280, fps: 24, duration: 1 },
    characters: [{ id: "A" }],
    scenes: [{ id: "plain", duration: 1, background: "plain", actions: [] }]
  });
  assert.deepEqual(evaluateScene(story, 0, 0.5).camera, { x: 0, y: 0, zoom: 1 });
});
