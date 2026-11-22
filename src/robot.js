// The robot. It starts knowing nothing about the house except where the front
// door is. Everything else it has to see for itself.
//
//   perception  - line-of-sight within a fixed radius; walls block sight
//   memory      - occupancy grid + semantic map (room labels, furniture, objects)
//   planning    - breadth-first search over cells it has actually seen
//   exploration - frontier-based: walk to the edge of what it knows
//   search      - "semantic" strategy biases exploration toward rooms where the
//                 thing it wants usually is; "naive" strategy just takes the
//                 nearest frontier

import { WALL, N4 } from './house.js';
import { OBJECTS, FURNITURE_ROOM, onOrIn } from './catalog.js';

export const UNKNOWN = 0;
export const K_FLOOR = 1;
export const K_WALL = 2;
export const K_FURN = 3;

const COMMAND_BUDGET = 4000; // ticks before the robot gives up on one command

export class Robot {
  constructor(house, opts = {}) {
    this.h = house;
    this.strategy = opts.strategy ?? 'semantic';
    this.radius = opts.radius ?? 6;
    const n = house.W * house.H;
    this.known = new Uint8Array(n);
    this.knownRoom = new Int16Array(n).fill(-1);
    this.seenRooms = new Map(); // roomId -> type
    this.furniture = new Map(); // name -> {x, y}
    this.objects = new Map(); // name -> {x, y, on}
    this.x = house.start.x;
    this.y = house.start.y;
    this.home = { ...house.start };
    this.carrying = null;
    this.ticks = 0;
    this.trail = [[this.x, this.y]];
    this.queue = []; // pending commands
    this.current = null; // active command
    this.history = []; // finished commands with outcome
    this.events = []; // human-readable log
    this.exploreTarget = null;
    this.plan = []; // last planned path, for drawing
    this.quiet = opts.quiet ?? false;
    this.sense(true);
  }

  // ------------------------------------------------------------------ memory
  say(text, kind = 'info') {
    this.events.push({ t: this.ticks, text, kind });
  }

  sense(initial = false) {
    const { h } = this;
    const R = this.radius;
    if (initial) this.say('Standing at the front door. I know nothing about this house yet.');
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dy * dy > R * R + R) continue;
        const tx = this.x + dx, ty = this.y + dy;
        if (tx < 0 || ty < 0 || tx >= h.W || ty >= h.H) continue;
        this.#castRay(tx, ty);
      }
    }
  }

  // Bresenham line from the robot to (tx, ty); stops at the first wall.
  #castRay(tx, ty) {
    let x = this.x, y = this.y;
    const dx = Math.abs(tx - x), dy = -Math.abs(ty - y);
    const sx = x < tx ? 1 : -1, sy = y < ty ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.#observe(x, y);
      const i = this.h.idx(x, y);
      if (this.h.cells[i] === WALL) return;
      if (x === tx && y === ty) return;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x += sx; }
      if (e2 <= dx) { err += dx; y += sy; }
    }
  }

  #observe(x, y) {
    const { h } = this;
    const i = h.idx(x, y);
    if (h.cells[i] === WALL) { this.known[i] = K_WALL; return; }
    const furn = h.furnAt.get(i);
    this.known[i] = furn ? K_FURN : K_FLOOR;
    const rid = h.roomId[i];
    if (rid >= 0) {
      this.knownRoom[i] = rid;
      if (!this.seenRooms.has(rid)) {
        const type = h.rooms[rid].type;
        this.seenRooms.set(rid, type);
        if (this.ticks > 0 || this.seenRooms.size > 1) this.say(`That looks like the ${type}.`, 'room');
        else this.say(`I'm in the ${type}.`, 'room');
      }
    }
    if (furn && !this.furniture.has(furn)) this.furniture.set(furn, { x, y });
    // Objects: add what is here; forget beliefs that turned out wrong.
    for (const [name, b] of this.objects) {
      if (b.x === x && b.y === y) {
        const real = h.objects.find((o) => o.name === name);
        if (real.carried || real.x !== x || real.y !== y) this.objects.delete(name);
      }
    }
    for (const o of h.objectsAt(x, y)) {
      if (this.objects.has(o.name)) continue;
      this.objects.set(o.name, { x, y, on: o.on });
      const where = o.on ? `${onOrIn(o.on)} the ${o.on}` : `on the ${h.roomTypeAt(x, y)} floor`;
      this.say(`Spotted the ${o.name} ${where}.`, 'object');
    }
  }

  passable(x, y) {
    return x >= 0 && y >= 0 && x < this.h.W && y < this.h.H
      && this.known[this.h.idx(x, y)] === K_FLOOR;
  }

  // ---------------------------------------------------------------- planning
  // BFS over known free cells. Returns {path, dist} where path excludes the
  // robot's own cell, or null if no goal cell is reachable.
  bfs(isGoal) {
    const { W, H } = this.h;
    const prev = new Int32Array(W * H).fill(-2);
    const start = this.h.idx(this.x, this.y);
    prev[start] = -1;
    const q = [start];
    for (let qi = 0; qi < q.length; qi++) {
      const c = q[qi];
      const cx = c % W, cy = (c / W) | 0;
      if (isGoal(cx, cy)) {
        const path = [];
        for (let p = c; p !== start; p = prev[p]) path.push([p % W, (p / W) | 0]);
        return path.reverse();
      }
      for (const [dx, dy] of N4) {
        const nx = cx + dx, ny = cy + dy;
        if (!this.passable(nx, ny)) continue;
        const ni = ny * W + nx;
        if (prev[ni] !== -2) continue;
        prev[ni] = c;
        q.push(ni);
      }
    }
    return null;
  }

  distanceField() {
    const { W, H } = this.h;
    const dist = new Int32Array(W * H).fill(-1);
    const start = this.h.idx(this.x, this.y);
    dist[start] = 0;
    const q = [start];
    for (let qi = 0; qi < q.length; qi++) {
      const c = q[qi];
      const cx = c % W, cy = (c / W) | 0;
      for (const [dx, dy] of N4) {
        const nx = cx + dx, ny = cy + dy;
        if (!this.passable(nx, ny)) continue;
        const ni = ny * W + nx;
        if (dist[ni] !== -1) continue;
        dist[ni] = dist[c] + 1;
        q.push(ni);
      }
    }
    return dist;
  }

  isFrontier(x, y) {
    if (!this.passable(x, y)) return false;
    return N4.some(([dx, dy]) => {
      const nx = x + dx, ny = y + dy;
      return nx >= 0 && ny >= 0 && nx < this.h.W && ny < this.h.H
        && this.known[this.h.idx(nx, ny)] === UNKNOWN;
    });
  }

  // Choose a frontier cell to walk toward. `likely` is an ordered list of room
  // types where the thing we want is usually found. `toward` biases toward a
  // known-but-unreachable point.
  chooseFrontier(likely = [], toward = null) {
    const { W } = this.h;
    const dist = this.distanceField();
    let best = null, bestScore = Infinity;
    const semantic = this.strategy === 'semantic' && likely.length > 0;
    for (let i = 0; i < dist.length; i++) {
      if (dist[i] < 0) continue;
      const x = i % W, y = (i / W) | 0;
      if (!this.isFrontier(x, y)) continue;
      let score = dist[i];
      if (semantic) {
        const rid = this.knownRoom[i];
        if (rid >= 0) {
          const rank = likely.indexOf(this.seenRooms.get(rid));
          score += rank >= 0 ? -24 * (likely.length - rank) / likely.length : 6;
        }
      }
      if (toward) score += 1.5 * Math.hypot(x - toward.x, y - toward.y);
      if (score < bestScore) { bestScore = score; best = { x, y }; }
    }
    return best;
  }

  // One step of exploration. Returns a move action, or null if nothing is left.
  explore(likely = [], toward = null) {
    const t = this.exploreTarget;
    const keep = t && !toward && this.isFrontier(t.x, t.y) && !(t.x === this.x && t.y === this.y);
    if (!keep) this.exploreTarget = this.chooseFrontier(likely, toward);
    if (!this.exploreTarget) return null;
    let path = this.bfs((x, y) => x === this.exploreTarget.x && y === this.exploreTarget.y);
    if (path && path.length === 0) {
      // Standing on the frontier already: re-pick next tick.
      this.exploreTarget = this.chooseFrontier(likely, toward);
      if (!this.exploreTarget) return null;
      path = this.bfs((x, y) => x === this.exploreTarget.x && y === this.exploreTarget.y);
    }
    if (!path || !path.length) return null;
    this.plan = path;
    return { act: 'move', to: path[0] };
  }

  // A free cell within arm's reach to set something down on.
  dropSpot() {
    const free = (x, y) => (x === this.x && y === this.y) || this.passable(x, y);
    for (const [dx, dy] of [[0, 0], ...N4]) {
      const x = this.x + dx, y = this.y + dy;
      if (free(x, y) && !this.h.objectAt(x, y) && !this.h.furnAt.has(this.h.idx(x, y))) return { x, y };
    }
    return { x: this.x, y: this.y };
  }

  touching(tx, ty) {
    return Math.abs(tx - this.x) + Math.abs(ty - this.y) <= 1;
  }

  // Walk to a cell from which (tx, ty) can be reached with an arm.
  approach(tx, ty) {
    const path = this.bfs((x, y) => Math.abs(tx - x) + Math.abs(ty - y) <= 1);
    if (path && path.length) { this.plan = path; return { act: 'move', to: path[0] }; }
    return this.explore([], { x: tx, y: ty });
  }

  // -------------------------------------------------------------- commands
  command(parsed) {
    if (parsed.error) { this.say(parsed.error, 'error'); return; }
    for (const task of parsed.tasks) this.queue.push({ ...task, steps: expand(task) });
  }

  stop() {
    if (!this.busy) return;
    this.queue = [];
    if (this.current) {
      this.history.push({ text: this.current.text, ok: false, ticks: this.ticks - this.current.startTick, why: 'Stopped.' });
      this.current = null;
    }
    this.plan = [];
    this.say('Stopped.', 'error');
  }

  get busy() {
    return this.current !== null || this.queue.length > 0;
  }

  // Advance the simulation by one tick. Returns true if the robot did something.
  tick() {
    for (let guard = 0; guard < 50; guard++) {
      if (!this.current) {
        if (!this.queue.length) return false;
        this.current = this.queue.shift();
        this.current.startTick = this.ticks;
        this.current.stepIndex = 0;
        this.exploreTarget = null;
        this.say(`> ${this.current.text}`, 'command');
      }
      const cmd = this.current;
      if (this.ticks - cmd.startTick > COMMAND_BUDGET) {
        this.#finish(false, "I've been at this too long. Giving up.");
        continue;
      }
      const step = cmd.steps[cmd.stepIndex];
      if (!step) { this.#finish(true); continue; }
      const r = this.#runStep(step, cmd);
      if (r === 'done') { cmd.stepIndex++; this.exploreTarget = null; continue; }
      if (r.fail) { this.#finish(false, r.fail); continue; }
      this.#act(r);
      if (r.completes) { cmd.stepIndex++; this.exploreTarget = null; }
      return true;
    }
    return false;
  }

  runToCompletion(maxTicks = 20000) {
    let n = 0;
    while (this.busy && n++ < maxTicks) if (!this.tick() && !this.busy) break;
    return this.history;
  }

  #finish(ok, why) {
    const cmd = this.current;
    const ticks = this.ticks - cmd.startTick;
    this.history.push({ text: cmd.text, ok, ticks, why: why ?? null });
    if (ok) this.say(`Done (${ticks} steps).`, 'done');
    else this.say(why, 'error');
    this.current = null;
    this.plan = [];
    if (!ok) this.queue = []; // later steps of a chain usually depend on this one
  }

  #act(a) {
    const { h } = this;
    if (a.act === 'move') {
      [this.x, this.y] = a.to;
      this.trail.push([this.x, this.y]);
      this.ticks++;
      this.sense();
    } else if (a.act === 'pick') {
      const o = h.objects.find((q) => q.name === a.obj);
      o.carried = true;
      this.carrying = a.obj;
      this.objects.delete(a.obj);
      this.ticks++;
      this.say(`Picked up the ${a.obj}.`, 'action');
    } else if (a.act === 'place') {
      const o = h.objects.find((q) => q.name === this.carrying);
      o.carried = false;
      o.x = a.x; o.y = a.y; o.on = a.on ?? null;
      this.objects.set(o.name, { x: a.x, y: a.y, on: o.on });
      this.ticks++;
      const where = a.on ? `${onOrIn(a.on)} the ${a.on}` : a.label ?? 'down';
      this.say(`Put the ${o.name} ${where}.`, 'action');
      this.carrying = null;
    }
  }

  // --------------------------------------------------------------- steps
  #runStep(step, cmd) {
    switch (step.op) {
      case 'pick': return this.#pick(step.obj);
      case 'place': return this.#toDest(step.dest, true);
      case 'goto': return this.#toDest(step.dest, false);
      case 'find': return this.#find(step.obj);
      case 'exploreAll': return this.explore() ?? 'done';
      case 'tidyPlan': return this.#tidyPlan(cmd);
      default: return { fail: `Unknown step ${step.op}` };
    }
  }

  #find(obj) {
    if (this.carrying === obj || this.objects.has(obj)) {
      if (this.objects.has(obj)) {
        const b = this.objects.get(obj);
        const where = b.on ? `${onOrIn(b.on)} the ${b.on}` : `on the ${this.h.roomTypeAt(b.x, b.y)} floor`;
        this.say(`The ${obj} is ${where}.`, 'done');
      }
      return 'done';
    }
    return this.explore(OBJECTS[obj]?.likely ?? [])
      ?? { fail: `I've looked in every room. There's no ${obj} in this house.` };
  }

  #pick(obj) {
    if (this.carrying === obj) return 'done';
    const b = this.objects.get(obj);
    if (!b) {
      return this.explore(OBJECTS[obj]?.likely ?? [])
        ?? { fail: `I've looked in every room. There's no ${obj} in this house.` };
    }
    if (this.carrying) {
      // Hands full: put the current thing down right here.
      return { act: 'place', ...this.dropSpot(), label: 'down for a moment' };
    }
    if (this.touching(b.x, b.y)) return { act: 'pick', obj };
    return this.approach(b.x, b.y) ?? { fail: `I can see the ${obj} but can't reach it.` };
  }

  #toDest(dest, placing) {
    if (placing && !this.carrying) return { fail: "I'm not holding anything." };
    const finish = (extra) => (placing ? { act: 'place', completes: true, ...extra } : 'done');

    if (dest.kind === 'user') {
      const { x, y } = this.home;
      if (this.x === x && this.y === y) return finish({ ...this.dropSpot(), label: 'by the front door' });
      const path = this.bfs((cx, cy) => cx === x && cy === y);
      if (path && path.length) { this.plan = path; return { act: 'move', to: path[0] }; }
      return { fail: "I can't find my way back to the front door." };
    }

    if (dest.kind === 'furniture') {
      const name = dest.names.find((n) => this.furniture.has(n));
      if (!name) {
        const rooms = [...new Set(dest.names.map((n) => FURNITURE_ROOM[n]))];
        return this.explore(rooms)
          ?? { fail: `I've looked everywhere. There's no ${dest.names[0]} in this house.` };
      }
      const f = this.furniture.get(name);
      if (this.touching(f.x, f.y)) return finish({ x: f.x, y: f.y, on: name });
      return this.approach(f.x, f.y) ?? { fail: `I can't get to the ${name}.` };
    }

    if (dest.kind === 'room') {
      const type = dest.names[0];
      const inRoom = (x, y) => {
        const rid = this.knownRoom[this.h.idx(x, y)];
        return rid >= 0 && this.seenRooms.get(rid) === type;
      };
      const freeSpot = (x, y) => inRoom(x, y) && !this.h.objectAt(x, y)
        && !(x === this.home.x && y === this.home.y);
      // Step a couple of cells inside the doorway rather than dropping things on the threshold.
      const goodSpot = placing ? freeSpot : inRoom;
      if (goodSpot(this.x, this.y) && this.#depthInRoom(type) >= (placing ? 1 : 0)) {
        return finish({ x: this.x, y: this.y, label: `in the ${type}` });
      }
      const path = this.bfs((x, y) => goodSpot(x, y) && this.#depthAt(x, y, type) >= (placing ? 1 : 0));
      if (path && path.length) { this.plan = path; return { act: 'move', to: path[0] }; }
      return this.explore([type])
        ?? { fail: `I've looked everywhere. This house has no ${type}.` };
    }
    return { fail: 'I do not understand where that is.' };
  }

  #depthInRoom(type) { return this.#depthAt(this.x, this.y, type); }

  // 0 if a neighbour is outside the room (doorway/edge), else 1.
  #depthAt(x, y, type) {
    for (const [dx, dy] of N4) {
      const i = this.h.idx(x + dx, y + dy);
      const rid = this.h.roomId[i];
      if (this.h.cells[i] !== WALL && (rid < 0 || this.h.rooms[rid].type !== type)) return 0;
    }
    return 1;
  }

  #tidyPlan(cmd) {
    const extra = [];
    const homeOf = (name) => (OBJECTS[name]?.home ?? []).find((f) => this.furniture.has(f));
    const todo = [...this.objects.keys()];
    if (this.carrying) todo.unshift(this.carrying);
    for (const name of todo) {
      const home = homeOf(name);
      if (!home) continue;
      const b = this.objects.get(name);
      if (b && b.on === home) continue;
      extra.push({ op: 'pick', obj: name }, { op: 'place', dest: { kind: 'furniture', names: [home] } });
    }
    this.say(extra.length
      ? `Found ${extra.length / 2} things out of place. Putting them away.`
      : 'Everything is already where it belongs.', 'info');
    cmd.steps.splice(cmd.stepIndex + 1, 0, ...extra);
    return 'done';
  }
}

// Turn a parsed task into primitive steps.
export function expand(task) {
  switch (task.type) {
    case 'deliver': return [{ op: 'pick', obj: task.obj }, { op: 'place', dest: task.dest }];
    case 'goto': return [{ op: 'goto', dest: task.dest }];
    case 'find': return [{ op: 'find', obj: task.obj }];
    case 'explore': return [{ op: 'exploreAll' }];
    case 'tidy': return [{ op: 'exploreAll' }, { op: 'tidyPlan' }];
    default: return [];
  }
}
