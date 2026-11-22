// Benchmark 2: a house that changes behind the robot's back.
//
//   node bench/dynamic.js          -> markdown tables
//   node bench/dynamic.js --json   -> machine-readable results
//
// Each episode:
//   1. the robot explores a new house until it has seen every room
//   2. it sits idle for 300 ticks while the household gets on with life
//      (moving things, closing doors, leaving clutter, the cat wandering)
//   3. it's asked to "bring me the <object>", with the household still active
//
// Objects never leave the house, so "it isn't here" is always the wrong answer.
// We compare two kinds of memory:
//   static - trusts what it saw; once a room is seen, it's never searched again
//   fresh  - timestamps sightings; if something isn't where it remembers and
//            there's nothing new to explore, it re-checks everywhere it hasn't
//            looked since the request

import { generateHouse } from '../src/house.js';
import { Robot } from '../src/robot.js';
import { Household } from '../src/household.js';
import { parse } from '../src/parser.js';
import { makeRng } from '../src/rng.js';

const SEEDS = Number(process.env.SEEDS ?? 200);
const IDLE = 300;

function episode(seed, { activity, memory, eyesight = 'good' }) {
  const house = generateHouse(seed);
  const household = new Household(house, { activity });
  const robot = new Robot(house, { memory, eyesight, world: household });
  robot.command(parse('explore the house'));
  robot.runToCompletion();
  for (let i = 0; i < IDLE; i++) household.step(robot);
  const target = makeRng(seed * 131 + 17).pick(house.objects).name;
  const movedBeforeAsked = (() => {
    const b = robot.objects.get(target);
    const o = house.objects.find((q) => q.name === target);
    return !b || b.x !== o.x || b.y !== o.y;
  })();
  robot.command(parse(`bring me the ${target}`));
  robot.runToCompletion();
  const r = robot.history.at(-1);
  return { ok: r.ok, ticks: r.ticks, falseMissing: !r.ok && /no \w+/.test(r.why ?? ''), stale: movedBeforeAsked };
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

function run(label, cond) {
  const eps = [];
  for (let s = 1; s <= SEEDS; s++) eps.push(episode(s, cond));
  const stale = eps.filter((e) => e.stale);
  return {
    label, ...cond,
    success: mean(eps.map((e) => +e.ok)),
    falseMissing: mean(eps.map((e) => +e.falseMissing)),
    meanSteps: mean(eps.filter((e) => e.ok).map((e) => e.ticks)),
    staleShare: stale.length / eps.length,
    successWhenStale: mean(stale.map((e) => +e.ok)),
    episodes: eps.length,
  };
}

const conditions = [
  ['Nobody home', { activity: 0 }],
  ['Lived-in', { activity: 1 }],
  ['Chaotic', { activity: 3 }],
  ['Nobody home, poor eyesight', { activity: 0, eyesight: 'poor' }],
];

const results = [];
for (const [label, c] of conditions) {
  for (const memory of ['static', 'fresh']) results.push(run(label, { ...c, memory }));
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ seeds: SEEDS, idle: IDLE, results }, null, 2));
} else {
  const pct = (x) => (Number.isNaN(x) ? 'n/a' : `${(x * 100).toFixed(1)}%`);
  console.log(`${SEEDS} houses per row. Robot explores, waits ${IDLE} ticks, then fetches one object.\n`);
  console.log('| House | Memory | Success | Said "not here" (wrongly) | Memory wrong when asked | Success when memory wrong | Mean steps (successes) |');
  console.log('|---|---|---|---|---|---|---|');
  for (const r of results) {
    console.log(`| ${r.label} | ${r.memory} | ${pct(r.success)} | ${pct(r.falseMissing)} | ${pct(r.staleShare)} | ${pct(r.successWhenStale)} | ${r.meanSteps.toFixed(0)} |`);
  }
}
