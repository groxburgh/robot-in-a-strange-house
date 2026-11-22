// The people (and the cat) who live in the house. They change things while the
// robot isn't looking:
//
//   - move objects from one place to another
//   - close doors, and sometimes lock one for a while ("someone's in there")
//   - leave clutter on the floor, and later pick it up
//   - the cat wanders around and sits in doorways
//
// Every change happens out of the robot's current line of sight, so the robot
// only finds out when it next looks. `activity` scales how often things happen:
// 0 = nobody home, 1 = lived-in, 3 = chaotic.

import { makeRng } from './rng.js';
import { WALL, DOOR, N4, N8 } from './house.js';
import { OBJECTS } from './catalog.js';

const CLUTTER = ['bag', 'box', 'laundry pile', 'shoes'];

export class Household {
  constructor(house, opts = {}) {
    this.h = house;
    this.activity = opts.activity ?? 1;
    this.rng = makeRng((house.seed * 2654435761) ^ (opts.seed ?? 99));
    this.t = 0;
    this.events = []; // {t, text}: what actually happened, for the "show real house" view
    const d = house.dyn;
    d.closed ??= new Set();
    d.locked ??= new Map(); // idx -> tick when it unlocks
    d.clutter ??= new Map(); // idx -> name
    this.catAllowed = opts.cat !== false;
    this.#maybeAddCat();
  }

  #maybeAddCat(robot) {
    const h = this.h;
    if (this.activity <= 0 || !this.catAllowed || h.dyn.cat) return;
    const floor = h.rooms.flatMap((r) => r.cells).filter(([x, y]) => h.passableNow(x, y)
      && !(x === h.start.x && y === h.start.y) && !robot?.visible?.has(h.idx(x, y)));
    if (!floor.length) return;
    const [x, y] = this.rng.pick(floor);
    h.dyn.cat = { x, y };
  }

  note(text) { this.events.push({ t: this.t, text }); }

  // Advance the household by one tick. `robot` tells us what it can see right now.
  step(robot) {
    this.t++;
    const { h, rng } = this;
    const a = this.activity;
    const d = h.dyn;
    const seen = (x, y) => robot?.visible?.has(h.idx(x, y));

    this.#maybeAddCat(robot);
    // Locks expire: the door stays closed but can be opened again.
    for (const [i, until] of d.locked) if (this.t >= until) d.locked.delete(i);

    // The cat ambles about every few ticks.
    if (d.cat && this.t % 3 === 0) {
      const opts = N4.map(([dx, dy]) => [d.cat.x + dx, d.cat.y + dy])
        .filter(([x, y]) => h.passableNow(x, y) && !(robot && x === robot.x && y === robot.y));
      if (opts.length && rng.chance(0.7)) [d.cat.x, d.cat.y] = rng.pick(opts);
    }
    if (a <= 0) return;

    if (rng.chance(0.02 * a)) this.#moveSomething(robot, seen);
    if (rng.chance(0.008 * a)) this.#toggleDoor(robot, seen);
    if (rng.chance(0.004 * a) && d.clutter.size < 4) this.#dropClutter(robot, seen);
    if (rng.chance(0.003 * a) && d.clutter.size) this.#pickUpClutter(seen);
  }

  #moveSomething(robot, seen) {
    const { h, rng } = this;
    const movable = h.objects.filter((o) => !o.carried && !seen(o.x, o.y));
    if (!movable.length) return;
    const o = rng.pick(movable);
    const spec = OBJECTS[o.name];
    const present = new Set(h.rooms.map((r) => r.type));
    const likely = spec.likely.filter((t) => present.has(t));
    const type = likely.length && rng.chance(h.priorStrength) ? rng.pick(likely) : rng.pick(h.rooms).type;
    const room = rng.pick(h.rooms.filter((r) => r.type === type));
    const surfaces = h.furniture.filter((f) => f.room === room.id && !seen(f.x, f.y));
    let spot;
    if (surfaces.length && rng.chance(0.45)) {
      const f = rng.pick(surfaces);
      spot = { x: f.x, y: f.y, on: f.name };
    } else {
      const floor = room.cells.filter(([x, y]) => h.passableNow(x, y) && !seen(x, y)
        && !h.objectAt(x, y) && !(x === h.start.x && y === h.start.y)
        && !(robot && x === robot.x && y === robot.y));
      if (!floor.length) return;
      const [x, y] = rng.pick(floor);
      spot = { x, y, on: null };
    }
    if (spot.x === o.x && spot.y === o.y) return;
    const from = o.on ? `the ${o.on}` : `the ${h.roomTypeAt(o.x, o.y)} floor`;
    Object.assign(o, spot);
    const to = spot.on ? `the ${spot.on}` : `the ${room.type} floor`;
    this.note(`Someone moved the ${o.name} from ${from} to ${to}.`);
  }

  #toggleDoor(robot, seen) {
    const { h, rng } = this;
    const d = h.dyn;
    const doors = h.doors.filter(({ x, y }) => !seen(x, y)
      && !(robot && x === robot.x && y === robot.y)
      && !(d.cat && d.cat.x === x && d.cat.y === y));
    if (!doors.length) return;
    const { x, y } = rng.pick(doors);
    const i = h.idx(x, y);
    const room = h.roomTypeAt(x - 1, y) ?? h.roomTypeAt(x, y - 1) ?? 'hall';
    const other = h.roomTypeAt(x + 1, y) ?? h.roomTypeAt(x, y + 1) ?? 'hall';
    const where = `between the ${room} and the ${other}`;
    if (d.closed.has(i)) {
      if (d.locked.has(i)) return;
      d.closed.delete(i);
      this.note(`Someone opened the door ${where}.`);
    } else {
      d.closed.add(i);
      if (rng.chance(0.2)) {
        d.locked.set(i, this.t + 60 + Math.floor(rng.next() * 120));
        this.note(`Someone closed and locked the door ${where}.`);
      } else this.note(`Someone closed the door ${where}.`);
    }
  }

  #dropClutter(robot, seen) {
    const { h, rng } = this;
    const d = h.dyn;
    const nearDoor = (x, y) => N8.some(([dx, dy]) => h.cells[h.idx(x + dx, y + dy)] === DOOR);
    const options = rng.shuffle(h.rooms.flatMap((r) => r.cells).filter(([x, y]) =>
      h.passableNow(x, y) && !seen(x, y) && !nearDoor(x, y) && !h.objectAt(x, y)
      && !(x === h.start.x && y === h.start.y) && !(robot && x === robot.x && y === robot.y)
      && !(d.cat && d.cat.x === x && d.cat.y === y))).slice(0, 12);
    for (const [x, y] of options) {
      const i = h.idx(x, y);
      const name = rng.pick(CLUTTER);
      d.clutter.set(i, name);
      if (this.#stillConnected()) {
        this.note(`Someone left ${name === 'shoes' ? 'some shoes' : `a ${name}`} on the ${h.roomTypeAt(x, y)} floor.`);
        return;
      }
      d.clutter.delete(i);
    }
  }

  #pickUpClutter(seen) {
    const { h, rng } = this;
    const out = [...h.dyn.clutter.keys()].filter((i) => !seen(i % h.W, (i / h.W) | 0));
    if (!out.length) return;
    const i = rng.pick(out);
    h.dyn.clutter.delete(i);
    this.note('Someone tidied away some clutter.');
  }

  // Clutter must never cut the house in two or wall off any object or furniture.
  #stillConnected() {
    const { h } = this;
    const ok = (x, y) => x >= 0 && y >= 0 && x < h.W && y < h.H && h.cells[h.idx(x, y)] !== WALL
      && !h.furnAt.has(h.idx(x, y)) && !h.dyn.clutter.has(h.idx(x, y));
    const seenC = new Uint8Array(h.W * h.H);
    const q = [[h.start.x, h.start.y]];
    seenC[h.idx(h.start.x, h.start.y)] = 1;
    let n = 0;
    while (q.length) {
      const [x, y] = q.pop();
      n++;
      for (const [dx, dy] of N4) {
        const nx = x + dx, ny = y + dy;
        if (ok(nx, ny) && !seenC[h.idx(nx, ny)]) { seenC[h.idx(nx, ny)] = 1; q.push([nx, ny]); }
      }
    }
    let total = 0;
    for (let y = 0; y < h.H; y++) for (let x = 0; x < h.W; x++) if (ok(x, y)) total++;
    if (n !== total) return false;
    // ...and every piece of furniture still has a free side to reach it from.
    return h.furniture.every((f) => N4.some(([dx, dy]) => ok(f.x + dx, f.y + dy)));
  }
}
