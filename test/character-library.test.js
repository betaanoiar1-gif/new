import test from "node:test";
import assert from "node:assert/strict";
import { renderCharacterIllustration } from "../src/character-library.js";

const base = {
  id: "Mira", x: 180, y: 920, style: {
    skin: "#f2c6a0", shirt: "#3678d4", pants: "#263858", hair: "#342820"
  }, emotion: "neutral", talkAmount: 0, walkPhase: 0,
  waveAmount: 0, waveHand: "right", wavePhase: 0,
  ik: { elbow: { x: 273, y: 842 }, end: { x: 272, y: 872 } }
};

test("character asset is a detailed, reusable SVG illustration", () => {
  const svg = renderCharacterIllustration(base);
  assert.match(svg, /class="kpe-character"/);
  assert.match(svg, /data-character="Mira"/);
  assert.match(svg, /stroke="#293e59"/);
  assert.match(svg, /<ellipse/);
  assert.match(svg, /<circle/);
  assert.match(svg, /#f2c6a0/);
  assert.doesNotMatch(svg, /undefined|null/);
});

test("character illustration reflects expression and speech state", () => {
  const happy = renderCharacterIllustration({ ...base, emotion: "happy" });
  const talking = renderCharacterIllustration({ ...base, talkAmount: 0.8 });
  assert.notEqual(happy, renderCharacterIllustration(base));
  assert.notEqual(talking, renderCharacterIllustration(base));
});

test("character illustration remains safe with omitted optional pose fields", () => {
  const svg = renderCharacterIllustration({ id: "A", x: 100, y: 800 });
  assert.match(svg, /data-character="A"/);
  assert.doesNotMatch(svg, /NaN|undefined|null/);
});
