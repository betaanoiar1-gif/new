// Zod schema for story.json (v2). Shape only; cross-references, bounds and timing are
// checked by src/validator/scenario.js because they depend on other fields.
import { z } from 'zod';

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'expected #rrggbb');
const id = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,31}$/, 'id must start with a letter, max 32 chars');
const num = z.number().finite();
const point = z.object({ x: num, y: num }).strict();
const time = z.number().finite().min(0).max(600);

const base = { t: time, duration: z.number().finite().min(0).max(600), char: id };

export const ACTIONS = ['walkTo', 'wave', 'pick', 'give', 'sitOn', 'react', 'talk', 'idle'];
export const EMOTIONS = ['happy', 'sad', 'surprised', 'neutral', 'angry', 'calm'];
export const PORTABLE_PROPS = ['book', 'cup'];
export const FURNITURE = ['chair', 'table'];

const actionSchema = z.discriminatedUnion('act', [
  z.object({ ...base, act: z.literal('walkTo'), to: z.tuple([num, num]) }).strict(),
  z.object({ ...base, act: z.literal('wave') }).strict(),
  z.object({ ...base, act: z.literal('pick'), target: id }).strict(),
  z.object({ ...base, act: z.literal('give'), target: id, prop: id }).strict(),
  z.object({ ...base, act: z.literal('sitOn'), target: id }).strict(),
  z.object({ ...base, act: z.literal('react'), emotion: z.enum(EMOTIONS) }).strict(),
  z.object({ ...base, act: z.literal('talk') }).strict(),
  z.object({ ...base, act: z.literal('idle') }).strict(),
]);

export const storySchema = z.object({
  version: z.literal('2.0'),
  title: z.string().max(120).optional(),
  project: z.object({
    width: z.number().int().min(180).max(2160),
    height: z.number().int().min(320).max(3840),
    fps: z.union([z.literal(24), z.literal(30)]),
    duration: z.number().min(0.5).max(60),
  }).strict(),
  characters: z.array(z.object({
    id,
    rig: z.literal('human_basic'),
    style: z.object({
      skin: hex,
      shirt: hex,
      hair: hex.optional(),
      pants: hex.optional(),
    }).strict(),
  }).strict()).min(1).max(8),
  props: z.array(z.object({
    id,
    type: z.enum([...PORTABLE_PROPS, ...FURNITURE]),
    position: point,
  }).strict()).max(32),
  scenes: z.array(z.object({
    id,
    duration: z.number().min(0.1).max(60),
    background: z.enum(['library', 'plain']),
    transition: z.enum(['none', 'fade', 'slide']).default('none'),
    actions: z.array(actionSchema).max(200),
  }).strict()).min(1).max(20),
}).strict();
