// Shortest possible step counts for a robot that already has the floor plan
// memorised. Used as the yardstick for the SPL score in the benchmark.

import { N4 } from './house.js';

// BFS on the true map from (sx, sy) to the nearest cell satisfying isGoal.
export function trueDistance(house, sx, sy, isGoal) {
  const { W, H } = house;
  const dist = new Int32Array(W * H).fill(-1);
  const q = [[sx, sy]];
  dist[house.idx(sx, sy)] = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const [x, y] = q[qi];
    const d = dist[house.idx(x, y)];
    if (isGoal(x, y)) return { d, x, y };
    for (const [dx, dy] of N4) {
      const nx = x + dx, ny = y + dy;
      if (!house.walkable(nx, ny) || dist[house.idx(nx, ny)] !== -1) continue;
      dist[house.idx(nx, ny)] = d + 1;
      q.push([nx, ny]);
    }
  }
  return null;
}

const near = (tx, ty) => (x, y) => Math.abs(x - tx) + Math.abs(y - ty) <= 1;

// Oracle cost of: walk to object, pick it up, walk to destination, put it down.
export function oracleDeliver(house, objName, dest) {
  const o = house.objects.find((q) => q.name === objName);
  const a = trueDistance(house, house.start.x, house.start.y, near(o.x, o.y));
  let b;
  if (dest.kind === 'user') {
    b = trueDistance(house, a.x, a.y, (x, y) => x === house.start.x && y === house.start.y);
  } else {
    const f = house.furnitureByName.get(dest.names.find((n) => house.furnitureByName.has(n)));
    b = trueDistance(house, a.x, a.y, near(f.x, f.y));
  }
  return a.d + b.d + 2; // +1 pick, +1 place
}
