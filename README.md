# First Day in a Strange House

A robot is dropped at the front door of a house it has never seen. You tell it what to do in plain English, and it has to work out the layout, find things and put them where you asked, using only what it has seen so far.

**[Try it in your browser](https://groxburgh.github.io/robot-in-a-strange-house/)**. No install, no account, no API key. Every house is generated fresh from a seed, so `#house-42` is always the same house.

![The robot tidying an unfamiliar house](docs/demo.gif)

*House #3, command "tidy up". Hatched areas are parts of the house the robot hasn't seen yet. The blue ring is its field of view.*

## Why

On *Moonshots with Peter Diamandis* (16 November 2026), Figure AI CEO Brett Adcock described the bar a home robot has to clear before launch: walk into an unfamiliar house, follow spoken instructions, and work without teleoperation or stalls ([Humanoids Daily's write-up of the episode](https://www.humanoidsdaily.com/news/brett-adcock-moonshots-helix-3-homes-six-months), 17 November 2026). He also said single tasks already work well and that chaining them into longer jobs is the next step.

This project is a small, honest model of that test. It leaves out the hard physical parts (legs, hands, real cameras) and keeps the decision-making: what to look at, where to go, and what to do when the thing you want hasn't turned up yet.

## Things to try

```
put the mug in the sink
bring me the book, then put the towel on the towel rack
find the keys and come back
take the socks to the hamper
tidy up
where's the toothbrush?
```

It understands common synonyms (cup, couch, hamper, lounge), ignores filler ("could you please…"), chains instructions with "then", and tells you exactly which word it didn't understand. If you ask for something that isn't in the house, it searches every room before saying so.

## How it works

| Part | What it does | Where |
|---|---|---|
| House generator | Splits a floor plate into 5 to 7 rooms (binary space partition), adds one doorway per split so every room is reachable, places furniture against walls without blocking doors, then scatters 6 to 8 objects | [`src/house.js`](src/house.js) |
| Perception | Line-of-sight raycasting within a 6-cell radius. Walls block sight; furniture doesn't | [`src/robot.js`](src/robot.js) |
| Memory | An occupancy grid (unknown / floor / wall / furniture) plus a semantic map: which room each cell belongs to, where each piece of furniture is, where each object was last seen. Beliefs that turn out wrong are dropped | [`src/robot.js`](src/robot.js) |
| Planning | Breadth-first search over cells the robot has actually seen, re-planned every step as the map grows. It never routes through space it hasn't observed | [`src/robot.js`](src/robot.js) |
| Exploration | Frontier-based: when the target isn't known, walk to the nearest boundary between known floor and unknown space | [`src/robot.js`](src/robot.js) |
| Room hints | Optional. Biases frontier choice toward rooms where the target usually is (towels in bathrooms, milk in kitchens) and away from rooms already identified as unlikely | [`src/catalog.js`](src/catalog.js) |
| Language | A rule-based parser that turns sentences into tasks (`deliver`, `goto`, `find`, `explore`, `tidy`). Deterministic and offline, so every result is reproducible | [`src/parser.js`](src/parser.js) |
| Renderer | Draws the robot's knowledge as an architect's floor plan, with a toggle to show the real house underneath | [`src/render.js`](src/render.js) |

Everything is plain JavaScript ES modules with no dependencies and no build step. The same code runs in the browser and in Node.

## Results

[`bench/run.js`](bench/run.js) generates 300 houses for each condition and gives the robot one errand in each (fetch a random object to a random piece of furniture, or bring it to the front door). The generator's `priorStrength` setting controls how often a misplaced object is left somewhere typical for it.

**SPL** is Success weighted by Path Length (Anderson et al., 2018, *On Evaluation of Embodied Navigation Agents*): the shortest route for a robot that already had the floor plan, divided by the route this robot actually took. 1.0 would mean exploring cost nothing.

| Where things were left | Search | Success | SPL | Mean steps | Steps with floor plan |
|---|---|---|---|---|---|
| Random | Nearest gap | 100% | 0.667 | 109 | 63 |
| Random | Room hints | 100% | 0.658 | 109 | 63 |
| Usually typical | Nearest gap | 100% | 0.696 | 104 | 61 |
| Usually typical | Room hints | **100%** | **0.724** | **96** | 61 |
| Almost always typical | Nearest gap | 100% | 0.711 | 99 | 59 |
| Almost always typical | Room hints | **100%** | **0.754** | **88** | 59 |

What this shows:

- **Room hints pay off only when the house matches them.** They cut steps by about 8% when objects are usually somewhere typical and about 11% when they almost always are. When objects are scattered at random, the hints slightly lower SPL.
- **Not knowing the house costs roughly 50 to 75% extra walking.** The robot never fails here, but it takes 88 to 109 steps on average against 59 to 63 for a robot with the floor plan.
- **"Tidy up" succeeded in all 600 runs** (100 houses per condition), averaging about 580 to 605 steps. The two strategies tie on this one because tidying explores the whole house before it starts carrying things.

Reproduce with `npm run bench` (about a minute). Numbers are deterministic for a given seed range.

## Limitations

This is a grid-world model, so read the results with that in mind:

- Perception is perfect inside the field of view. A real robot misidentifies things, and that would make the room-hint advantage less certain.
- Picking up and putting down always succeed and take one step. Manipulation is most of the real difficulty for humanoids.
- The same hand-written table of "where things usually are" drives both the house generator and the room-hint search. The benchmark therefore measures how much a *correct* prior helps, plus what happens when the prior is wrong (the random row). It does not show that these particular priors match real homes.
- The parser is rule-based. It handles the phrasings in the tests and common variants, not open-ended conversation. A language model could replace it without touching the rest of the system, since the parser's only job is to output a task list.

## Run it locally

Requires Node 18 or later. No `npm install` needed.

```bash
git clone https://github.com/groxburgh/robot-in-a-strange-house.git
cd robot-in-a-strange-house
npm test          # 25 tests: generator, parser, robot behaviour
npm run bench     # benchmark table above
npm run serve     # then open http://localhost:8000
```

The browser version needs a local server (any static server works) because it uses ES modules.

URL options: `#house-42` picks a house. `?demo=tidy%20up&speed=60` runs a command on load, which is how the GIF was recorded (see [`tools/`](tools)).

## Layout

```
index.html        the page
src/
  catalog.js      rooms, furniture, objects, synonyms, where things usually are
  house.js        procedural house generator
  robot.js        perception, memory, planning, exploration, task execution
  parser.js       English -> task list
  oracle.js       shortest possible routes, for scoring
  render.js       floor-plan renderer (canvas)
  main.js         browser UI
tests/            node:test suites
bench/            benchmark script and saved results
tools/            GIF recording scripts
```

## License

MIT
