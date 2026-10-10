import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {validateStory,solveTwoBoneIK,evaluateStory,renderSvg} from "../src/engine.js";
const demo=()=>JSON.parse(fs.readFileSync(new URL("../examples/book-handoff.json",import.meta.url),"utf8"));
test("example story validates and sums duration",()=>assert.equal(validateStory(demo()).project.duration,8));
test("unknown character is rejected",()=>{const s=demo();s.scenes[0].actions[0].char="ghost";assert.throws(()=>validateStory(s),/Unknown character/);});
test("absolute time seeking is deterministic",()=>{const s=validateStory(demo()),a=JSON.stringify(evaluateStory(s,3.6));evaluateStory(s,7.4);assert.equal(a,JSON.stringify(evaluateStory(s,3.6)));});
test("book transfers from A to B",()=>{const s=validateStory(demo());assert.equal(evaluateStory(s,3.5).props[0].attachedTo.characterId,"A");assert.equal(evaluateStory(s,4.4).props[0].attachedTo.characterId,"B");});
test("IK reaches reachable target",()=>{const r=solveTwoBoneIK({x:0,y:0},{x:40,y:30},43,40);assert.ok(Math.hypot(r.end.x-40,r.end.y-30)<.01);});
test("IK clamps unreachable target",()=>{const r=solveTwoBoneIK({x:0,y:0},{x:500,y:0},43,40);assert.equal(r.reachable,false);assert.ok(Number.isFinite(r.end.x)&&r.end.x<84);});
test("IK rejects zero length",()=>assert.throws(()=>solveTwoBoneIK({x:0,y:0},{x:1,y:1},0,2),/positive/));

test("talk action creates a changing mouth state",()=>{const s=demo();s.scenes[0].actions.push({t:0,duration:2,char:"A",act:"talk"});const a=evaluateStory(validateStory(s),.2).characters.find(c=>c.id==="A");const b=evaluateStory(validateStory(s),.8).characters.find(c=>c.id==="A");assert.ok(a.talkAmount>0);assert.ok(b.talkAmount>0);});
test("SVG output is valid-shaped and escapes scene text",()=>{const s=validateStory(demo());const svg=renderSvg(evaluateStory(s,0));assert.match(svg,/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);assert.match(svg,/<\/svg>$/);assert.match(svg,/A Small Act of Kindness/);});
test("sitOn rejects non-chair props",()=>{const s=demo();s.scenes[0].actions.push({t:6,duration:1,char:"A",act:"sitOn",target:"book"});assert.throws(()=>validateStory(s),/must be a chair/);});
test("duplicate IDs are rejected",()=>{const s=demo();s.characters.push({...s.characters[0]});assert.throws(()=>validateStory(s),/Duplicate character id/);});

test("character and held prop continuity survives scene boundary",()=>{const s=demo();s.scenes.push({id:"after-handoff",duration:2,background:"library",actions:[],transition:"none"});s.project.duration=10;const next=evaluateStory(validateStory(s),9);assert.ok(Math.abs(next.characters.find(c=>c.id==="A").x-340)<.01);assert.equal(next.props[0].attachedTo.characterId,"B");});

test("held book stays at the holder hand target",()=>{const s=validateStory(demo()),state=evaluateStory(s,6.5),b=state.characters.find(c=>c.id==="B"),book=state.props[0];assert.ok(Math.abs(b.armTarget.x-book.x)<.001);assert.ok(Math.abs(b.armTarget.y-book.y)<.001);assert.ok(Math.hypot(b.ik.end.x-book.x,b.ik.end.y-book.y)<.01);});

test("multi-scene example preserves handoff state",()=>{const s=validateStory(JSON.parse(fs.readFileSync(new URL("../examples/multi-scene-continuity.json",import.meta.url),"utf8")));const state=evaluateStory(s,6.5);assert.equal(state.sceneIndex,1);assert.equal(state.globalTime,6.5);assert.equal(state.props[0].attachedTo.characterId,"B");assert.equal(state.characters.find(c=>c.id==="B").emotion,"happy");assert.ok(Math.abs(state.characters.find(c=>c.id==="A").x-340)<.01);});

test("unsupported rig types are rejected explicitly",()=>{const s=demo();s.characters[0].rig="quadruped";assert.throws(()=>validateStory(s),/Invalid enum value/);});

test("sitOn applies the chair pose and position",()=>{const s=demo();s.props.push({id:"chair",type:"chair",position:{x:360,y:920}});s.scenes[0].actions.push({t:6,duration:1,char:"A",act:"sitOn",target:"chair"});const c=evaluateStory(validateStory(s),6.5).characters.find(c=>c.id==="A");assert.equal(c.sitting,true);assert.equal(c.x,315);assert.equal(c.y,948);});

test("left-hand wave is represented in the evaluated rig state",()=>{const s=demo();s.scenes[0].actions.push({t:6,duration:1,char:"A",act:"wave",hand:"left"});const c=evaluateStory(validateStory(s),6.5).characters.find(c=>c.id==="A");assert.equal(c.waveHand,"left");assert.ok(c.waveAmount>0);assert.ok(renderSvg(evaluateStory(validateStory(s),6.5)).includes("<svg"));});
