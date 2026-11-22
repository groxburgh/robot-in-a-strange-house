// Benchmark 1: do room hints help a robot find things in a house it has never seen?
//
//   node bench/run.js            -> markdown table
//   node bench/run.js --json     -> machine-readable results
//
// For each seed we generate a fresh house and give the robot one errand. We
// cross three ways the house can be messy with three kinds of hint:
//
//   Where things are left (the world)
//     housekeep - where Housekeep's human annotators said such things end up
//     procthor  - somewhere in the rooms ProcTHOR says they belong in
//     random    - anywhere at all
//
//   Robot's room hints
//     naive     - none: nearest unexplored edge first
//     procthor  - common sense from ProcTHOR's room annotations
//     housekeep - the same human data that scattered the mess (a ceiling, not
//                 a fair contestant, when the world is "housekeep")
//
// SPL = Success weighted by Path Length (Anderson et al., 2018): for each
// episode, success * oracle / max(actual, oracle). 1.0 means the robot did as
// well as if it had been given the floor plan and object positions in advance.

import { generateHouse } from '../src/house.js';
import { Robot } from '../src/robot.js';
import { parse } from '../src/parser.js';
import { oracleDeliver } from '../src/oracle.js';
import { makeRng } from '../src/rng.js';
import { isTidy } from '../src/catalog.js';

const SEEDS = Number(process.env.SEEDS ?? 300);
const WORLDS = ['housekeep', 'procthor', 'random'];
const HINTS = ['naive', 'procthor', 'housekeep'];

function errandFor(house, seed) {
  const rng = makeRng(seed * 7919 + 13);
  const o = rng.pick(house.objects);
  if (rng.chance(0.5)) return { text: `bring me the ${o.name}`, obj: o.name, dest: { kind: 'user' } };
  const f = rng.pick(house.furniture.filter((q) => q.name !== o.on));
  return { text: `put the ${o.name} on the ${f.name}`, obj: o.name, dest: { kind: 'furniture', names: [f.name] } };
}

function runEpisode(seed, placement, strategy) {
  const house = generateHouse(seed, { placement });
  const errand = errandFor(house, seed);
  const oracle = oracleDeliver(house, errand.obj, errand.dest);
  const robot = new Robot(house, { strategy });
  robot.command(parse(errand.text));
  robot.runToCompletion();
  const r = robot.history[0];
  return { ok: r.ok, ticks: r.ticks, oracle, spl: r.ok ? oracle / Math.max(r.ticks, oracle) : 0 };
}

function runTidy(seed) {
  const house = generateHouse(seed);
  const robot = new Robot(house);
  robot.command(parse('tidy up'));
  robot.runToCompletion();
  const present = new Set(house.furniture.map((f) => f.name));
  const allAway = house.objects.every((o) => o.on && isTidy(o.name, o.on, present));
  return { ok: robot.history[0].ok && allAway, ticks: robot.history[0].ticks };
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

// 95% bootstrap interval for the mean paired difference in steps (hint - none),
// resampling houses. Same houses and errands for every strategy, so pairing is fair.
function pairedCI(a, b, seed = 1) {
  const d = a.map((x, i) => x.ticks - b[i].ticks);
  const rng = makeRng(seed);
  const means = [];
  for (let k = 0; k < 2000; k++) {
    let t = 0;
    for (let i = 0; i < d.length; i++) t += d[Math.floor(rng.next() * d.length)];
    means.push(t / d.length);
  }
  means.sort((x, y) => x - y);
  return { diff: mean(d), lo: means[49], hi: means[1949] };
}

const results = [];
for (const placement of WORLDS) {
  let baseline = null;
  for (const strategy of HINTS) {
    const eps = [];
    for (let s = 1; s <= SEEDS; s++) eps.push(runEpisode(s, placement, strategy));
    if (strategy === 'naive') baseline = eps;
    results.push({
      vsNone: strategy === 'naive' ? null : pairedCI(eps, baseline),
      placement, strategy,
      success: mean(eps.map((e) => (e.ok ? 1 : 0))),
      spl: mean(eps.map((e) => e.spl)),
      meanSteps: mean(eps.map((e) => e.ticks)),
      oracleSteps: mean(eps.map((e) => e.oracle)),
      episodes: eps.length,
    });
  }
}
const tidyEps = [];
for (let s = 1; s <= Math.min(SEEDS, 100); s++) tidyEps.push(runTidy(s));
const tidy = { success: mean(tidyEps.map((e) => +e.ok)), meanSteps: mean(tidyEps.map((e) => e.ticks)), episodes: tidyEps.length };

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ seeds: SEEDS, results, tidy }, null, 2));
} else {
  const W = { housekeep: 'Where people leave things (Housekeep)', procthor: 'In the rooms they belong in (ProcTHOR)', random: 'Anywhere (random)' };
  const H = { naive: 'None', procthor: 'Common sense (ProcTHOR)', housekeep: 'Human data (Housekeep)' };
  console.log(`${SEEDS} houses per row, one errand each.\n`);
  console.log('| Where things were left | Robot\'s room hints | Success | SPL | Mean steps | Change vs no hints (95% CI) | Steps with floor plan |');
  console.log('|---|---|---|---|---|---|---|');
  for (const r of results) {
    const ci = r.vsNone ? `${r.vsNone.diff > 0 ? '+' : ''}${r.vsNone.diff.toFixed(1)} (${r.vsNone.lo.toFixed(1)} to ${r.vsNone.hi.toFixed(1)})` : 'n/a';
    console.log(`| ${W[r.placement]} | ${H[r.strategy]} | ${(r.success * 100).toFixed(1)}% | ${r.spl.toFixed(3)} | ${r.meanSteps.toFixed(0)} | ${ci} | ${r.oracleSteps.toFixed(0)} |`);
  }
  console.log(`\nTidy up: ${(tidy.success * 100).toFixed(0)}% of ${tidy.episodes} houses fully put away, ${tidy.meanSteps.toFixed(0)} steps on average.`);
}
