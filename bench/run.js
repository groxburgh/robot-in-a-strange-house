// Benchmark: how well does the robot cope with houses it has never seen?
//
//   node bench/run.js            -> prints a markdown table
//   node bench/run.js --json     -> machine-readable results
//
// For each seed we generate a fresh house and give the robot one errand.
// We compare two search strategies across three kinds of house:
//
//   priorStrength 0.0  objects are scattered completely at random
//   priorStrength 0.65 objects are usually somewhere typical (default)
//   priorStrength 0.9  objects are almost always somewhere typical
//
// SPL = Success weighted by Path Length (Anderson et al., 2018): for each
// episode, success * oracle / max(actual, oracle). 1.0 means the robot did as
// well as if it had been given the floor plan in advance.

import { generateHouse } from '../src/house.js';
import { Robot } from '../src/robot.js';
import { parse } from '../src/parser.js';
import { oracleDeliver } from '../src/oracle.js';
import { makeRng } from '../src/rng.js';
import { OBJECTS } from '../src/catalog.js';

const SEEDS = Number(process.env.SEEDS ?? 300);
const STRATEGIES = ['naive', 'semantic'];
const PRIORS = [0, 0.65, 0.9];

// Pick an errand for this house: fetch a random object to a random piece of
// furniture that isn't its current spot, or bring it to the front door.
function errandFor(house, seed) {
  const rng = makeRng(seed * 7919 + 13);
  const o = rng.pick(house.objects);
  if (rng.chance(0.5)) return { text: `bring me the ${o.name}`, obj: o.name, dest: { kind: 'user' } };
  const f = rng.pick(house.furniture.filter((q) => q.name !== o.on));
  return { text: `put the ${o.name} on the ${f.name}`, obj: o.name, dest: { kind: 'furniture', names: [f.name] } };
}

function runEpisode(seed, prior, strategy) {
  const house = generateHouse(seed, { priorStrength: prior });
  const errand = errandFor(house, seed);
  const oracle = oracleDeliver(house, errand.obj, errand.dest);
  const robot = new Robot(house, { strategy });
  robot.command(parse(errand.text));
  robot.runToCompletion();
  const r = robot.history[0];
  return { ok: r.ok, ticks: r.ticks, oracle, spl: r.ok ? oracle / Math.max(r.ticks, oracle) : 0 };
}

function runTidy(seed, prior, strategy) {
  const house = generateHouse(seed, { priorStrength: prior });
  const robot = new Robot(house, { strategy });
  robot.command(parse('tidy up'));
  robot.runToCompletion();
  const homeOf = (name) => OBJECTS[name].home.find((f) => house.furnitureByName.has(f));
  const allHome = house.objects.every((o) => o.on === homeOf(o.name));
  return { ok: robot.history[0].ok && allHome, ticks: robot.history[0].ticks };
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = (xs) => { const s = xs.slice().sort((a, b) => a - b); return s[s.length >> 1]; };

const results = [];
for (const prior of PRIORS) {
  for (const strategy of STRATEGIES) {
    const eps = [];
    const tidy = [];
    for (let s = 1; s <= SEEDS; s++) {
      eps.push(runEpisode(s, prior, strategy));
      if (s <= Math.min(SEEDS, 100)) tidy.push(runTidy(s, prior, strategy));
    }
    results.push({
      prior, strategy,
      success: mean(eps.map((e) => (e.ok ? 1 : 0))),
      spl: mean(eps.map((e) => e.spl)),
      meanSteps: mean(eps.map((e) => e.ticks)),
      medianSteps: median(eps.map((e) => e.ticks)),
      oracleSteps: mean(eps.map((e) => e.oracle)),
      tidySuccess: mean(tidy.map((e) => (e.ok ? 1 : 0))),
      tidySteps: mean(tidy.map((e) => e.ticks)),
      episodes: eps.length,
    });
  }
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ seeds: SEEDS, results }, null, 2));
} else {
  const pct = (x) => `${(x * 100).toFixed(1)}%`;
  console.log(`Errands: ${SEEDS} houses per row. Tidy-up: ${Math.min(SEEDS, 100)} houses per row.\n`);
  console.log('| Object placement | Strategy | Errand success | SPL | Mean steps | Median steps | Oracle steps | Tidy-up success | Tidy-up steps |');
  console.log('|---|---|---|---|---|---|---|---|---|');
  const label = { 0: 'Random (0.0)', 0.65: 'Usually typical (0.65)', 0.9: 'Almost always typical (0.9)' };
  for (const r of results) {
    console.log(`| ${label[r.prior]} | ${r.strategy} | ${pct(r.success)} | ${r.spl.toFixed(3)} | ${r.meanSteps.toFixed(0)} | ${r.medianSteps} | ${r.oracleSteps.toFixed(0)} | ${pct(r.tidySuccess)} | ${r.tidySteps.toFixed(0)} |`);
  }
}
