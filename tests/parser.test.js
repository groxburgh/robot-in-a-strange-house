import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/parser.js';

const one = (text) => {
  const r = parse(text);
  assert.ok(!r.error, `${text}: ${r.error}`);
  assert.equal(r.tasks.length, 1, text);
  return r.tasks[0];
};

test('put X in Y', () => {
  const t = one('Put the mug in the sink');
  assert.equal(t.type, 'deliver');
  assert.equal(t.obj, 'mug');
  assert.deepEqual(t.dest, { kind: 'furniture', names: ['sink'] });
});

test('synonyms map to canonical names', () => {
  assert.equal(one('put the glass on the couch').obj, 'cup');
  assert.deepEqual(one('put the glass on the couch').dest.names, ['sofa']);
  const t = one('take the trainers to the washer');
  assert.equal(t.obj, 'shoes');
  assert.deepEqual(t.dest.names, ['washing machine']);
});

test('ambiguous "table" keeps every candidate', () => {
  assert.deepEqual(one('put the remote on the table').dest.names, ['dining table', 'coffee table', 'desk', 'nightstand']);
});

test('bring me / fetch / get go to the user', () => {
  for (const s of ['bring me the book', 'fetch the book', 'go and get the book', 'bring the book to me', 'can you grab my book please']) {
    const t = one(s);
    assert.equal(t.obj, 'book', s);
    assert.equal(t.dest.kind, 'user', s);
  }
});

test('rooms as destinations', () => {
  assert.deepEqual(one('take the towel to the bathroom').dest, { kind: 'room', names: ['bathroom'] });
  assert.deepEqual(one('go to the lounge').dest, { kind: 'room', names: ['living room'] });
});

test('extra location words are ignored', () => {
  assert.deepEqual(one('put the book on the shelf in the living room').dest.names, ['bookshelf']);
  assert.deepEqual(one('put the book on the shelf in the bedroom').dest.names, ['bedroom shelf']);
  assert.equal(one('bring me the apple from the kitchen').obj, 'apple');
});

test('chained commands', () => {
  const r = parse('put the mug in the sink, then bring me the book and tidy up');
  assert.deepEqual(r.tasks.map((t) => t.type), ['deliver', 'deliver', 'tidy']);
});

test('"and" inside a clause does not split it', () => {
  const r = parse('find the remote and come back');
  assert.deepEqual(r.tasks.map((t) => t.type), ['find', 'goto']);
});

test('find, explore, tidy, come back', () => {
  assert.equal(one("where's the remote?").type, 'find');
  assert.equal(one('explore the house').type, 'explore');
  assert.equal(one('clean up').type, 'tidy');
  assert.deepEqual(one('come back').dest, { kind: 'user' });
});

test('unknown words produce a helpful error', () => {
  assert.match(parse('bring me the banana').error, /banana/);
  assert.match(parse('put the mug in the volcano').error, /volcano/);
  assert.match(parse('do a backflip').error, /didn't understand/);
  assert.ok(parse('').error);
});
