// Browser front end: wires the simulator to the canvas and the controls.
import { generateHouse } from './house.js';
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

  let house, robot, seed;
  let strategy = 'semantic';
  let reveal = false;
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
    robot = new Robot(house, { strategy });
    logCount = 0;
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
      `Put the ${objs[0]} ${onOrIn(furn.name)} the ${furn.name}`,
      `Bring me the ${objs[1]}`,
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
    if (robot.busy) {
      acc += (dt * speed) / 1000;
      let n = 0;
      while (acc >= 1 && n < 40) { robot.tick(); acc -= 1; n++; if (!robot.busy) { acc = 0; break; } }
    } else acc = 0;

    const cs = canvas.width / house.W;
    draw(ctx, cs, house, robot, { colors, reveal, hover, font: FONT });
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
    const parts = [];
    const room = house.roomTypeAt(x, y);
    parts.push(room ? room[0].toUpperCase() + room.slice(1) : 'Doorway');
    const f = house.furnAt.get(i);
    if (f) parts.push(f);
    const objs = house.objectsAt(x, y).map((o) => o.name);
    if (objs.length) parts.push(objs.join(', '));
    if (x === robot.x && y === robot.y) parts.push('the robot');
    if (x === house.start.x && y === house.start.y) parts.push('front door');
    return parts.join(' · ') + (known ? '' : ' (robot hasn’t seen this)');
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
    const label = { 0: 'At random', 0.65: 'Usually somewhere typical', 0.9: 'Almost always typical' };
    const best = {};
    for (const r of data.results) if (!best[r.prior] || r.spl > best[r.prior].spl) best[r.prior] = r;
    $('bench').innerHTML = data.results.map((r) => `<tr class="${best[r.prior] === r ? 'win' : ''}">
      <td>${label[r.prior] ?? r.prior}</td><td>${r.strategy === 'semantic' ? 'Room hints' : 'Nearest gap'}</td>
      <td>${(r.success * 100).toFixed(0)}%</td><td>${r.spl.toFixed(3)}</td><td>${r.meanSteps.toFixed(0)}</td></tr>`).join('');
  }).catch(() => { $('bench').innerHTML = '<tr><td colspan="5">Results file not found.</td></tr>'; });

  newHouse(seedFromHash() ?? 1 + Math.floor(Math.random() * 99999));
  resize();
  document.fonts?.ready.then(() => { colors = readColors(document.documentElement); });
  const params = new URLSearchParams(location.search);
  if (params.get('speed')) speed = Number(params.get('speed'));
  if (params.get('reveal')) { reveal = true; $('reveal').checked = true; }
  const demo = params.get('demo');
  if (demo) setTimeout(() => send(demo), 600);
  requestAnimationFrame(frame);
}
