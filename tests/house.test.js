import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateHouse, WALL } from '../src/house.js';
import { REQUIRED_ROOMS } from '../src/catalog.js';
import { trueDistance } from '../src/oracle.js';

const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1);

test('same seed gives the same house', () => {
  const a = generateHouse(42), b = generateHouse(42);
  assert.deepEqual([...a.cells], [...b.cells]);
  assert.deepEqual(a.objects, b.objects);
  assert.deepEqual(a.furniture, b.furniture);
});

test('different seeds give different houses', () => {
  assert.notDeepEqual([...generateHouse(1).cells], [...generateHouse(2).cells]);
});

test('every house has the four essential rooms', () => {
  for (const s of SEEDS) {
    const types = generateHouse(s).rooms.map((r) => r.type);
    for (const t of REQUIRED_ROOMS) assert.ok(types.includes(t), `seed ${s} lacks ${t}`);
  }
});

test('every walkable cell can be reached from the front door', () => {
  for (const s of SEEDS) {
    const h = generateHouse(s);
    let walkable = 0;
    for (let y = 0; y < h.H; y++) for (let x = 0; x < h.W; x++) if (h.walkable(x, y)) walkable++;
    let reached = 0;
    trueDistance(h, h.start.x, h.start.y, () => { reached++; return false; });
    assert.equal(reached, walkable, `seed ${s}: ${walkable - reached} cells unreachable`);
  }
});

test('every object and piece of furniture can be reached by an arm', () => {
  for (const s of SEEDS) {
    const h = generateHouse(s);
    for (const t of [...h.objects, ...h.furniture]) {
      const r = trueDistance(h, h.start.x, h.start.y, (x, y) => Math.abs(x - t.x) + Math.abs(y - t.y) <= 1);
      assert.ok(r, `seed ${s}: ${t.name} unreachable`);
    }
  }
});

test('the outer boundary is solid wall', () => {
  const h = generateHouse(7);
  for (let x = 0; x < h.W; x++) {
    assert.equal(h.cells[h.idx(x, 0)], WALL);
    assert.equal(h.cells[h.idx(x, h.H - 1)], WALL);
  }
});
