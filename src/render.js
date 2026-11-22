// Draws the house as an architect's floor plan: solid walls, plan symbols for
// furniture, and a hatched wash over everything the robot hasn't seen yet.

import { WALL } from './house.js';
import { UNKNOWN, K_CLOSED, K_CLUTTER } from './robot.js';

const ROOM_VAR = {
  'living room': '--r-living', kitchen: '--r-kitchen', bedroom: '--r-bedroom',
  bathroom: '--r-bath', office: '--r-office', 'dining room': '--r-dining', 'laundry room': '--r-laundry',
};

let hatchCache = { key: null, pattern: null };
function hatch(ctx, fog, line, cs) {
  const key = fog + line + Math.round(cs);
  if (hatchCache.key === key) return hatchCache.pattern;
  const s = Math.max(6, Math.round(cs / 2.5));
  const c = (typeof OffscreenCanvas !== 'undefined') ? new OffscreenCanvas(s, s) : Object.assign(document.createElement('canvas'), { width: s, height: s });
  const g = c.getContext('2d');
  g.fillStyle = fog; g.fillRect(0, 0, s, s);
  g.strokeStyle = line; g.lineWidth = 1;
  g.beginPath(); g.moveTo(0, s); g.lineTo(s, 0); g.moveTo(-1, 1); g.lineTo(1, -1); g.moveTo(s - 1, s + 1); g.lineTo(s + 1, s - 1); g.stroke();
  hatchCache = { key, pattern: ctx.createPattern(c, 'repeat') };
  return hatchCache.pattern;
}

// CSS custom properties come back unresolved (e.g. "light-dark(#fff, #000)"),
// so resolve each one through a hidden probe element's computed colour.
let probe = null;
export function readColors(el) {
  if (!probe) {
    probe = document.createElement('span');
    probe.style.display = 'none';
    (document.body ?? el).appendChild(probe);
  }
  const v = (n) => { probe.style.color = `var(${n})`; return getComputedStyle(probe).color; };
  const rooms = Object.fromEntries(Object.entries(ROOM_VAR).map(([k, n]) => [k, v(n)]));
  return {
    paper: v('--paper'), wall: v('--wall'), line: v('--line'), fog: v('--fog'), fogLine: v('--fog-line'),
    ink: v('--ink'), soft: v('--soft'), accent: v('--accent'), accentInk: v('--accent-ink'), err: v('--err'), rooms,
  };
}

// Plan symbol for one piece of furniture, centred in its cell.
function symbol(g, name, x, y, cs, col) {
  const p = cs * 0.14, w = cs - 2 * p;
  const X = x + p, Y = y + p;
  g.save();
  g.strokeStyle = col.ink; g.fillStyle = col.paper; g.lineWidth = Math.max(1, cs / 18);
  const rect = (a, b, c, d, r = 0) => { g.beginPath(); g.roundRect(a, b, c, d, r); g.fill(); g.stroke(); };
  const circ = (a, b, r) => { g.beginPath(); g.arc(a, b, r, 0, Math.PI * 2); g.fill(); g.stroke(); };
  const line = (a, b, c, d) => { g.beginPath(); g.moveTo(a, b); g.lineTo(c, d); g.stroke(); };
  const cx = x + cs / 2, cy = y + cs / 2;
  switch (name) {
    case 'bed': rect(X, Y, w, w, 2); rect(X + w * 0.15, Y + w * 0.08, w * 0.7, w * 0.22, 2); line(X, Y + w * 0.42, X + w, Y + w * 0.42); break;
    case 'sofa': g.beginPath(); g.moveTo(X, Y + w * 0.2); g.lineTo(X, Y + w); g.lineTo(X + w, Y + w); g.lineTo(X + w, Y + w * 0.2); g.lineTo(X + w * 0.8, Y + w * 0.2); g.lineTo(X + w * 0.8, Y + w * 0.75); g.lineTo(X + w * 0.2, Y + w * 0.75); g.lineTo(X + w * 0.2, Y + w * 0.2); g.closePath(); g.fill(); g.stroke(); break;
    case 'bookshelf': rect(X, Y + w * 0.2, w, w * 0.6); for (let i = 1; i < 4; i++) line(X + (w * i) / 4, Y + w * 0.2, X + (w * i) / 4, Y + w * 0.8); break;
    case 'coffee table': rect(X + w * 0.1, Y + w * 0.25, w * 0.8, w * 0.5, w * 0.2); break;
    case 'dining table': circ(cx, cy, w * 0.42); break;
    case 'desk': rect(X, Y, w, w * 0.55); circ(cx, Y + w * 0.82, w * 0.16); break;
    case 'nightstand': rect(X + w * 0.2, Y + w * 0.2, w * 0.6, w * 0.6); line(X + w * 0.2, cy, X + w * 0.8, cy); break;
    case 'counter': rect(X, Y, w, w); line(X, Y + w, X + w, Y); line(X, Y + w * 0.5, X + w * 0.5, Y); line(X + w * 0.5, Y + w, X + w, Y + w * 0.5); break;
    case 'sink': rect(X, Y, w, w, 2); circ(cx, cy, w * 0.28); break;
    case 'basin': rect(X + w * 0.1, Y + w * 0.1, w * 0.8, w * 0.8, w * 0.4); circ(cx, cy, w * 0.12); break;
    case 'fridge': rect(X, Y, w, w); line(X, Y + w * 0.35, X + w, Y + w * 0.35); break;
    case 'bathtub': rect(X, Y, w, w, w * 0.15); rect(X + w * 0.15, Y + w * 0.15, w * 0.7, w * 0.7, w * 0.3); break;
    case 'towel rack': line(X, Y + w * 0.2, X + w, Y + w * 0.2); rect(X + w * 0.2, Y + w * 0.2, w * 0.6, w * 0.6); break;
    case 'wardrobe': rect(X, Y, w, w); line(cx, Y, cx, Y + w); break;
    case 'washing machine': rect(X, Y, w, w, 2); circ(cx, cy + w * 0.06, w * 0.3); break;
    case 'laundry basket': circ(cx, cy, w * 0.42); line(cx - w * 0.3, cy - w * 0.3, cx + w * 0.3, cy + w * 0.3); line(cx - w * 0.3, cy + w * 0.3, cx + w * 0.3, cy - w * 0.3); break;
    default: rect(X, Y, w, w);
  }
  g.restore();
}

function doorSwing(g, x, y, cs, col) {
  // Quarter-circle swing, the way doors are drawn on a plan.
  g.save();
  g.strokeStyle = col.soft; g.lineWidth = 1;
  g.beginPath(); g.moveTo(x * cs, y * cs); g.arc(x * cs, y * cs, cs, 0, Math.PI / 2); g.closePath(); g.stroke();
  g.restore();
}

export function draw(ctx, cs, house, robot, opts = {}) {
  const col = opts.colors;
  const { W, H } = house;
  const reveal = !!opts.reveal;
  const seen = (i) => robot.known[i] !== UNKNOWN;
  ctx.fillStyle = col.paper;
  ctx.fillRect(0, 0, W * cs, H * cs);

  // Floors (room tints)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = house.idx(x, y);
    if (house.cells[i] === WALL) continue;
    if (!seen(i) && !reveal) continue;
    const rid = house.roomId[i];
    ctx.globalAlpha = seen(i) ? 1 : 0.45;
    ctx.fillStyle = rid >= 0 ? col.rooms[house.rooms[rid].type] : col.paper;
    ctx.fillRect(x * cs, y * cs, cs + 0.5, cs + 0.5);
  }
  ctx.globalAlpha = 1;

  // Faint drafting grid on known floor
  ctx.strokeStyle = col.line; ctx.lineWidth = 1; ctx.beginPath();
  for (let x = 0; x <= W; x++) { ctx.moveTo(x * cs + 0.5, 0); ctx.lineTo(x * cs + 0.5, H * cs); }
  for (let y = 0; y <= H; y++) { ctx.moveTo(0, y * cs + 0.5); ctx.lineTo(W * cs, y * cs + 0.5); }
  ctx.stroke();

  // Fog over everything unseen
  const pat = hatch(ctx, col.fog, col.fogLine, cs);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = house.idx(x, y);
    if (seen(i)) continue;
    if (reveal && house.cells[i] !== WALL) {
      ctx.globalAlpha = 0.35; ctx.fillStyle = pat; ctx.fillRect(x * cs, y * cs, cs + 0.5, cs + 0.5); ctx.globalAlpha = 1;
    } else if (!reveal) { ctx.fillStyle = pat; ctx.fillRect(x * cs, y * cs, cs + 0.5, cs + 0.5); }
  }

  // Memory fading: places the robot hasn't looked at for a while get hatched
  // back in gradually (only matters when someone else lives here).
  if (opts.fade) {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = house.idx(x, y);
      if (!seen(i) || robot.visible.has(i) || house.cells[i] === WALL) continue;
      const age = robot.ticks - robot.lastSeen[i];
      if (age <= 20) continue;
      ctx.globalAlpha = Math.min(0.6, (age - 20) / 500);
      ctx.fillStyle = pat; ctx.fillRect(x * cs, y * cs, cs + 0.5, cs + 0.5);
    }
    ctx.globalAlpha = 1;
  }

  // Walls (solid poché)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = house.idx(x, y);
    if (house.cells[i] !== WALL) continue;
    if (!seen(i) && !reveal) continue;
    ctx.globalAlpha = seen(i) ? 1 : 0.4;
    ctx.fillStyle = col.wall;
    ctx.fillRect(x * cs, y * cs, cs + 0.5, cs + 0.5);
  }
  ctx.globalAlpha = 1;

  // Front door: gap in the outer wall
  const fd = house.frontDoor;
  ctx.fillStyle = col.accent;
  ctx.fillRect(fd.x * cs + cs * 0.15, fd.y * cs + cs * 0.15, cs * 0.7, cs * 0.7);

  // Doors: swing arc when open, a solid leaf when closed, red dot when locked.
  // Shows the truth for doors in view (or with reveal on), memory otherwise.
  const now = (i) => reveal || robot.visible.has(i);
  for (const d of house.doors) {
    const i = house.idx(d.x, d.y);
    if (!seen(i) && !reveal) continue;
    const closed = now(i) ? house.dyn.closed.has(i) : robot.known[i] === K_CLOSED;
    if (!closed) { doorSwing(ctx, d.x, d.y, cs, col); continue; }
    const vertical = house.cells[house.idx(d.x - 1, d.y)] !== WALL; // passage runs left-right
    ctx.fillStyle = col.ink;
    if (vertical) ctx.fillRect(d.x * cs + cs * 0.38, d.y * cs, cs * 0.24, cs + 0.5);
    else ctx.fillRect(d.x * cs, d.y * cs + cs * 0.38, cs + 0.5, cs * 0.24);
    const lockedKnown = (robot.lockedUntil.get(i) ?? -1) > robot.ticks;
    if (now(i) ? house.dyn.locked.has(i) : lockedKnown) {
      ctx.fillStyle = col.err;
      ctx.beginPath(); ctx.arc((d.x + 0.5) * cs, (d.y + 0.5) * cs, cs * 0.2, 0, Math.PI * 2); ctx.fill();
    }
  }

  // Clutter on the floor
  for (let i = 0; i < W * H; i++) {
    const truth = house.dyn.clutter.has(i);
    const show = now(i) ? truth : robot.known[i] === K_CLUTTER;
    if (!show) continue;
    const x = i % W, y = (i / W) | 0;
    ctx.globalAlpha = now(i) ? 1 : 0.5;
    ctx.strokeStyle = col.ink; ctx.fillStyle = col.fog; ctx.lineWidth = Math.max(1, cs / 16);
    const p = cs * 0.22;
    ctx.beginPath(); ctx.rect(x * cs + p, y * cs + p, cs - 2 * p, cs - 2 * p); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x * cs + p, y * cs + p); ctx.lineTo(x * cs + cs - p, y * cs + cs - p);
    ctx.moveTo(x * cs + cs - p, y * cs + p); ctx.lineTo(x * cs + p, y * cs + cs - p); ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Furniture
  for (const f of house.furniture) {
    const i = house.idx(f.x, f.y);
    if (!seen(i) && !reveal) continue;
    ctx.globalAlpha = seen(i) ? 1 : 0.5;
    symbol(ctx, f.name, f.x * cs, f.y * cs, cs, col);
  }
  ctx.globalAlpha = 1;

  // Room names
  const fontSize = Math.max(10, Math.round(cs * 0.56));
  ctx.font = `600 ${fontSize}px ${opts.font ?? 'sans-serif'}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const r of house.rooms) {
    if (!robot.seenRooms.has(r.id) && !reveal) continue;
    const label = r.type[0].toUpperCase() + r.type.slice(1);
    ctx.globalAlpha = robot.seenRooms.has(r.id) ? 0.75 : 0.35;
    ctx.fillStyle = col.ink;
    ctx.fillText(label, (r.x + r.w / 2) * cs, (r.y + r.h / 2) * cs);
  }
  ctx.globalAlpha = 1;

  // Trail and plan
  if (robot.trail.length > 1) {
    ctx.strokeStyle = col.accent; ctx.globalAlpha = 0.22; ctx.lineWidth = Math.max(2, cs / 7);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath();
    robot.trail.slice(-160).forEach(([x, y], k) => (k ? ctx.lineTo : ctx.moveTo).call(ctx, (x + 0.5) * cs, (y + 0.5) * cs));
    ctx.stroke(); ctx.globalAlpha = 1;
  }
  if (robot.busy && robot.plan.length) {
    ctx.strokeStyle = col.accent; ctx.lineWidth = Math.max(1.5, cs / 12); ctx.setLineDash([cs / 4, cs / 4]);
    ctx.beginPath(); ctx.moveTo((robot.x + 0.5) * cs, (robot.y + 0.5) * cs);
    for (const [x, y] of robot.plan) ctx.lineTo((x + 0.5) * cs, (y + 0.5) * cs);
    ctx.stroke(); ctx.setLineDash([]);
  }

  // Objects. Without reveal we draw what the robot believes (fading with age);
  // with reveal we draw the truth, plus hollow markers where the robot's
  // memory is now wrong.
  const objFont = Math.max(11, Math.round(cs * 0.5));
  ctx.font = `600 ${objFont}px ${opts.font ?? 'sans-serif'}`;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  const stack = new Map();
  const mark = (name, x, y, on, alpha, hollow) => {
    const i = house.idx(x, y);
    const k = stack.get(i) ?? 0; stack.set(i, k + 1);
    const px = (x + (on ? 0.92 : 0.5)) * cs;
    const py = (y + (on ? 0.12 : 0.5)) * cs - k * objFont * 1.05;
    ctx.globalAlpha = alpha;
    ctx.beginPath(); ctx.arc(px, py, cs * 0.17, 0, Math.PI * 2);
    if (hollow) { ctx.strokeStyle = col.err; ctx.lineWidth = 1.5; ctx.stroke(); } else { ctx.fillStyle = col.ink; ctx.fill(); }
    if (cs >= 14) {
      ctx.lineWidth = 3; ctx.strokeStyle = col.paper; ctx.fillStyle = hollow ? col.err : col.ink;
      const label = hollow ? `${name}?` : name;
      ctx.strokeText(label, px + cs * 0.3, py); ctx.fillText(label, px + cs * 0.3, py);
    }
  };
  if (reveal) {
    for (const o of house.objects) if (!o.carried) mark(o.name, o.x, o.y, o.on, 1, false);
    for (const [name, b] of robot.objects) {
      const o = house.objects.find((q) => q.name === name);
      if (o.carried || o.x !== b.x || o.y !== b.y) mark(name, b.x, b.y, b.on, 0.9, true);
    }
  } else {
    for (const [name, b] of robot.objects) {
      const age = robot.ticks - (b.t ?? 0);
      mark(name, b.x, b.y, b.on, opts.fade ? Math.max(0.35, 1 - age / 600) : 1, false);
    }
  }
  ctx.globalAlpha = 1;

  // The cat
  const cat = house.dyn.cat;
  if (cat && (reveal || robot.visible.has(house.idx(cat.x, cat.y)))) {
    const cx = (cat.x + 0.5) * cs, cy = (cat.y + 0.55) * cs, r = cs * 0.26;
    ctx.fillStyle = col.ink;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.95, cy - r * 0.2); ctx.lineTo(cx - r * 0.75, cy - r * 1.45); ctx.lineTo(cx - r * 0.15, cy - r * 0.85);
    ctx.moveTo(cx + r * 0.95, cy - r * 0.2); ctx.lineTo(cx + r * 0.75, cy - r * 1.45); ctx.lineTo(cx + r * 0.15, cy - r * 0.85);
    ctx.fill();
  }

  // Vision range and robot
  const rx = (robot.x + 0.5) * cs, ry = (robot.y + 0.5) * cs;
  ctx.fillStyle = col.accent; ctx.globalAlpha = 0.07;
  ctx.beginPath(); ctx.arc(rx, ry, (robot.radius + 0.5) * cs, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 0.35; ctx.strokeStyle = col.accent; ctx.lineWidth = 1; ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = col.accent; ctx.strokeStyle = col.paper; ctx.lineWidth = Math.max(2, cs / 9);
  ctx.beginPath(); ctx.arc(rx, ry, cs * 0.42, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = col.accentInk;
  ctx.beginPath(); ctx.arc(rx, ry, cs * 0.12, 0, Math.PI * 2); ctx.fill();
  if (robot.carrying && cs >= 14) {
    ctx.fillStyle = col.ink; ctx.lineWidth = 3; ctx.strokeStyle = col.paper;
    ctx.strokeText(robot.carrying, rx + cs * 0.55, ry - cs * 0.55);
    ctx.fillText(robot.carrying, rx + cs * 0.55, ry - cs * 0.55);
  }

  // Hover
  if (opts.hover) {
    ctx.strokeStyle = col.ink; ctx.lineWidth = 1.5;
    ctx.strokeRect(opts.hover.x * cs + 1, opts.hover.y * cs + 1, cs - 2, cs - 2);
  }
}
