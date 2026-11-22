// Procedural house generator. Same seed -> same house.
//
// Layout is a binary space partition: the floor plate is split recursively into
// rooms, and every split gets exactly one doorway. That guarantees every room is
// reachable without making the plan look like a maze.

import { makeRng } from './rng.js';
import { EXTRA_ROOMS, REQUIRED_ROOMS, FURNITURE, OBJECTS, placeMisplaced } from './catalog.js';

export const WALL = 0;
export const FLOOR = 1;
export const DOOR = 2;

const MIN_ROOM = 5;
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const N8 = [...N4, [1, 1], [1, -1], [-1, 1], [-1, -1]];

export function generateHouse(seed, opts = {}) {
  const W = opts.width ?? 36;
  const H = opts.height ?? 24;
  // How misplaced objects are scattered: 'housekeep' (human data), 'procthor'
  // (rooms they belong in) or 'random'. See placeMisplaced in catalog.js.
  const placement = opts.placement ?? 'housekeep';
  const rng = makeRng(seed);

  const cells = new Uint8Array(W * H); // all WALL
  const roomId = new Int16Array(W * H).fill(-1);
  const idx = (x, y) => y * W + x;

  // ---- 1. Partition the interior into rooms -------------------------------
  const root = { x: 1, y: 1, w: W - 2, h: H - 2 };
  let leaves = [root];
  const splits = [];
  const target = rng.int(5, 7);
  while (leaves.length < target) {
    const candidates = leaves
      .filter((r) => r.w >= 2 * MIN_ROOM + 1 || r.h >= 2 * MIN_ROOM + 1)
      .sort((a, b) => b.w * b.h - a.w * a.h);
    if (!candidates.length) break;
    const r = candidates[0];
    const canV = r.w >= 2 * MIN_ROOM + 1;
    const canH = r.h >= 2 * MIN_ROOM + 1;
    let vertical;
    if (canV && !canH) vertical = true;
    else if (canH && !canV) vertical = false;
    else if (r.w > r.h * 1.25) vertical = true;
    else if (r.h > r.w * 1.25) vertical = false;
    else vertical = rng.chance(0.5);

    let a, b, split;
    if (vertical) {
      const s = rng.int(Math.max(r.x + MIN_ROOM, r.x + Math.floor(r.w * 0.35)),
        Math.min(r.x + r.w - 1 - MIN_ROOM, r.x + Math.ceil(r.w * 0.65)));
      a = { x: r.x, y: r.y, w: s - r.x, h: r.h };
      b = { x: s + 1, y: r.y, w: r.x + r.w - 1 - s, h: r.h };
      split = { vertical, line: s, from: r.y, to: r.y + r.h - 1 };
    } else {
      const s = rng.int(Math.max(r.y + MIN_ROOM, r.y + Math.floor(r.h * 0.35)),
        Math.min(r.y + r.h - 1 - MIN_ROOM, r.y + Math.ceil(r.h * 0.65)));
      a = { x: r.x, y: r.y, w: r.w, h: s - r.y };
      b = { x: r.x, y: s + 1, w: r.w, h: r.y + r.h - 1 - s };
      split = { vertical, line: s, from: r.x, to: r.x + r.w - 1 };
    }
    splits.push(split);
    leaves = leaves.filter((l) => l !== r).concat([a, b]);
  }

  for (const r of leaves) {
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) cells[idx(x, y)] = FLOOR;
  }

  // ---- 2. One doorway per split (keeps the whole house connected) ---------
  const doors = [];
  for (const s of splits) {
    const options = [];
    for (let t = s.from; t <= s.to; t++) {
      const [x, y] = s.vertical ? [s.line, t] : [t, s.line];
      const [ax, ay, bx, by] = s.vertical ? [x - 1, y, x + 1, y] : [x, y - 1, x, y + 1];
      if (cells[idx(ax, ay)] === FLOOR && cells[idx(bx, by)] === FLOOR) options.push([x, y]);
    }
    const [dx, dy] = rng.pick(options);
    cells[idx(dx, dy)] = DOOR;
    doors.push({ x: dx, y: dy });
  }

  // ---- 3. Name the rooms ----------------------------------------------------
  const bySize = leaves.slice().sort((p, q) => q.w * q.h - p.w * p.h);
  const types = new Map();
  types.set(bySize[0], 'living room');
  types.set(bySize[bySize.length - 1], 'bathroom');
  const middle = rng.shuffle(bySize.slice(1, -1));
  const rest = ['kitchen', 'bedroom', ...rng.shuffle(EXTRA_ROOMS)];
  middle.forEach((r, i) => types.set(r, rest[i]));

  const rooms = leaves.map((r, id) => {
    const room = { id, type: types.get(r), ...r, cells: [] };
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) {
        roomId[idx(x, y)] = id;
        room.cells.push([x, y]);
      }
    return room;
  });
  for (const t of REQUIRED_ROOMS) {
    if (!rooms.some((r) => r.type === t)) throw new Error(`house ${seed} missing ${t}`);
  }

  // ---- 4. Front door / start position --------------------------------------
  const onEdge = (x, y) => x === 1 || y === 1 || x === W - 2 || y === H - 2;
  const living = rooms.find((r) => r.type === 'living room');
  let startCells = living.cells.filter(([x, y]) => onEdge(x, y));
  if (!startCells.length) startCells = rooms.flatMap((r) => r.cells).filter(([x, y]) => onEdge(x, y));
  const [sx, sy] = rng.pick(startCells);
  const start = { x: sx, y: sy };
  const frontDoor = sx === 1 ? { x: 0, y: sy } : sx === W - 2 ? { x: W - 1, y: sy }
    : sy === 1 ? { x: sx, y: 0 } : { x: sx, y: H - 1 };

  // ---- 5. Furniture, placed against walls without blocking anything --------
  const furniture = [];
  const furnAt = new Map();
  const nearDoor = (x, y) =>
    N8.some(([dx, dy]) => cells[idx(x + dx, y + dy)] === DOOR) || cells[idx(x, y)] === DOOR;
  const againstWall = (x, y) => N4.some(([dx, dy]) => cells[idx(x + dx, y + dy)] === WALL);

  const walkable = (x, y) =>
    x >= 0 && y >= 0 && x < W && y < H && cells[idx(x, y)] !== WALL && !furnAt.has(idx(x, y));

  const allConnected = () => {
    let total = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (walkable(x, y)) total++;
    const seen = new Uint8Array(W * H);
    const q = [[start.x, start.y]];
    seen[idx(start.x, start.y)] = 1;
    let n = 0;
    while (q.length) {
      const [x, y] = q.pop();
      n++;
      for (const [dx, dy] of N4) {
        const nx = x + dx, ny = y + dy;
        if (walkable(nx, ny) && !seen[idx(nx, ny)]) { seen[idx(nx, ny)] = 1; q.push([nx, ny]); }
      }
    }
    return n === total;
  };

  for (const room of rooms) {
    for (const name of FURNITURE[room.type]) {
      const options = rng.shuffle(
        room.cells.filter(([x, y]) =>
          againstWall(x, y) && !nearDoor(x, y) && !(x === start.x && y === start.y)
          && !furnAt.has(idx(x, y))
          && !N8.some(([dx, dy]) => furnAt.has(idx(x + dx, y + dy)))),
      );
      for (const [x, y] of options) {
        furnAt.set(idx(x, y), name);
        if (allConnected()) {
          furniture.push({ name, room: room.id, x, y });
          break;
        }
        furnAt.delete(idx(x, y));
      }
    }
  }
  const furnitureByName = new Map(furniture.map((f) => [f.name, f]));

  // ---- 6. Scatter the objects (the mess the robot has to deal with) ---------
  const present = new Set(furniture.map((f) => f.name));
  const chosen = rng.shuffle(Object.keys(OBJECTS)).slice(0, rng.int(6, 8));
  const objects = [];
  const occupied = new Set();
  const freeFloor = (room) => room.cells.filter(([x, y]) =>
    walkable(x, y) && !occupied.has(idx(x, y)) && !(x === start.x && y === start.y));
  const surfacesIn = (room) => furniture.filter((f) => f.room === room.id).map((f) => f.name);
  for (const name of chosen) {
    const ok = (room, spot) => (spot === 'floor' ? freeFloor(room).length > 0 : surfacesIn(room).includes(spot));
    let pick = null;
    for (let tries = 0; !pick && tries < 20; tries++) pick = placeMisplaced(rng, name, rooms, placement, ok, surfacesIn);
    if (!pick) pick = { room: rooms.find((r) => freeFloor(r).length), spot: 'floor' };
    if (pick.spot === 'floor') {
      const [x, y] = rng.pick(freeFloor(pick.room));
      occupied.add(idx(x, y));
      objects.push({ name, x, y, on: null });
    } else {
      const f = furniture.find((q) => q.room === pick.room.id && q.name === pick.spot);
      objects.push({ name, x: f.x, y: f.y, on: f.name });
    }
  }

  return {
    seed, W, H, cells, roomId, rooms, doors, start, frontDoor,
    furniture, furnitureByName, furnAt, objects, placement,
    idx,
    walkable,
    // Things the household can change after generation (see household.js).
    dyn: { closed: new Set(), locked: new Map(), clutter: new Map(), cat: null },
    // Can something step onto this cell right now? (closed doors need opening first)
    passableNow(x, y) {
      if (!walkable(x, y)) return false;
      const i = idx(x, y);
      const d = this.dyn;
      if (d.closed.has(i) || d.clutter.has(i)) return false;
      if (d.cat && d.cat.x === x && d.cat.y === y) return false;
      return true;
    },
    blocksSight(x, y) {
      const i = idx(x, y);
      return cells[i] === WALL || this.dyn.closed.has(i);
    },
    roomTypeAt(x, y) {
      const id = roomId[idx(x, y)];
      return id >= 0 ? rooms[id].type : null;
    },
    objectAt(x, y) {
      return objects.find((o) => o.x === x && o.y === y && !o.carried) ?? null;
    },
    objectsAt(x, y) {
      return objects.filter((o) => o.x === x && o.y === y && !o.carried);
    },
  };
}

export { N4, N8 };
