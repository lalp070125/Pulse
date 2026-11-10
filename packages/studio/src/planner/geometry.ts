import { nodesOf, read, type Project } from '@pulso/core';

/* ----------------------------------------------------------------------------
 * Where things are drawn: sizes (from tokens.css), default places for machine
 * boxes and states, and the orthogonal wire router (SPEC 6.3). Pure geometry.
 * -------------------------------------------------------------------------- */

function cssPx(name: string, fallback: number): number {
  if (typeof document === 'undefined') return fallback;
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  return Number.isFinite(v) ? v : fallback;
}

/** Canvas sizes in px, read once from tokens.css. */
export const G = {
  grid: cssPx('--planner-grid', 20),
  stateW: cssPx('--state-w', 190),
  stateH: cssPx('--state-h', 110),
  head: cssPx('--machine-head-h', 32),
  blockRow: cssPx('--block-row-h', 84),
  blockW: cssPx('--block-w', 128),
  lane: cssPx('--wire-lane', 14),
  init: 28,
  /** Room on each side of a box for the lanes of back wires and abort wires. */
  gutter: 64,
  boxGap: 80,
};

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  collapsed: boolean;
}

type Entry = Project['machines'][number];
export interface Pt {
  x: number;
  y: number;
}

const snap = (v: number) => Math.round(v / G.grid) * G.grid;

/** Where a state with no saved position goes: columns of four, top to bottom, so a first draft flows down. */
export function defaultPos(index: number): Pt {
  return {
    x: G.gutter + Math.floor(index / 4) * (G.stateW + 80),
    y: G.head + 80 + (index % 4) * (G.stateH + 70),
  };
}

/** Positions of all state nodes of one machine, relative to its box. */
export function positionsOf(entry: Entry): Map<string, Pt> {
  const saved = new Map(entry.plan.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
  const out = new Map<string, Pt>();
  nodesOf(entry).forEach((n, i) => out.set(n.id, saved.get(n.id) ?? defaultPos(i)));
  return out;
}

/** The size a box needs to hold its states, the lanes on both sides and the block row. */
function fit(entry: Entry): { w: number; h: number } {
  let w = 2 * G.gutter + 2 * (G.stateW + 60) + G.stateW;
  let h = G.head + 80 + G.stateH + 70 + G.blockRow;
  for (const p of positionsOf(entry).values()) {
    w = Math.max(w, p.x + G.stateW + G.gutter);
    h = Math.max(h, p.y + G.stateH + 60 + G.blockRow);
  }
  const blocks = blockCount(entry);
  w = Math.max(w, G.gutter + blocks * (G.blockW + 12) + G.gutter);
  return { w: snap(w + G.grid / 2), h: snap(h + G.grid / 2) };
}

/** Number of block chips at the bottom of a box (aborts, interrupt pairs, or the unassigned ones). */
export function blockCount(entry: Entry): number {
  const d = read(entry);
  return Math.max(1, d.aborts.length) + 2 * Math.max(1, d.interrupts.length);
}

/** Every machine's box: the saved one, or placed left to right. */
export function boxesOf(project: Project): Map<string, Box> {
  const out = new Map<string, Box>();
  let x = 0;
  for (const entry of project.machines) {
    const saved = entry.plan.box;
    const size = fit(entry);
    const box: Box = saved
      ? {
          x: saved.x,
          y: saved.y,
          w: saved.w,
          h: saved.h,
          collapsed: saved.collapsed ?? false,
        }
      : { x, y: 0, w: size.w, h: size.h, collapsed: false };
    out.set(entry.machine.id, box);
    x = Math.max(x, box.x + box.w + G.boxGap);
  }
  return out;
}

/** The box size that holds everything inside (used as the minimum when resizing). */
export function minBoxSize(entry: Entry): { w: number; h: number } {
  let w = G.gutter * 2 + G.stateW;
  let h = G.head + 60 + G.blockRow;
  for (const p of positionsOf(entry).values()) {
    w = Math.max(w, p.x + G.stateW + G.lane * 2);
    h = Math.max(h, p.y + G.stateH + G.blockRow);
  }
  w = Math.max(w, G.gutter + blockCount(entry) * (G.blockW + 12));
  return { w, h };
}

/* --- the orthogonal router ------------------------------------------------------------ */

/** An SVG path through the points with rounded corners. */
export function roundedPath(points: Pt[], r = 6): string {
  const pts = points.filter(
    (p, i) => i === 0 || p.x !== points[i - 1]!.x || p.y !== points[i - 1]!.y,
  );
  if (pts.length < 2) return '';
  let d = `M ${pts[0]!.x} ${pts[0]!.y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const c = pts[i + 1]!;
    const d1 = Math.hypot(b.x - a.x, b.y - a.y);
    const d2 = Math.hypot(c.x - b.x, c.y - b.y);
    const k = Math.min(r, d1 / 2, d2 / 2);
    const p1 = { x: b.x - ((b.x - a.x) / d1) * k, y: b.y - ((b.y - a.y) / d1) * k };
    const p2 = { x: b.x + ((c.x - b.x) / d2) * k, y: b.y + ((c.y - b.y) / d2) * k };
    d += ` L ${p1.x} ${p1.y} Q ${b.x} ${b.y} ${p2.x} ${p2.y}`;
  }
  const last = pts[pts.length - 1]!;
  return `${d} L ${last.x} ${last.y}`;
}

/**
 * A wire from an output port (bottom of a state) to an input port (top of a state).
 * Forward wires drop, run across and drop again. Back wires (to a state above) go out to
 * their own lane at the side of the machine box and come back in from the top, so a loop
 * never cuts through a state.
 */
export function routeWire(out: Pt, inp: Pt, laneX: number): { points: Pt[]; back: boolean } {
  if (inp.y > out.y + 2 * G.grid) {
    const mid = snap((out.y + inp.y) / 2);
    return { points: [out, { x: out.x, y: mid }, { x: inp.x, y: mid }, inp], back: false };
  }
  const below = out.y + G.grid;
  const above = inp.y - G.grid;
  return {
    points: [
      out,
      { x: out.x, y: below },
      { x: laneX, y: below },
      { x: laneX, y: above },
      { x: inp.x, y: above },
      inp,
    ],
    back: true,
  };
}

/** A wire that starts at the top of a block in the bottom row and climbs a side lane to its target. */
export function routeUp(from: Pt, inp: Pt, laneX: number): Pt[] {
  const up = from.y - G.grid / 2;
  const above = inp.y - G.grid;
  return [
    from,
    { x: from.x, y: up },
    { x: laneX, y: up },
    { x: laneX, y: above },
    { x: inp.x, y: above },
    inp,
  ];
}

/** A wire through a drawing-only junction: source → junction, then junction → target. */
export function routeVia(out: Pt, j: Pt, inp: Pt): Pt[] {
  // Leave the source downwards, run across just below it, then straight to the junction.
  const below = out.y + G.grid;
  const above = inp.y - G.grid;
  return [
    out,
    { x: out.x, y: below },
    { x: j.x, y: below },
    j,
    { x: j.x, y: above },
    { x: inp.x, y: above },
    inp,
  ];
}

/** The middle of the longest straight piece, where a condition label sits, and which way it runs. */
export function labelPoint(points: Pt[]): Pt & { vertical: boolean } {
  let best = { len: -1, at: points[0] ?? { x: 0, y: 0 }, vertical: true };
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const len = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    if (len > best.len) {
      best = { len, at: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, vertical: a.x === b.x };
    }
  }
  return { ...best.at, vertical: best.vertical };
}

/** Spreads n port positions around the centre of an edge, `step` px apart. */
export function spread(i: number, n: number, step = 24): number {
  return (i - (n - 1) / 2) * step;
}
