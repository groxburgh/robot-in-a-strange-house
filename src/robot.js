// The robot. It starts knowing nothing about the house except where the front
// door is. Everything else it has to see for itself.
//
//   perception  - line-of-sight within a fixed radius; walls block sight
//   memory      - occupancy grid + semantic map (room labels, furniture, objects)
//   planning    - breadth-first search over cells it has actually seen
//   exploration - frontier-based: walk to the edge of what it knows
//   search      - room hints bias exploration toward rooms where the thing it
//                 wants is likely to be: "procthor" (common sense from the
//                 ProcTHOR dataset), "housekeep" (where Housekeep's annotators
//                 said misplaced things end up), or "naive" (nearest frontier)
//   memory      - "fresh" (default) timestamps every sighting. If something
//                 isn't where it remembers and there's nothing new to explore,
//                 it re-checks every place it hasn't looked at since you asked.
//                 "static" trusts its memory: once a room is seen, it's done.

import { WALL, N4 } from './house.js';
import { FURNITURE_ROOM, onOrIn, SMALL, SIGHT, roomHints, homesFor, isTidy } from './catalog.js';

export const UNKNOWN = 0;
export const K_FLOOR = 1;
export const K_WALL = 2;
export const K_FURN = 3;
export const K_CLOSED = 4; // a closed door (may or may not be locked)
export const K_CLUTTER = 5; // something left on the floor

const LOCK_RETRY = 40; // ticks to wait before trying a locked door again
const COMMAND_BUDGET = 4000; // ticks before the robot gives up on one command

export class Robot {
  constructor(house, opts = {}) {
    this.h = house;
    this.strategy = opts.strategy === 'semantic' ? 'procthor' : opts.strategy ?? 'procthor';
    this.radius = opts.radius ?? 6;
    this.memory = opts.memory ?? 'fresh';
    // How close it must be to notice an object (small things need a closer look).
    this.eyesight = opts.eyesight ?? 'good';
    this.world = opts.world ?? null; // a Household, if anyone else lives here
    const n = house.W * house.H;
    this.known = new Uint8Array(n);
    this.lastSeen = new Int32Array(n).fill(-1);
    // Last tick each cell was seen from within 2, 3 and 4 cells: what counts as
    // "properly looked at" depends on how small the thing we're after is.
    this.lastWithin = { 2: new Int32Array(n).fill(-1), 3: new Int32Array(n).fill(-1), 4: new Int32Array(n).fill(-1) };
    this.visible = new Set(); // cells in view right now
    this.lockedUntil = new Map(); // door idx -> tick to try again
    this.catAt = null;
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
    this.visible = new Set();
    this.catAt = null;
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
      if (this.h.blocksSight(x, y) && !(x === this.x && y === this.y)) return;
      if (x === tx && y === ty) return;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x += sx; }
      if (e2 <= dx) { err += dx; y += sy; }
    }
  }

  #observe(x, y) {
    const { h } = this;
    const i = h.idx(x, y);
    this.lastSeen[i] = this.ticks;
    this.visible.add(i);
    if (h.cells[i] === WALL) { this.known[i] = K_WALL; return; }
    const furn = h.furnAt.get(i);
    const d = h.dyn;
    this.known[i] = furn ? K_FURN : d.closed.has(i) ? K_CLOSED : d.clutter.has(i) ? K_CLUTTER : K_FLOOR;
    if (d.cat && d.cat.x === x && d.cat.y === y) this.catAt = { x, y };
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
    const dist = Math.hypot(x - this.x, y - this.y);
    for (const r of [2, 3, 4]) if (dist <= r) this.lastWithin[r][i] = this.ticks;
    // Forget beliefs that turned out wrong (only if it's close enough to be sure).
    for (const [name, b] of this.objects) {
      if (b.x !== x || b.y !== y || dist > this.sightRange(name)) continue;
      const real = h.objects.find((o) => o.name === name);
      if (real.carried || real.x !== x || real.y !== y) {
        this.objects.delete(name);
        if (this.ticks - b.t > 0) this.say(`The ${name} isn't where I last saw it.`, 'surprise');
      }
    }
    for (const o of h.objectsAt(x, y)) {
      if (dist > this.sightRange(o.name)) continue; // too far away to notice
      const b = this.objects.get(o.name);
      if (b && b.x === x && b.y === y) { b.t = this.ticks; continue; }
      this.objects.set(o.name, { x, y, on: o.on, t: this.ticks });
      const where = o.on ? `${onOrIn(o.on)} the ${o.on}` : `on the ${h.roomTypeAt(x, y)} floor`;
      this.say(b ? `Ah, the ${o.name} is ${where} now.` : `Spotted the ${o.name} ${where}.`, b ? 'surprise' : 'object');
    }
  }

  sightRange(name) {
    const s = SIGHT[this.eyesight] ?? SIGHT.good;
    return Math.min(this.radius, SMALL.has(name) ? s.small : s.normal) + 0.5;
  }

  // Has this cell been looked at closely enough to spot `name` since tick `since`?
  checkedSince(i, name, since) {
    const r = Math.floor(this.sightRange(name));
    const arr = r <= 2 ? this.lastWithin[2] : r <= 3 ? this.lastWithin[3] : r <= 4 ? this.lastWithin[4] : this.lastSeen;
    return arr[i] >= since;
  }

  // Can the robot plan a route through this cell, as far as it knows?
  passable(x, y) {
    if (x < 0 || y < 0 || x >= this.h.W || y >= this.h.H) return false;
    if (this.catAt && this.catAt.x === x && this.catAt.y === y) return false;
    const i = this.h.idx(x, y);
    const k = this.known[i];
    if (k === K_FLOOR) return true;
    if (k === K_CLOSED) return !((this.lockedUntil.get(i) ?? -1) > this.ticks); // can open it
    return false;
  }

  // Floor cells only (not doors): somewhere to stand still.
  standable(x, y) {
    return this.passable(x, y) && this.known[this.h.idx(x, y)] === K_FLOOR;
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

  // Choose somewhere to look next. Frontiers (the edge of the unknown) come
  // first. With `since` set (fresh memory), once there are no frontiers left it
  // falls back to any floor it hasn't looked at since tick `since`.
  //   hints  - {room type: weight}; missing = no opinion, 0 = unlikely
  //   toward - bias toward a known-but-unreachable point
  chooseFrontier(hints = {}, toward = null, since = null, target = null) {
    const { W } = this.h;
    const dist = this.distanceField();
    const weights = Object.values(hints);
    const maxW = Math.max(0, ...weights);
    const semantic = this.strategy !== 'naive' && maxW > 0;
    const pick = (isTarget) => {
      let best = null, bestScore = Infinity;
      for (let i = 0; i < dist.length; i++) {
        if (dist[i] < 0) continue;
        const x = i % W, y = (i / W) | 0;
        if (!isTarget(i, x, y)) continue;
        let score = dist[i];
        if (semantic) {
          const rid = this.knownRoom[i];
          const w = rid >= 0 ? hints[this.seenRooms.get(rid)] : undefined;
          if (w !== undefined) score += w > 0 ? -24 * (w / maxW) : 6;
        }
        if (toward) score += 1.5 * Math.hypot(x - toward.x, y - toward.y);
        if (score < bestScore) { bestScore = score; best = { x, y }; }
      }
      return best;
    };
    const frontier = pick((i, x, y) => this.isFrontier(x, y));
    if (frontier || since === null) return frontier ? { ...frontier, kind: 'frontier' } : null;
    // Only floor that could hold the target, or sits next to furniture that could.
    const holds = (i, x, y) => this.standable(x, y) || this.known[i] === K_FURN;
    const unchecked = (i, x, y) => holds(i, x, y) && !this.checkedSince(i, target, since);
    // Walk to a standable cell beside the nearest unchecked spot.
    const stale = pick((i, x, y) => this.standable(x, y) && (unchecked(i, x, y)
      || N4.some(([dx, dy]) => { const j = this.h.idx(x + dx, y + dy); return this.known[j] === K_FURN && !this.checkedSince(j, target, since); })));
    return stale ? { ...stale, kind: 'stale', since, target } : null;
  }

  #stillTarget(t) {
    if (!t || (t.x === this.x && t.y === this.y)) return false;
    if (t.kind === 'stale') return this.standable(t.x, t.y) && !this.checkedSince(this.h.idx(t.x, t.y), t.target, t.since);
    return this.isFrontier(t.x, t.y);
  }

  // One step of exploration. Returns a move action, or null if nothing is left.
  explore(hints = {}, toward = null, since = null, target = null) {
    const keep = !toward && this.#stillTarget(this.exploreTarget)
      && (since !== null || this.exploreTarget.kind === 'frontier');
    if (!keep) this.exploreTarget = this.chooseFrontier(hints, toward, since, target);
    if (!this.exploreTarget) return null;
    let path = this.bfs((x, y) => x === this.exploreTarget.x && y === this.exploreTarget.y);
    if (path && path.length === 0) {
      // Standing on the target already: pick another.
      this.exploreTarget = this.chooseFrontier(hints, toward, since, target);
      if (!this.exploreTarget) return null;
      path = this.bfs((x, y) => x === this.exploreTarget.x && y === this.exploreTarget.y);
    }
    if (!path || !path.length) return null;
    this.plan = path;
    return { act: 'move', to: path[0] };
  }

  // A free cell within arm's reach to set something down on.
  dropSpot() {
    const free = (x, y) => (x === this.x && y === this.y) || this.standable(x, y);
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
    return this.explore({}, { x: tx, y: ty });
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
      let r = this.#runStep(step, cmd);
      if (r === 'done') { cmd.stepIndex++; this.exploreTarget = null; continue; }
      if (r.fail) {
        // Blocked by something that might move (the cat, a locked door)? Wait it out.
        if (!this.#somethingMightMove()) { this.#finish(false, r.fail); continue; }
        if (!cmd.waiting) this.say(this.catAt ? 'The cat is in the way. Waiting.' : 'Waiting for the door to be unlocked.', 'info');
        cmd.waiting = true;
        r = { act: 'wait' };
      } else cmd.waiting = false;
      this.#act(r);
      if (r.completes) { cmd.stepIndex++; this.exploreTarget = null; }
      this.world?.step(this);
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

  #somethingMightMove() {
    if (this.catAt) return true;
    for (const until of this.lockedUntil.values()) if (until > this.ticks) return true;
    return false;
  }

  #act(a) {
    const { h } = this;
    if (a.act === 'move') {
      const [x, y] = a.to;
      const i = h.idx(x, y);
      this.ticks++;
      if (h.dyn.closed.has(i)) {
        if (h.dyn.locked.has(i)) {
          this.lockedUntil.set(i, this.ticks + LOCK_RETRY);
          this.say("This door is locked. Someone must be in there. I'll try again later.", 'surprise');
        } else {
          h.dyn.closed.delete(i);
          this.say('Opened a door.', 'action');
        }
        this.sense();
        return;
      }
      if (!h.passableNow(x, y)) { this.sense(); return; } // something got in the way; look again
      [this.x, this.y] = a.to;
      this.trail.push([this.x, this.y]);
      this.sense();
    } else if (a.act === 'wait') {
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
      case 'pick': return this.#pick(step.obj, step);
      case 'place': return this.#toDest(step.dest, true, step);
      case 'goto': return this.#toDest(step.dest, false, step);
      case 'find': return this.#find(step.obj, step);
      case 'exploreAll': return this.explore() ?? 'done';
      // Walk close enough to every surface to spot even small things.
      case 'sweep': return this.explore({}, null, (step.since ??= this.ticks), 'spoon') ?? 'done';
      case 'tidyPlan': return this.#tidyPlan(cmd);
      default: return { fail: `Unknown step ${step.op}` };
    }
  }

  // Look for something not in memory. Fresh memory re-checks stale places
  // once there's nothing new left to explore; static memory gives up.
  #search(obj, step) {
    const since = this.memory === 'fresh' ? (step.since ??= this.ticks) : null;
    return this.explore(roomHints(obj, this.strategy), null, since, obj) ?? {
      fail: since !== null
        ? `I've re-checked every room since you asked. There's no ${obj} anywhere.`
        : `I've looked in every room. There's no ${obj} in this house.`,
    };
  }

  #find(obj, step) {
    if (this.carrying === obj) return 'done';
    const b = this.objects.get(obj);
    if (!b) return this.#search(obj, step);
    // Static memory answers from memory. Fresh memory goes and checks first.
    if (this.memory === 'static' || b.t === this.ticks) {
      const where = b.on ? `${onOrIn(b.on)} the ${b.on}` : `on the ${this.h.roomTypeAt(b.x, b.y)} floor`;
      this.say(`The ${obj} is ${where}.`, 'done');
      return 'done';
    }
    return this.approach(b.x, b.y) ?? this.#search(obj, step);
  }

  #pick(obj, step) {
    if (this.carrying === obj) return 'done';
    const b = this.objects.get(obj);
    if (!b) return this.#search(obj, step);
    if (this.carrying) {
      // Hands full: put the current thing down right here.
      return { act: 'place', ...this.dropSpot(), label: 'down for a moment' };
    }
    if (this.touching(b.x, b.y)) {
      const real = this.h.objects.find((o) => o.name === obj);
      if (!real.carried && real.x === b.x && real.y === b.y) return { act: 'pick', obj };
      this.objects.delete(obj); // it was here a moment ago...
      this.say(`The ${obj} isn't where I last saw it.`, 'surprise');
      return this.#search(obj, step);
    }
    return this.approach(b.x, b.y) ?? { fail: `I can see the ${obj} but can't reach it.` };
  }

  #toDest(dest, placing, step) {
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
        const rooms = Object.fromEntries(dest.names.map((n) => [FURNITURE_ROOM[n], 1]));
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
      return this.explore({ [type]: 1 })
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

  // Put each known object somewhere a majority of Housekeep's annotators
  // called "put away", choosing the nearest such surface the robot knows.
  #tidyPlan(cmd) {
    const extra = [];
    const known = new Set(this.furniture.keys());
    const todo = [...this.objects.keys()];
    if (this.carrying) todo.unshift(this.carrying);
    for (const name of todo) {
      const b = this.objects.get(name) ?? { x: this.x, y: this.y, on: null };
      if (b.on && isTidy(name, b.on, known)) continue;
      const homes = homesFor(name, known);
      if (!homes.length) continue;
      const near = homes.map((f) => [f, this.furniture.get(f)])
        .sort((p, q) => (Math.abs(p[1].x - b.x) + Math.abs(p[1].y - b.y)) - (Math.abs(q[1].x - b.x) + Math.abs(q[1].y - b.y)))[0][0];
      extra.push({ op: 'pick', obj: name }, { op: 'place', dest: { kind: 'furniture', names: [near] } });
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
    case 'tidy': return [{ op: 'exploreAll' }, { op: 'sweep' }, { op: 'tidyPlan' }];
    default: return [];
  }
}
