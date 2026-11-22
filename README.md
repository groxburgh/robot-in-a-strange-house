# Robot in a Strange House

[![Tests and deploy](https://github.com/groxburgh/robot-in-a-strange-house/actions/workflows/ci.yml/badge.svg)](https://github.com/groxburgh/robot-in-a-strange-house/actions/workflows/ci.yml)

A robot is dropped at the front door of a house it has never seen. You tell it what to do in plain English, and it has to work out the layout, find things and put them where you asked, using only what it has seen so far. Meanwhile the people who live there keep moving things, closing doors and leaving stuff on the floor, and the cat gets in the way.

**[Try it in your browser](https://groxburgh.github.io/robot-in-a-strange-house/)**. No install, no account, no API key. Every house is generated from a seed, so `#house-42` is always the same house.

![The robot exploring a busy house and fetching the keys](docs/demo.gif)

*House #3 on "Chaotic", with "Show the real house" on. Hatched areas are unexplored, or haven't been looked at for a while. Red markers with a question mark are places the robot remembers something being, where it no longer is. The red dot on a door means someone has locked it.*

## Why

On *Moonshots with Peter Diamandis* (16 November 2026), Figure AI CEO Brett Adcock described the bar a home robot has to clear before launch: walk into an unfamiliar house, follow spoken instructions, and work without teleoperation or stalls ([Humanoids Daily, Pontus Armini, 17 November 2026](https://www.humanoidsdaily.com/news/brett-adcock-moonshots-helix-3-homes-six-months)).

This project is a small model of that test. It leaves out the hard physical parts (legs, hands, real cameras) and keeps the decisions: what to look at, where to go, and what to do when the thing you want isn't where you last saw it.

## Things to try

```
put the mug in the sink
bring me the book, then put the towel on the towel rack
find the keys and come back
take the socks to the hamper
tidy up
where's the toothbrush?
```

Then switch the household to **Chaotic**, turn on **Show the real house**, and set memory to **Trusts its memory**. Ask for something the household has moved since the robot last saw it.

## How it works

| Part | What it does | Where |
|---|---|---|
| House generator | Splits a floor plate into 5 to 7 rooms (binary space partition), one doorway per split so every room is reachable, furniture against walls, 6 to 8 objects scattered about | [`src/house.js`](src/house.js) |
| Household | Moves objects, closes and sometimes locks doors, leaves clutter, and walks the cat around. It only changes things the robot can't currently see, and never cuts off part of the house | [`src/household.js`](src/household.js) |
| Perception | Line-of-sight raycasting. Walls and closed doors block sight. Large objects are noticed from 6 cells away, small ones (keys, socks, remote, toothbrush) only from 3, or 4 and 2 with poor eyesight | [`src/robot.js`](src/robot.js) |
| Memory | An occupancy grid plus a semantic map (room labels, furniture, objects). Every sighting is timestamped. A memory is only discarded when the robot is close enough to be sure the thing has gone | [`src/robot.js`](src/robot.js) |
| Planning | Breadth-first search over cells it has actually seen, re-planned every step. Opens closed doors on the way, avoids known clutter and the cat, waits when a locked door or the cat blocks the only route | [`src/robot.js`](src/robot.js) |
| Search | Walks to the edge of the unknown first. With **fresh** memory, once nothing new is left, it re-checks everywhere it hasn't looked at closely enough since the request. **Static** memory trusts what it saw and gives up | [`src/robot.js`](src/robot.js) |
| Room hints | Optional bias toward rooms where the target usually is (towels in bathrooms, milk in kitchens) | [`src/catalog.js`](src/catalog.js) |
| Language | A rule-based parser that turns sentences into tasks. Deterministic and offline, so every result is reproducible | [`src/parser.js`](src/parser.js) |
| Renderer | Draws the robot's knowledge as an architect's floor plan, with a toggle to show the real house underneath | [`src/render.js`](src/render.js) |

Plain JavaScript ES modules, no dependencies, no build step. The same code runs in the browser and in Node.

## Results

### 1. Memory that re-checks itself

[`bench/dynamic.js`](bench/dynamic.js): the robot explores a new house, waits 300 steps while the household carries on, then is asked to fetch one object. Nothing ever leaves the house, so "it isn't here" is always the wrong answer. 200 houses per row.

| House | Memory | Success | Wrongly said "not here" | Memory wrong when asked | Mean steps (successes) |
|---|---|---|---|---|---|
| Nobody home | static | 91.0% | 9.0% | 9.0% | 63 |
| Nobody home | fresh | **100.0%** | **0.0%** | 9.0% | 72 |
| Lived-in | static | 57.0% | 43.0% | 65.0% | 72 |
| Lived-in | fresh | **99.0%** | **1.0%** | 65.0% | 96 |
| Chaotic | static | 42.0% | 58.0% | 86.5% | 75 |
| Chaotic | fresh | **93.5%** | **6.5%** | 86.5% | 120 |
| Nobody home, poor eyesight | static | 77.5% | 22.5% | 22.5% | 62 |
| Nobody home, poor eyesight | fresh | **100.0%** | **0.0%** | 22.5% | 89 |

What this shows:

- **Trusting memory fails as soon as anyone else lives in the house.** In a lived-in house the static robot's memory was wrong in 65% of episodes, and it wrongly reported the object missing 43% of the time.
- **Re-checking costs walking.** The fresh robot succeeds far more often, but its successful runs take longer (96 steps against 72 in a lived-in house), because it re-searches rooms it has already seen.
- **Bad perception looks like a changing house.** Even with nobody home, the static robot misses small things it walked past at a distance, then never goes back. Poor eyesight makes this worse (22.5% wrongly reported missing). Re-checking up close fixes it.
- **Re-checking isn't perfect.** In a chaotic house, things sometimes get moved into rooms the robot has just re-checked, so it still wrongly gives up 6.5% of the time.

### 2. Room hints

[`bench/run.js`](bench/run.js) generates 300 houses per row with nobody else home and gives the robot one errand in each. The generator's `priorStrength` controls how often a misplaced object is left somewhere typical for it.

**SPL** is Success weighted by Path Length (Anderson et al., "On Evaluation of Embodied Navigation Agents", 2018): the shortest route for a robot that already had the floor plan, divided by the route this robot took. 1.0 would mean exploring cost nothing.

| Where things were left | Search | Success | SPL | Mean steps | Steps with floor plan |
|---|---|---|---|---|---|
| Random | Nearest gap | 100% | 0.619 | 126 | 63 |
| Random | Room hints | 100% | 0.608 | 128 | 63 |
| Usually typical | Nearest gap | 100% | 0.644 | 120 | 61 |
| Usually typical | Room hints | **100%** | **0.675** | **111** | 61 |
| Almost always typical | Nearest gap | 100% | 0.651 | 116 | 59 |
| Almost always typical | Room hints | **100%** | **0.703** | **103** | 59 |

- **Room hints pay off only when the house matches them.** They cut steps by about 7% when objects are usually somewhere typical and about 11% when they almost always are. When objects are scattered at random, the hints slightly lower SPL.
- **Not knowing the house costs roughly 75 to 100% extra walking**, partly because small objects need a close look.
- **"Tidy up" succeeded in all 600 runs** (100 houses per condition), at about 950 steps each, because the robot has to walk near every surface to be sure it has found every small thing.

Reproduce with `npm run bench` and `npm run bench:dynamic` (about a minute each). Results are deterministic.

## Related work

The research version of this problem is usually called open-vocabulary mobile manipulation: find any named object in an unfamiliar home and move it somewhere. In the NeurIPS 2023 HomeRobot challenge, the best team's success rate on the hardest simulated version was 10.8% ([Yenamandra et al., "Towards Open-World Mobile Manipulation in Homes: Lessons from the NeurIPS 2023 HomeRobot Open Vocabulary Mobile Manipulation Challenge", July 2024](https://arxiv.org/abs/2407.06939)). Most such systems assume nothing in the house moves. DynaMem ([arXiv 2411.04999, November 2024](https://arxiv.org/abs/2411.04999)) is one attempt at a memory that keeps up as objects move, appear and disappear. This project's "fresh" memory is a much simpler grid-world version of the same idea.

## Limitations

- It's a grid world. Picking up and putting down always succeed and take one step. Real manipulation is most of the difficulty.
- The household moves things at random times. Real households have habits (keys go by the door in the evening), and a better robot would learn them.
- Perception is all-or-nothing within a fixed range. Real detectors make confident mistakes, including seeing things that aren't there.
- One table of "where things usually are" drives both the house generator and the room-hint search. The hint benchmark measures how much a correct prior helps, and what happens when it's wrong (the random row). It doesn't show these priors match real homes.
- The parser is rule-based. A language model could replace it without touching anything else, since its only job is to output a task list.

## Run it locally

Requires Node 18 or later. No `npm install` needed.

```bash
git clone https://github.com/groxburgh/robot-in-a-strange-house.git
cd robot-in-a-strange-house
npm test                # 32 tests: generator, parser, robot, household
npm run bench           # room-hint benchmark
npm run bench:dynamic   # changing-house benchmark
npm run serve           # then open http://localhost:8000
```

The browser version needs a local server because it uses ES modules.

URL options: `#house-42` picks a house. `?demo=tidy%20up&speed=60&activity=3&reveal=1` runs a command on load, which is how the GIF was recorded (see [`tools/`](tools)).

## Layout

```
index.html        the page
src/
  catalog.js      rooms, furniture, objects, synonyms, where things usually are, sight ranges
  house.js        procedural house generator
  household.js    the people (and cat) who change things
  robot.js        perception, memory, planning, search, task execution
  parser.js       English -> task list
  oracle.js       shortest possible routes, for scoring
  render.js       floor-plan renderer (canvas)
  main.js         browser UI
tests/            node:test suites
bench/            benchmark scripts and saved results
tools/            GIF recording scripts
```

## License

MIT
