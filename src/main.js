// Browser front end: wires the simulator to the canvas and the controls.
import { generateHouse } from './house.js';
import { Household } from './household.js';
import { Robot, UNKNOWN } from './robot.js';
import { parse } from './parser.js';
import { draw, readColors } from './render.js';
import { makeRng } from './rng.js';
import { ALL_OBJECTS, onOrIn } from './catalog.js';

{
  const $ = (id) => document.getElementById(id);
  const canvas = $('plan');
  const ctx = canvas.getContext('2d');
  const FONT = 'Archivo, system-ui, sans-serif';

  let house, robot, seed, household;
  let strategy = 'procthor';
  let activity = 1;
  let memory = 'fresh';
  let eyesight = 'good';
  let worldCount = 0;
  let reveal = true;
  let speed = 24; // ticks per second
  let acc = 0;
  let last = performance.now();
  let hover = null;
  let logCount = 0;
  let colors = readColors(document.documentElement);

  function seedFromHash() {
    const m = location.hash.match(/^#house-(\d+)$/);
    return m ? Number(m[1]) : null;
  }

  function newHouse(s) {
    seed = s;
    house = generateHouse(seed);
    household = new Household(house, { activity });
    robot = new Robot(house, { strategy, memory, eyesight, world: household });
    logCount = 0;
    worldCount = household.events.length;
    $('log').innerHTML = '';
    $('s-seed').textContent = `#${seed}`;
    try { history.replaceState(null, '', `#house-${seed}`); } catch { /* sandboxed frames */ }
    renderChips();
  }

  function renderChips() {
    const rng = makeRng(seed * 31 + 7);
    const objs = rng.shuffle(house.objects.map((o) => o.name));
    const furn = rng.pick(house.furniture.filter((f) => !['bed', 'sofa'].includes(f.name)));
    const absent = rng.pick(ALL_OBJECTS.filter((o) => !objs.includes(o)));
    const chips = [
      `Explore the house, then bring me the ${objs[0]}`,
      `Put the ${objs[1]} ${onOrIn(furn.name)} the ${furn.name}`,
      `Find the ${objs[2]}, then come back`,
      'Tidy up',
      `Where's the ${absent}?`,
    ];
    $('chips').innerHTML = chips.map((c) => `<button type="button">${c}</button>`).join('');
  }

  function send(text) {
    const t = text.trim();
    if (!t) return;
    const parsed = parse(t);
    if (parsed.error) robot.say(parsed.error, 'error');
    else robot.command(parsed);
  }

  // ---- drawing ----------------------------------------------------------
  function resize() {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
  }

  function frame(now) {
    const dt = Math.min(now - last, 250);
    last = now;
    // Life goes on while the robot works (robot.tick steps the household) and
    // while it stands idle (we step the household ourselves).
    acc += (dt * Math.min(speed, robot.busy ? speed : 24)) / 1000;
    let n = 0;
    while (acc >= 1 && n < 40) {
      if (robot.busy) robot.tick();
      else if (activity > 0 || house.dyn.cat) { household.step(robot); robot.sense(); }
      acc -= 1; n++;
    }
    if (acc > 40) acc = 0;

    const cs = canvas.width / house.W;
    draw(ctx, cs, house, robot, { colors, reveal, hover, font: FONT, fade: activity > 0 });
    updatePanel();
    requestAnimationFrame(frame);
  }

  function updatePanel() {
    let floor = 0, seen = 0;
    for (let i = 0; i < house.cells.length; i++) {
      if (house.cells[i] === 0) continue;
      floor++;
      if (robot.known[i] !== UNKNOWN) seen++;
    }
    $('s-steps').textContent = robot.ticks;
    $('s-seen').textContent = `${Math.round((100 * seen) / floor)}%`;
    $('s-rooms').textContent = `${robot.seenRooms.size} of ${house.rooms.length}`;
    $('s-hold').textContent = robot.carrying ? `the ${robot.carrying}` : 'nothing';
    $('stop').disabled = !robot.busy;

    if (household.events.length > worldCount) {
      // What the household did. Only shown with "Show the real house" on.
      if (reveal) for (const e of household.events.slice(worldCount)) robot.events.push({ t: '', text: e.text, kind: 'world' });
      worldCount = household.events.length;
    }
    if (robot.events.length > logCount) {
      const log = $('log');
      const frag = document.createDocumentFragment();
      for (const e of robot.events.slice(logCount)) {
        const li = document.createElement('li');
        li.className = e.kind;
        const t = document.createElement('span');
        t.className = 't';
        t.textContent = e.t;
        li.append(t, e.kind === 'command' ? e.text.replace(/^> /, '') : e.text);
        frag.append(li);
      }
      log.append(frag);
      logCount = robot.events.length;
      log.scrollTop = log.scrollHeight;
    }
  }

  function describeCell(x, y) {
    const i = house.idx(x, y);
    const known = robot.known[i] !== UNKNOWN;
    if (!known && !reveal) return 'Not seen yet.';
    if (house.cells[i] === 0) return 'Wall.';
    const live = reveal || robot.visible.has(i);
    const parts = [];
    const room = house.roomTypeAt(x, y);
    parts.push(room ? room[0].toUpperCase() + room.slice(1) : 'Doorway');
    if (house.dyn.closed.has(i) && live) parts.push(house.dyn.locked.has(i) ? 'locked door' : 'closed door');
    const f = house.furnAt.get(i);
    if (f) parts.push(f);
    if (live && house.dyn.clutter.has(i)) parts.push(house.dyn.clutter.get(i));
    if (live) {
      const objs = house.objectsAt(x, y).map((o) => o.name);
      if (objs.length) parts.push(objs.join(', '));
      if (house.dyn.cat && house.dyn.cat.x === x && house.dyn.cat.y === y) parts.push('the cat');
    } else {
      const mem = [...robot.objects].filter(([, b]) => b.x === x && b.y === y)
        .map(([n, b]) => `${n} (remembered from ${robot.ticks - b.t} steps ago)`);
      if (mem.length) parts.push(mem.join(', '));
    }
    if (x === robot.x && y === robot.y) parts.push('the robot');
    if (x === house.start.x && y === house.start.y) parts.push('front door');
    const age = robot.ticks - robot.lastSeen[i];
    const note = !known ? ' (robot hasn’t seen this)' : live && robot.visible.has(i) ? ' (in view)' : ` (last seen ${age} steps ago)`;
    return parts.join(' · ') + note;
  }

  // ---- events -------------------------------------------------------------
  $('cmd').addEventListener('submit', (e) => {
    e.preventDefault();
    send($('cmd-input').value);
    $('cmd-input').value = '';
  });
  $('chips').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) send(b.textContent);
  });
  $('speed').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    speed = Number(b.dataset.speed);
    for (const x of $('speed').querySelectorAll('button')) x.setAttribute('aria-pressed', String(x === b));
  });
  $('stop').addEventListener('click', () => robot.stop());
  $('reveal').addEventListener('change', (e) => { reveal = e.target.checked; });
  $('strategy').addEventListener('change', (e) => { strategy = e.target.value; robot.strategy = strategy; });
  $('reset').addEventListener('click', () => newHouse(seed));
  $('activity').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    activity = Number(b.dataset.activity);
    household.activity = activity;
    for (const x of $('activity').querySelectorAll('button')) x.setAttribute('aria-pressed', String(x === b));
  });
  $('memory').addEventListener('change', (e) => { memory = e.target.value; robot.memory = memory; });
  $('eyesight').addEventListener('change', (e) => { eyesight = e.target.value; robot.eyesight = eyesight; });
  $('new').addEventListener('click', () => newHouse(1 + Math.floor(Math.random() * 99999)));
  window.addEventListener('hashchange', () => {
    const s = seedFromHash();
    if (s && s !== seed) newHouse(s);
  });
  const inspect = (e) => {
    const r = canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * house.W);
    const y = Math.floor(((e.clientY - r.top) / r.height) * house.H);
    hover = { x, y };
    $('hover-info').textContent = describeCell(x, y);
  };
  canvas.addEventListener('mousemove', inspect);
  canvas.addEventListener('click', inspect);
  canvas.addEventListener('mouseleave', () => { hover = null; });
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  const themeObserver = new MutationObserver(() => { colors = readColors(document.documentElement); });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { colors = readColors(document.documentElement); });

  // Benchmark table, from the committed results file.
  fetch('./bench/results.json').then((r) => r.json()).then((data) => {
    const where = { housekeep: 'Where people leave things', procthor: 'In the rooms they belong', random: 'Anywhere' };
    const hint = { naive: 'None', procthor: 'Common sense', housekeep: 'Human data' };
    const ci = (v) => (v ? `${v.diff > 0 ? '+' : ''}${v.diff.toFixed(1)} (${v.lo.toFixed(1)} to ${v.hi.toFixed(1)})` : '');
    $('bench').innerHTML = data.results.map((r) => `<tr class="${r.vsNone && r.vsNone.hi < 0 ? 'win' : ''}">
      <td>${where[r.placement]}</td><td>${hint[r.strategy]}</td>
      <td>${r.meanSteps.toFixed(0)}</td><td>${ci(r.vsNone)}</td></tr>`).join('');
  }).catch(() => { $('bench').innerHTML = '<tr><td colspan="4">Results file not found.</td></tr>'; });
  fetch('./bench/dynamic.json').then((r) => r.json()).then((data) => {
    $('bench2').innerHTML = data.results.map((r) => `<tr class="${r.memory === 'fresh' ? 'win' : ''}">
      <td>${r.label}</td><td>${r.memory === 'fresh' ? 'Re-checks' : 'Trusts memory'}</td>
      <td>${(r.success * 100).toFixed(0)}%</td><td>${(r.falseMissing * 100).toFixed(0)}%</td><td>${r.meanSteps.toFixed(0)}</td></tr>`).join('');
  }).catch(() => { $('bench2').innerHTML = '<tr><td colspan="5">Results file not found.</td></tr>'; });

  newHouse(seedFromHash() ?? 1 + Math.floor(Math.random() * 99999));
  resize();
  document.fonts?.ready.then(() => { colors = readColors(document.documentElement); });
  const params = new URLSearchParams(location.search);
  if (params.get('speed')) speed = Number(params.get('speed'));
  if (params.get('reveal')) { reveal = true; $('reveal').checked = true; }
  if (params.get('activity')) {
    activity = Number(params.get('activity')); household.activity = activity;
    for (const x of $('activity').querySelectorAll('button')) x.setAttribute('aria-pressed', String(Number(x.dataset.activity) === activity));
  }
  const demo = params.get('demo');
  if (demo) setTimeout(() => send(demo), 600);
  requestAnimationFrame(frame);
}
