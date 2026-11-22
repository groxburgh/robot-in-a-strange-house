// Plain-English commands -> structured tasks. Deliberately rule-based: it runs
// offline, it's deterministic, and every failure tells you exactly which word
// it didn't understand.
//
//   "put the mug in the sink then bring me the book"
//   -> [{type:'deliver', obj:'mug', dest:{kind:'furniture', names:['sink']}},
//       {type:'deliver', obj:'book', dest:{kind:'user'}}]

import { OBJECTS, SYNONYMS, ALL_FURNITURE, ALL_ROOMS, ALL_OBJECTS, FURNITURE_ROOM, onOrIn } from './catalog.js';

const FILLER = /\b(please|could you|can you|would you|will you|kindly|now|for me|the|a|an|my|your|some|that|this|go and)\b/g;
const VERB_START = /^(put|place|move|take|bring|carry|return|drop|leave|set|fetch|get|grab|give|go|walk|head|drive|run|find|locate|search|look|where|show|tidy|clean|explore|map|scan|come)\b/;
const USER_WORDS = new Set(['me', 'here', 'front door', 'door', 'you', 'entrance', 'start']);

function canon(phrase) {
  let p = phrase.trim().replace(/\s+/g, ' ');
  if (!p) return null;
  // "shelf in living room" -> "shelf", remembering the room to narrow it down
  const roomMatch = p.match(/ (?:in|from) ([a-z ]+)$/);
  const roomWords = roomMatch ? canonExact(roomMatch[1]) : null;
  const inRoom = roomWords && ALL_ROOMS.includes(roomWords[0]) ? roomWords[0] : null;
  const tries = [p, ...[' in ', ' on ', ' next to ', ' from ', ' that ', ' which '].map((w) => p.split(w)[0])];
  for (const t of tries) {
    const c = canonExact(t);
    if (!c) continue;
    if (inRoom && c.length > 1) {
      const narrowed = c.filter((n) => FURNITURE_ROOM[n] === inRoom);
      if (narrowed.length) return narrowed;
    }
    return c;
  }
  return null;
}

function canonExact(t) {
  for (const cand of [t, t.replace(/es$/, ''), t.replace(/s$/, '')]) {
    if (OBJECTS[cand] || ALL_FURNITURE.includes(cand) || ALL_ROOMS.includes(cand)) return [cand];
    if (SYNONYMS[cand]) return SYNONYMS[cand];
  }
  return null;
}

function resolveObject(phrase) {
  const c = canon(phrase);
  if (c && OBJECTS[c[0]]) return { obj: c[0] };
  return {
    error: `I don't know what "${phrase.trim()}" is. Things I can carry: ${ALL_OBJECTS.join(', ')}.`,
  };
}

function resolveDest(phrase) {
  const p = phrase.trim();
  if (USER_WORDS.has(p) || p === 'back to me' || p === 'to me') return { dest: { kind: 'user' } };
  const c = canon(p);
  if (c && ALL_FURNITURE.includes(c[0])) return { dest: { kind: 'furniture', names: c } };
  if (c && ALL_ROOMS.includes(c[0])) return { dest: { kind: 'room', names: c } };
  if (c && OBJECTS[c[0]]) return { error: `The ${c[0]} isn't a place. Try a room or a piece of furniture.` };
  return { error: `I don't know where "${p}" is.` };
}

function splitClauses(text) {
  const rough = text
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[!?]/g, '.')
    .replace(/\b(go|come|run) and\b/g, ' ')
    .split(/[.;,]|\band then\b|\bthen\b|\bafter that\b|\bafterwards\b|\bfinally\b/)
    .map((s) => s.trim())
    .filter(Boolean);
  // Also split on "and" when what follows is a new instruction.
  const out = [];
  for (const r of rough) {
    const parts = r.split(/\band\b/).map((s) => s.trim());
    let acc = parts[0];
    for (let i = 1; i < parts.length; i++) {
      if (VERB_START.test(parts[i].replace(FILLER, ' ').trim())) { out.push(acc); acc = parts[i]; }
      else acc += ' and ' + parts[i];
    }
    if (acc) out.push(acc);
  }
  return out.filter(Boolean);
}

export function parseClause(raw) {
  const c = raw.replace(FILLER, ' ').replace(/\s+/g, ' ').trim();
  let m;
  if (/^(tidy|clean)( up)?( (house|place|everything|room|up house|up everything))?$/.test(c)
    || /^put (everything|things|stuff) (away|back)$/.test(c)) return { type: 'tidy' };
  if (/^(explore|map|scan|look around|have a look around)( (house|place|around|everything))?$/.test(c)) return { type: 'explore' };
  if (/^(come|go|head)( back)?( (here|home|to me|to front door|back to me))?$/.test(c)) {
    return { type: 'goto', dest: { kind: 'user' } };
  }
  if ((m = c.match(/^(?:put|place|move|take|bring|carry|return|drop|leave|set)\s+(.+?)\s+(?:back\s+)?(?:in|into|on|onto|to|inside|on top of|in to|next to|by)\s+(.+)$/))) {
    const o = resolveObject(m[1]);
    if (o.error) return o;
    const d = resolveDest(m[2]);
    if (d.error) return d;
    return { type: 'deliver', obj: o.obj, dest: d.dest };
  }
  if ((m = c.match(/^(?:bring|fetch|get|grab|give)\s+(?:me\s+)?(.+?)(?:\s+(?:to me|here|back|over|over here))?$/))) {
    const o = resolveObject(m[1]);
    if (o.error) return o;
    return { type: 'deliver', obj: o.obj, dest: { kind: 'user' } };
  }
  if ((m = c.match(/^(?:go|walk|head|move|drive|run)(?:\s+over)?(?:\s+(?:to|into|in))?\s+(.+)$/))) {
    const d = resolveDest(m[1]);
    if (d.error) return d;
    return { type: 'goto', dest: d.dest };
  }
  if ((m = c.match(/^(?:find|locate|look for|search for|where is|where's|wheres|where are|show me)\s+(.+)$/))) {
    const o = resolveObject(m[1]);
    if (o.error) return o;
    return { type: 'find', obj: o.obj };
  }
  return { error: `I didn't understand "${raw.trim()}". Try something like "put the mug in the sink".` };
}

export function parse(text) {
  const clauses = splitClauses(text);
  if (!clauses.length) return { error: 'Tell me what to do.' };
  const tasks = [];
  for (const cl of clauses) {
    const t = parseClause(cl);
    if (t.error) return { error: t.error };
    tasks.push({ ...t, text: describe(t) });
  }
  return { tasks };
}

export function preposition(dest) {
  return dest.kind === 'room' ? 'in' : onOrIn(dest.names[0]);
}

export function describe(t) {
  const d = (dest) => (dest.kind === 'user' ? 'me'
    : dest.names.length > 1 ? `a ${dest.names[0].split(' ').pop()}` : `the ${dest.names[0]}`);
  switch (t.type) {
    case 'deliver': return t.dest.kind === 'user' ? `Bring me the ${t.obj}`
      : `Put the ${t.obj} ${preposition(t.dest)} ${d(t.dest)}`;
    case 'goto': return t.dest.kind === 'user' ? 'Come back to the front door' : `Go to ${d(t.dest)}`;
    case 'find': return `Find the ${t.obj}`;
    case 'explore': return 'Explore the house';
    case 'tidy': return 'Tidy up';
    default: return t.type;
  }
}
