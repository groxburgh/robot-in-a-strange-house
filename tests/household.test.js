import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateHouse, WALL } from '../src/house.js';
import { Robot } from '../src/robot.js';
import { Household } from '../src/household.js';
import { parse } from '../src/parser.js';
import { trueDistance } from '../src/oracle.js';

const run = (robot, text) => { robot.command(parse(text)); robot.runToCompletion(); return robot.history.at(-1); };

test('the household never cuts off part of the house', () => {
  for (let s = 1; s <= 15; s++) {
    const h = generateHouse(s);
    const hh = new Household(h, { activity: 3 });
    const r = new Robot(h, { world: hh });
    for (let t = 0; t < 1500; t++) {
      hh.step(r);
      if (t % 100) continue;
      // Ignoring doors (which can be opened) and the cat, every free cell connects.
      const free = (x, y) => h.cells[h.idx(x, y)] !== WALL && !h.furnAt.has(h.idx(x, y)) && !h.dyn.clutter.has(h.idx(x, y));
      let total = 0, reached = 0;
      for (let y = 0; y < h.H; y++) for (let x = 0; x < h.W; x++) if (free(x, y)) total++;
      const q = [[h.start.x, h.start.y]], seen = new Set([h.idx(h.start.x, h.start.y)]);
      while (q.length) {
        const [x, y] = q.pop(); reached++;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const i = h.idx(x + dx, y + dy);
          if (free(x + dx, y + dy) && !seen.has(i)) { seen.add(i); q.push([x + dx, y + dy]); }
        }
      }
      assert.equal(reached, total, `seed ${s} tick ${t}`);
    }
  }
});

test('the household only moves things the robot cannot currently see', () => {
  for (let s = 1; s <= 10; s++) {
    const h = generateHouse(s);
    const hh = new Household(h, { activity: 3 });
    const r = new Robot(h, { world: hh });
    for (let t = 0; t < 600; t++) {
      const before = h.objects.map((o) => [o.x, o.y]);
      hh.step(r);
      h.objects.forEach((o, k) => {
        if (o.x === before[k][0] && o.y === before[k][1]) return;
        assert.ok(!r.visible.has(h.idx(before[k][0], before[k][1])), `seed ${s}: moved from in view`);
        assert.ok(!r.visible.has(h.idx(o.x, o.y)), `seed ${s}: moved into view`);
      });
    }
  }
});

// Explore the house, then move one object to the far side of the house while the robot isn't looking.
function movedBehindItsBack(seed, memory) {
  const h = generateHouse(seed);
  const r = new Robot(h, { memory });
  run(r, 'explore the house');
  run(r, 'come back');
  const o = h.objects[0];
  o.on = null;
  const far = h.rooms.flatMap((room) => room.cells)
    .filter(([x, y]) => h.passableNow(x, y) && !r.visible.has(h.idx(x, y)) && !h.objectAt(x, y))
    .sort((a, b) => Math.hypot(b[0] - o.x, b[1] - o.y) - Math.hypot(a[0] - o.x, a[1] - o.y))[0];
  [o.x, o.y] = far;
  return { h, r, o };
}

test('static memory wrongly concludes a moved object is gone', () => {
  let wrong = 0;
  for (let s = 1; s <= 10; s++) {
    const { r, o } = movedBehindItsBack(s, 'static');
    const res = run(r, `bring me the ${o.name}`);
    if (!res.ok) { wrong++; assert.match(res.why, /no /); }
  }
  assert.ok(wrong >= 5, `only ${wrong}/10 failed`);
});

test('fresh memory re-checks and finds a moved object', () => {
  for (let s = 1; s <= 10; s++) {
    const { h, r, o } = movedBehindItsBack(s, 'fresh');
    const res = run(r, `bring me the ${o.name}`);
    assert.ok(res.ok, `seed ${s}: ${res.why}`);
    const moved = h.objects.find((q) => q.name === o.name);
    assert.ok(Math.abs(moved.x - h.start.x) + Math.abs(moved.y - h.start.y) <= 1);
  }
});

test('in a chaotic house the robot copes and never walks through anything', () => {
  let ok = 0;
  for (let s = 1; s <= 20; s++) {
    const h = generateHouse(s);
    const hh = new Household(h, { activity: 3 });
    const r = new Robot(h, { world: hh });
    const res = run(r, `put the ${h.objects[0].name} on the ${h.furniture.find((f) => f.name !== h.objects[0].on).name} then bring me the ${h.objects[1].name}`);
    if (res.ok && r.history.every((x) => x.ok)) ok++;
    for (const [x, y] of r.trail) {
      assert.ok(h.cells[h.idx(x, y)] !== WALL && !h.furnAt.has(h.idx(x, y)), `seed ${s}`);
    }
  }
  assert.ok(ok >= 16, `${ok}/20 chains completed`);
});

test('small things are only noticed up close', () => {
  const h = generateHouse(4);
  const r = new Robot(h, { eyesight: 'poor' });
  assert.ok(r.sightRange('spoon') < r.sightRange('laptop'));
  for (const [name, b] of r.objects) {
    const d = Math.hypot(b.x - r.x, b.y - r.y);
    assert.ok(d <= r.sightRange(name), `${name} seen from ${d}`);
  }
});

test('closed doors get opened; the robot still reaches every room', () => {
  const h = generateHouse(6);
  for (const d of h.doors) h.dyn.closed.add(h.idx(d.x, d.y));
  const r = new Robot(h);
  const res = run(r, 'explore the house');
  assert.ok(res.ok);
  assert.equal(r.seenRooms.size, h.rooms.length);
  assert.ok(r.events.some((e) => /Opened a door/.test(e.text)));
  assert.ok(trueDistance(h, r.x, r.y, () => true));
});
