import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateHouse, N4 } from '../src/house.js';
import { Robot, UNKNOWN } from '../src/robot.js';
import { parse } from '../src/parser.js';
import { oracleDeliver } from '../src/oracle.js';
import { ALL_OBJECTS, isTidy } from '../src/catalog.js';

const run = (house, text, opts) => {
  const r = new Robot(house, opts);
  r.command(parse(text));
  r.runToCompletion();
  return r;
};

test('starts out knowing only what it can see from the door', () => {
  const h = generateHouse(5);
  const r = new Robot(h);
  let floor = 0, seen = 0;
  for (let i = 0; i < h.cells.length; i++) if (h.cells[i]) { floor++; if (r.known[i] !== UNKNOWN) seen++; }
  assert.ok(seen / floor < 0.4, `saw ${seen}/${floor} on arrival`);
});

test('delivers an object to furniture in 60 unseen houses', () => {
  for (let s = 1; s <= 60; s++) {
    const h = generateHouse(s);
    const o = h.objects[0];
    const f = h.furniture.find((q) => q.name !== o.on);
    const r = run(h, `put the ${o.name} on the ${f.name}`);
    assert.ok(r.history[0].ok, `seed ${s}: ${r.history[0].why}`);
    const moved = h.objects.find((q) => q.name === o.name);
    assert.equal(moved.on, f.name, `seed ${s}`);
  }
});

test('never beats the oracle and never walks through walls', () => {
  for (let s = 1; s <= 40; s++) {
    const h = generateHouse(s);
    const o = h.objects[1];
    const r = run(h, `bring me the ${o.name}`);
    assert.ok(r.history[0].ok);
    assert.ok(r.history[0].ticks >= oracleDeliver(h, o.name, { kind: 'user' }), `seed ${s}`);
    for (let k = 1; k < r.trail.length; k++) {
      const [ax, ay] = r.trail[k - 1], [bx, by] = r.trail[k];
      assert.equal(Math.abs(ax - bx) + Math.abs(ay - by), 1, `seed ${s}: jump`);
      assert.ok(h.walkable(bx, by), `seed ${s}: walked into ${bx},${by}`);
    }
  }
});

test('says so when the object does not exist in this house', () => {
  const h = generateHouse(3);
  const missing = ALL_OBJECTS.find((o) => !h.objects.some((q) => q.name === o));
  const r = run(h, `find the ${missing}`);
  assert.equal(r.history[0].ok, false);
  assert.match(r.history[0].why, new RegExp(`no ${missing}`));
});

test('a failed step cancels the rest of the chain', () => {
  const h = generateHouse(3);
  const missing = ALL_OBJECTS.find((o) => !h.objects.some((q) => q.name === o));
  const r = run(h, `bring me the ${missing} then tidy up`);
  assert.equal(r.history.length, 1);
});

test('tidy up puts every object where it belongs', () => {
  for (let s = 1; s <= 25; s++) {
    const h = generateHouse(s);
    const r = run(h, 'tidy up');
    assert.ok(r.history[0].ok, `seed ${s}`);
    const present = new Set(h.furniture.map((f) => f.name));
    for (const o of h.objects) {
      assert.ok(o.on && isTidy(o.name, o.on, present), `seed ${s}: ${o.name} left on ${o.on}`);
    }
  }
});

test('bring me two things in a row: both end up by the door, on different cells', () => {
  const h = generateHouse(9);
  const [a, b] = h.objects;
  run(h, `bring me the ${a.name} then bring me the ${b.name}`);
  const A = h.objects.find((o) => o.name === a.name), B = h.objects.find((o) => o.name === b.name);
  assert.ok(!(A.x === B.x && A.y === B.y));
  for (const o of [A, B]) assert.ok(Math.abs(o.x - h.start.x) + Math.abs(o.y - h.start.y) <= 1);
});

test('both search strategies reach the same outcome', () => {
  for (let s = 1; s <= 20; s++) {
    for (const strategy of ['naive', 'semantic']) {
      const h = generateHouse(s);
      const r = run(h, `bring me the ${h.objects[2].name}`, { strategy });
      assert.ok(r.history[0].ok, `seed ${s} ${strategy}`);
    }
  }
});

test('N4 neighbours are the four compass directions', () => {
  assert.equal(N4.length, 4);
});
