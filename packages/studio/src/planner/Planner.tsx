import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  Background,
  BackgroundVariant,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
  useViewport,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  Expand,
  Map as MapIcon,
  Maximize,
  Shrink,
  Plus,
  Redo2,
  Save,
  Square,
  Trash2,
  Undo2,
  Workflow,
} from 'lucide-react';
import {
  NameSchema,
  actionText,
  addAbort,
  addInterrupt,
  addJunction,
  addNode,
  condLabel,
  connect,
  construct,
  copyNodes,
  deleteBlocks,
  deleteJunctions,
  deleteNodes,
  deleteWires,
  entryOf,
  freeNodeName,
  hasPlaceholders,
  isConstructed,
  moveJunction,
  moveNode,
  nodesOf,
  pasteNodes,
  read,
  renumber,
  setAbortTarget,
  setInit,
  type BlockSlot,
  type JunctionKind,
  type LiveMachine,
  type Project,
} from '@pulso/core';
import { newId } from '../lib/ulid';
import { askText } from '../state/dialogs';
import { askDelete, blankEntity, nameError, openEditor } from '../state/entities';
import { useProject } from '../state/project';
import { useShell } from '../state/store';
import { ConditionChooser } from './ConditionChooser';
import { HoldActionsDialog } from './HoldActionsDialog';
import {
  G,
  boxesOf,
  defaultPos,
  labelPoint,
  minBoxSize,
  positionsOf,
  routeUp,
  routeVia,
  routeWire,
  spread,
  type Box,
  type Pt,
} from './geometry';
import {
  PlannerCtx,
  edgeTypes,
  nodeTypes,
  type BlockData,
  type PlannerActions,
  type WireData,
} from './parts';
import { usePlanner } from './store';
import { lastCondition, useLive, type CondResult, type LastTransition } from '../state/live';
import { useMonitor } from '../monitor/store';
import './planner.css';

/* ----------------------------------------------------------------------------
 * The Planner canvas (SPEC 6.3): the state machines of every machine, drawn and
 * edited. It holds no copy of the logic: every node and wire is drawn from the
 * open project, and every change goes through the Planner model in core.
 * -------------------------------------------------------------------------- */

const ICON = { size: 14, strokeWidth: 1.5 } as const;
type Entry = Project['machines'][number];

const machineNodeId = (m: string) => `m:${m}`;
const blockNodeId = (slot: BlockSlot, machine: string, block: string | null) =>
  `b:${slot}:${block ?? `new-${machine}`}`;
const INIT_W = 52;
/** A touch screen (finger, not mouse): bigger targets, a wider snap for wire ends. */
const TOUCH = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

/* --- building the drawing from the project --------------------------------------------- */

function buildNodes(project: Project): Node[] {
  const boxes = boxesOf(project);
  const out: Node[] = [];
  for (const entry of project.machines) {
    const m = entry.machine;
    const box = boxes.get(m.id)!;
    const min = minBoxSize(entry);
    const todo = countTodo(entry);
    out.push({
      id: machineNodeId(m.id),
      type: 'machine',
      position: { x: box.x, y: box.y },
      style: { width: box.w, height: box.collapsed ? G.head : box.h },
      dragHandle: '.pl-machine-head',
      data: {
        machine: m.id,
        name: m.name,
        collapsed: box.collapsed,
        minW: min.w,
        minH: min.h,
        todo,
      },
      zIndex: 0,
    });
    if (box.collapsed) continue;
    const parentId = machineNodeId(m.id);
    out.push({
      id: `init:${m.id}`,
      type: 'init',
      parentId,
      position: { x: box.w / 2 - INIT_W / 2, y: G.head + 12 },
      draggable: false,
      deletable: false,
      selectable: false,
      data: { machine: m.id, name: m.name },
    });
    const pos = positionsOf(entry);
    for (const n of nodesOf(entry)) {
      const tpl = n.template ? project.states.find((t) => t.id === n.template) : undefined;
      out.push({
        id: n.id,
        type: 'state',
        parentId,
        extent: 'parent',
        position: pos.get(n.id)!,
        data: {
          machine: m.id,
          name: n.name,
          placeholder: n.template === null,
          entry: tpl ? tpl.onEntry.map((a) => actionText(project, tpl.roles, a)) : [],
        },
      });
    }
    // The block row: each abort, each interrupt as a Trig + Resume pair; one unassigned of each when none.
    const d = read(entry);
    const blocks: BlockData[] = [];
    const label = (c: (typeof d.aborts)[number]['condition']) => condLabel(project, entry, c);
    const aborts = d.aborts.length ? d.aborts : [null];
    aborts.forEach((a, i) =>
      blocks.push({
        machine: m.id,
        machineName: m.name,
        slot: 'abort',
        block: a?.id ?? null,
        label: a ? label(a.condition) : null,
        placeholder: a?.condition?.kind === 'placeholder',
        hold: 0,
        index: i + 1,
      }),
    );
    const ints = d.interrupts.length ? d.interrupts : [null];
    ints.forEach((it, i) => {
      for (const slot of ['trigger', 'resume'] as const) {
        blocks.push({
          machine: m.id,
          machineName: m.name,
          slot,
          block: it?.id ?? null,
          label: it ? label(it[slot]) : null,
          placeholder: it?.[slot]?.kind === 'placeholder',
          hold: it?.onHold.length ?? 0,
          index: i + 1,
        });
      }
    });
    blocks.forEach((b, k) =>
      out.push({
        id: blockNodeId(b.slot, m.id, b.block),
        type: 'block',
        parentId,
        position: { x: G.gutter + k * (G.blockW + 12), y: box.h - G.blockRow + 6 },
        draggable: false,
        data: b,
      }),
    );
    for (const j of entry.plan.junctions ?? []) {
      out.push({
        id: `j:${j.id}`,
        type: 'junction',
        parentId,
        extent: 'parent',
        position: { x: j.x, y: j.y },
        data: { kind: j.kind },
      });
    }
  }
  return out;
}

/** Placeholders shown on a machine header as "n to build". */
function countTodo(entry: Entry): number {
  const p = entry.plan.placeholders;
  if (!p) return 0;
  const named = (c: { kind: string } | null) => c?.kind === 'placeholder';
  return (
    p.states.length +
    new Set([
      ...p.transitions
        .filter((w) => named(w.condition))
        .map((w) => w.condition!.kind === 'placeholder' && w.condition!.name),
      ...p.aborts
        .filter((a) => named(a.condition))
        .map((a) => a.condition!.kind === 'placeholder' && a.condition!.name),
      ...p.interrupts
        .flatMap((i) => [i.trigger, i.resume])
        .filter(named)
        .map((c) => c!.kind === 'placeholder' && c!.name),
    ]).size
  );
}

/** The wires, drawn from the project and the current (possibly mid-drag) node positions. */
function buildEdges(project: Project, nodes: Node[], selected: Set<string>): Edge<WireData>[] {
  const abs = new Map<string, Pt>();
  const size = new Map<string, { w: number; h: number }>();
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes) {
    const parent = n.parentId ? byId.get(n.parentId) : undefined;
    abs.set(n.id, {
      x: n.position.x + (parent?.position.x ?? 0),
      y: n.position.y + (parent?.position.y ?? 0),
    });
    const w = n.measured?.width ?? (n.type === 'state' ? G.stateW : 0);
    const h = n.measured?.height ?? (n.type === 'state' ? G.stateH : 0);
    size.set(n.id, { w, h });
  }
  const edges: Edge<WireData>[] = [];
  for (const entry of project.machines) {
    const m = entry.machine;
    const boxNode = byId.get(machineNodeId(m.id));
    if (!boxNode || !byId.has(`init:${m.id}`)) continue; // collapsed
    const box = { ...abs.get(boxNode.id)!, w: Number(boxNode.style?.width ?? 0) };
    const d = read(entry);
    const names = new Map(nodesOf(entry).map((n) => [n.id, n.name]));
    const nodeSize = (id: string) => size.get(id) ?? { w: G.stateW, h: G.stateH };

    // Ports: wires leaving a state spread along its bottom edge in priority order;
    // everything arriving at a state spreads along its top edge.
    const outgoing = new Map<string, string[]>();
    for (const w of [...d.wires].sort((a, b) => a.priority - b.priority)) {
      outgoing.set(w.from, [...(outgoing.get(w.from) ?? []), w.id]);
    }
    const incoming = new Map<string, string[]>();
    const arrive = (to: string, key: string) =>
      incoming.set(to, [...(incoming.get(to) ?? []), key]);
    if (d.initial) arrive(d.initial, `init:${m.id}`);
    for (const w of d.wires) arrive(w.to, w.id);
    for (const a of d.aborts) if (a.to) arrive(a.to, `abort:${a.id}`);
    const outPort = (from: string, key: string): Pt => {
      const list = outgoing.get(from) ?? [key];
      const p = abs.get(from)!;
      const s = nodeSize(from);
      return { x: p.x + s.w / 2 + spread(list.indexOf(key), list.length), y: p.y + s.h };
    };
    const inPort = (to: string, key: string): Pt => {
      const list = incoming.get(to) ?? [key];
      const p = abs.get(to)!;
      return { x: p.x + nodeSize(to).w / 2 + spread(list.indexOf(key), list.length), y: p.y };
    };
    let rightLane = 0;
    let leftLane = 0;
    const rightLaneX = () => box.x + box.w - G.lane - rightLane++ * G.lane;
    const leftLaneX = () => box.x + G.lane + leftLane++ * G.lane;

    // Init → first state.
    if (d.initial && abs.has(d.initial)) {
      const ip = abs.get(`init:${m.id}`)!;
      const is = size.get(`init:${m.id}`) ?? { w: INIT_W, h: 24 };
      const from = { x: ip.x + is.w / 2, y: ip.y + is.h };
      const r = routeWire(from, inPort(d.initial, `init:${m.id}`), rightLaneX());
      edges.push({
        id: `e-init:${m.id}`,
        source: `init:${m.id}`,
        target: d.initial,
        sourceHandle: 'out',
        targetHandle: 'in',
        type: 'wire',
        selected: selected.has(`e-init:${m.id}`),
        data: {
          kind: 'init',
          machine: m.id,
          points: r.points,
          back: r.back,
          ends: `Init-${names.get(d.initial)}`,
        },
      });
    }

    const junctionOf = new Map<string, Pt>();
    for (const j of entry.plan.junctions ?? []) {
      const p = abs.get(`j:${j.id}`);
      const s = size.get(`j:${j.id}`) ?? { w: 0, h: 0 };
      if (p) for (const w of j.wires) junctionOf.set(w, { x: p.x + s.w / 2, y: p.y + s.h / 2 });
    }
    for (const w of d.wires) {
      if (!abs.has(w.from) || !abs.has(w.to)) continue;
      const out = outPort(w.from, w.id);
      const inp = inPort(w.to, w.id);
      const j = junctionOf.get(w.id);
      const r = j ? { points: routeVia(out, j, inp), back: false } : routeWire(out, inp, 0);
      if (r.back) r.points = routeWire(out, inp, rightLaneX()).points;
      const label = condLabel(project, entry, w.condition);
      const ends = `${names.get(w.from)}-${names.get(w.to)}`;
      edges.push({
        id: w.id,
        source: w.from,
        target: w.to,
        sourceHandle: 'out',
        targetHandle: 'in',
        type: 'wire',
        selected: selected.has(w.id),
        data: {
          kind: 'wire',
          machine: m.id,
          wire: w.id,
          points: r.points,
          back: r.back,
          priority: w.priority,
          label,
          placeholder: w.condition?.kind === 'placeholder',
          ends,
        },
      });
    }
    for (const a of d.aborts) {
      const bid = blockNodeId('abort', m.id, a.id);
      if (!a.to || !abs.has(a.to) || !abs.has(bid)) continue;
      const bp = abs.get(bid)!;
      const bs = size.get(bid) ?? { w: G.blockW, h: 40 };
      // The wire leaves from the top of the block itself, below its condition slot.
      const from = { x: bp.x + bs.w / 2, y: bp.y + bs.h - 26 };
      edges.push({
        id: `e-abort:${a.id}`,
        source: bid,
        target: a.to,
        sourceHandle: 'out',
        targetHandle: 'in',
        type: 'wire',
        selected: selected.has(`e-abort:${a.id}`),
        data: {
          kind: 'abort',
          machine: m.id,
          points: routeUp(from, inPort(a.to, `abort:${a.id}`), leftLaneX()),
          back: true,
          ends: `Abort-${names.get(a.to)}`,
        },
      });
    }
  }
  return edges;
}

/** Which machine a canvas node belongs to. */
function machineOfNode(n: Node | undefined): string | null {
  if (!n) return null;
  if (n.id.startsWith('m:')) return n.id.slice(2);
  const data = n.data as { machine?: string };
  return data.machine ?? (n.parentId?.startsWith('m:') ? n.parentId.slice(2) : null);
}

/* --- the canvas -------------------------------------------------------------------------- */

/** The canvas. `live`: read-only, lit by the running machines (Monitor, SPEC 7.1). */
export function Canvas({ live = false }: { live?: boolean }) {
  const project = useProject((s) => s.project)!;
  const flow = useReactFlow();
  const focus = usePlanner((s) => s.focus);
  const [nodes, setNodes] = useState<Node[]>(() => buildNodes(project));
  const [selectedEdges, setSelectedEdges] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ x: number; y: number; machine: string } | null>(null);
  const [minimap, setMinimap] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  // Redraw from the project whenever it changes, keeping what is selected.
  useEffect(() => {
    setNodes((prev) => {
      const sel = new Set(prev.filter((n) => n.selected).map((n) => n.id));
      const measured = new Map(prev.map((n) => [n.id, n.measured]));
      return buildNodes(project).map((n) => ({
        ...n,
        selected: sel.has(n.id),
        measured: measured.get(n.id) ?? n.measured,
      }));
    });
  }, [project]);

  const edges = useMemo(
    () => buildEdges(project, nodes, selectedEdges),
    [project, nodes, selectedEdges],
  );

  // Live mode: light the active states, tag held / faulted machines, flash the last
  // transition, and give every wire its condition's live term values.
  const liveMachines = useLive((s) => s.machines);
  const lastTransition = useLive((s) => s.lastTransition);
  const liveTick = useLive((s) => s.tick);
  const highlight = useMonitor((s) => s.highlight);
  const monFocus = useMonitor((s) => s.focus);
  const shownNodes = useMemo(
    () =>
      live ? decorateNodes(project, nodes, liveMachines, highlight, monFocus?.node ?? null) : nodes,
    [live, project, nodes, liveMachines, highlight, monFocus],
  );
  const shownEdges = useMemo(
    () => (live ? decorateEdges(project, edges, lastTransition) : edges),
    // liveTick: wire tooltips follow the newest condition results.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [live, project, edges, lastTransition, liveTick],
  );

  // Click-to-go from the Messages panel: show the item (or the whole machine) and select it.
  useEffect(() => {
    if (!focus) return;
    // A wire is shown by its source state.
    const entry = project.machines.find((e) => e.machine.id === focus.machine);
    const wire = entry && read(entry).wires.find((w) => w.id === focus.item);
    const item = wire ? wire.from : focus.item;
    const target = item && nodes.some((n) => n.id === item) ? item : machineNodeId(focus.machine);
    setNodes((prev) => prev.map((n) => ({ ...n, selected: n.id === target })));
    window.setTimeout(
      () =>
        void flow.fitView({ nodes: [{ id: target }], maxZoom: 1.2, duration: 200, padding: 0.4 }),
      50,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  const act = usePlanner((s) => s.act);

  // On a phone, a pinch on the canvas must zoom the drawing, not the whole page (Safari's own
  // gesture events and two-finger moves are stopped here; the canvas zooms itself).
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const stop = (e: Event) => e.preventDefault();
    const twoFingers = (e: TouchEvent) => {
      if (e.touches.length > 1) e.preventDefault();
    };
    for (const g of ['gesturestart', 'gesturechange', 'gestureend']) el.addEventListener(g, stop);
    el.addEventListener('touchmove', twoFingers, { passive: false });
    return () => {
      for (const g of ['gesturestart', 'gesturechange', 'gestureend'])
        el.removeEventListener(g, stop);
      el.removeEventListener('touchmove', twoFingers);
    };
  }, []);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    // Removal is handled by deleteSelected (it knows what each thing is); everything else is local until drop.
    setNodes((prev) =>
      applyNodeChanges(
        changes.filter((c) => c.type !== 'remove'),
        prev,
      ),
    );
    for (const c of changes) {
      if (c.type === 'select' && c.selected) {
        const n = nodesRef.current.find((x) => x.id === c.id);
        const m = machineOfNode(n);
        if (m) usePlanner.getState().setMachine(m);
      }
    }
  }, []);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setSelectedEdges((prev) => {
      const next = new Set(prev);
      for (const c of changes) {
        if (c.type === 'select') {
          if (c.selected) next.add(c.id);
          else next.delete(c.id);
        }
      }
      return next;
    });
  }, []);

  const onDragStop = useCallback(
    (_: unknown, __: Node, dragged: Node[]) => {
      const snap = (v: number) => Math.round(v / G.grid) * G.grid;
      act((draft) => {
        const boxes = boxesOf(draft);
        for (const n of dragged) {
          const m = machineOfNode(n);
          if (!m) continue;
          const entry = entryOf(draft, m);
          if (n.type === 'machine') {
            const b = boxes.get(m)!;
            entry.plan.box = {
              ...b,
              x: snap(n.position.x),
              y: snap(n.position.y),
              collapsed: b.collapsed || undefined,
            };
            keepBox(entry, b);
          } else if (n.type === 'state') {
            keepBox(entry, boxes.get(m)!);
            moveNode(entry, n.id, snap(n.position.x), snap(n.position.y));
          } else if (n.type === 'junction') {
            moveJunction(entry, n.id.slice(2), snap(n.position.x), snap(n.position.y));
          }
        }
      });
    },
    [act],
  );

  const isValidConnection = useCallback((c: Connection | Edge) => {
    const target = nodesRef.current.find((n) => n.id === c.target);
    const source = nodesRef.current.find((n) => n.id === c.source);
    return (
      target?.type === 'state' &&
      c.source !== c.target &&
      machineOfNode(target) === machineOfNode(source)
    );
  }, []);

  const onConnect = useCallback(
    (c: Connection) => {
      const source = nodesRef.current.find((n) => n.id === c.source);
      const m = machineOfNode(source);
      if (!m || !c.target) return;
      act((draft) => {
        const entry = entryOf(draft, m);
        if (source?.type === 'init') setInit(entry, c.target);
        else if (source?.type === 'block') {
          const b = source.data as BlockData;
          if (b.block) setAbortTarget(entry, b.block, c.target);
        } else connect(entry, c.source, c.target, newId);
      });
    },
    [act],
  );

  const actions: PlannerActions = useMemo(
    () => ({
      machineMenu: (e, machine) => setMenu({ x: e.clientX, y: e.clientY, machine }),
      toggleCollapse: (machine) =>
        act((draft) => {
          const entry = entryOf(draft, machine);
          const b = boxesOf(draft).get(machine)!;
          entry.plan.box = {
            x: b.x,
            y: b.y,
            w: b.w,
            h: b.h,
            collapsed: b.collapsed ? undefined : true,
          };
        }),
      resizeBox: (machine, b) =>
        act((draft) => {
          const entry = entryOf(draft, machine);
          entry.plan.box = { x: b.x, y: b.y, w: Math.round(b.w), h: Math.round(b.h) };
          keepBox(entry, entry.plan.box as Box);
        }),
      chooseBlock: (machine, block, slot) => {
        if (block) return usePlanner.getState().setChooser({ machine, block, slot });
        let made = '';
        act((draft) => {
          const entry = entryOf(draft, machine);
          keepBox(entry, boxesOf(draft).get(machine)!);
          made = slot === 'abort' ? addAbort(entry, newId) : addInterrupt(entry, newId);
        });
        if (made) usePlanner.getState().setChooser({ machine, block: made, slot });
      },
      openHold: (machine, interrupt) => {
        if (interrupt) return usePlanner.getState().setHold({ machine, interrupt });
        let made = '';
        act((draft) => {
          const entry = entryOf(draft, machine);
          keepBox(entry, boxesOf(draft).get(machine)!);
          made = addInterrupt(entry, newId);
        });
        if (made) usePlanner.getState().setHold({ machine, interrupt: made });
      },
      chooseWire: (machine, wire) => usePlanner.getState().setChooser({ machine, wire }),
      renumberWire: (machine, wire) => void askRenumber(machine, wire),
      selectWire: (edgeId, add) => {
        setSelectedEdges((prev) => new Set(add ? [...prev, edgeId] : [edgeId]));
        if (!add) setNodes((prev) => prev.map((n) => (n.selected ? { ...n, selected: false } : n)));
      },
    }),
    [act],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (live) return;
    if ((e.target as HTMLElement).closest('input, textarea, select')) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    const planner = usePlanner.getState();
    if (key === 'delete' || key === 'backspace') deleteSelected(nodesRef.current, edges);
    else if (ctrl && key === 'z' && !e.shiftKey) planner.undo();
    else if (ctrl && (key === 'y' || (key === 'z' && e.shiftKey))) planner.redo();
    else if (ctrl && key === 'c') copySelected(nodesRef.current);
    else if (ctrl && key === 'v') pasteClip();
    else return;
    e.preventDefault();
  };

  return (
    <PlannerCtx.Provider value={live ? LIVE_ACTIONS : actions}>
      {live ? (
        <LiveToolbar minimap={minimap} onMinimap={() => setMinimap(!minimap)} />
      ) : (
        <Toolbar
          onDelete={() => deleteSelected(nodesRef.current, edges)}
          onJunction={(k) => junction(k, edges)}
          minimap={minimap}
          onMinimap={() => setMinimap(!minimap)}
        />
      )}
      <div
        className="pl-canvas"
        ref={wrap}
        tabIndex={0}
        onKeyDown={onKeyDown}
        data-testid="planner-canvas"
      >
        <svg className="pl-defs" aria-hidden>
          <defs>
            <marker
              id="pl-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" className="pl-arrow" />
            </marker>
          </defs>
        </svg>
        <ReactFlow
          nodes={shownNodes}
          edges={shownEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeDragStop={live ? undefined : onDragStop}
          onConnect={live ? undefined : onConnect}
          isValidConnection={isValidConnection}
          nodesDraggable={!live}
          nodesConnectable={!live}
          onNodeClick={(_, n) => {
            const m = machineOfNode(n);
            if (!m) return;
            if (!live) return usePlanner.getState().setMachine(m);
            // Live: a state click fills the waveform with that state's signals (SPEC 7.2).
            if (n.type === 'state') {
              const entry = project.machines.find((e) => e.machine.id === m);
              useMonitor.getState().setFocus({
                machine: m,
                machineName: entry?.machine.name ?? '',
                node: n.id,
                nodeName: (n.data as { name: string }).name,
              });
            }
          }}
          deleteKeyCode={null}
          elevateNodesOnSelect={false}
          zoomOnDoubleClick={false}
          snapToGrid
          snapGrid={[G.grid, G.grid]}
          // Mouse: left-drag on empty canvas draws a selection box; middle/right drag or Space pans.
          // Touch: one finger on empty canvas pans, two fingers pan and zoom (the canvas library
          // only handles touch when drag-to-pan is fully on).
          selectionOnDrag={!TOUCH}
          panOnDrag={TOUCH ? true : [1, 2]}
          panActivationKeyCode="Space"
          connectionRadius={TOUCH ? 44 : 20}
          minZoom={0.2}
          maxZoom={2.5}
          fitView
          fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
          proOptions={{ hideAttribution: true }}
          colorMode="dark"
        >
          <Background
            id="fine"
            variant={BackgroundVariant.Lines}
            gap={G.grid}
            className="pl-grid-fine"
          />
          <Background
            id="strong"
            variant={BackgroundVariant.Lines}
            gap={G.grid * 5}
            className="pl-grid-strong"
          />
          {minimap && <MiniMap pannable zoomable className="pl-minimap" />}
        </ReactFlow>
      </div>
      {!live && menu && <MachineMenu {...menu} onClose={() => setMenu(null)} />}
      {!live && <ConditionChooser />}
      {!live && <HoldActionsDialog />}
    </PlannerCtx.Provider>
  );
}

/** Nothing on the live plan edits the project. */
const LIVE_ACTIONS: PlannerActions = {
  machineMenu: () => undefined,
  toggleCollapse: () => undefined,
  resizeBox: () => undefined,
  chooseBlock: () => undefined,
  openHold: () => undefined,
  chooseWire: () => undefined,
  renumberWire: () => undefined,
  selectWire: () => undefined,
};

function decorateNodes(
  project: Project,
  nodes: Node[],
  machines: LiveMachine[],
  highlight: { machine: string; state: string | null; nonce: number } | null,
  focusNode: string | null,
): Node[] {
  const nameOf = new Map(project.machines.map((e) => [e.machine.id, e.machine.name]));
  const byName = new Map(machines.map((m) => [m.name, m]));
  return nodes.map((n) => {
    const d = n.data as { machine: string; name: string };
    const mName = nameOf.get(d.machine) ?? '';
    const m = byName.get(mName);
    if (n.type === 'state') {
      return {
        ...n,
        data: {
          ...n.data,
          live: {
            active: m?.state === d.name,
            held: m?.state === d.name && m.held,
            faulted: m?.state === d.name && m.faulted,
            lit: highlight?.machine === mName && highlight.state === d.name,
            focused: focusNode === n.id,
          },
        },
      };
    }
    if (n.type === 'machine') {
      const tag = m?.faulted ? 'FAULT' : m?.held ? 'HELD' : null;
      return { ...n, data: { ...n.data, tag } };
    }
    return n;
  });
}

function termsText(r: CondResult | undefined): string {
  if (!r) return 'not evaluated yet';
  const terms = r.terms.map((t) => `${t.text} = ${JSON.stringify(t.value)}`).join('\n');
  return `${r.name} = ${r.result}\n${terms}`;
}

function decorateEdges(
  project: Project,
  edges: Edge<WireData>[],
  last: Record<string, LastTransition>,
): Edge<WireData>[] {
  const nameOf = new Map(project.machines.map((e) => [e.machine.id, e.machine.name]));
  return edges.map((e) => {
    const d = e.data!;
    const mName = nameOf.get(d.machine) ?? '';
    if (d.kind === 'wire') {
      const [from, to] = d.ends.split('-');
      const t = last[mName];
      const r = lastCondition(mName, `transition ${d.wire}`);
      return {
        ...e,
        data: {
          ...d,
          flash: t && t.from === from && t.to === to ? t.seq : undefined,
          liveText: termsText(r),
          liveResult: r?.result,
        },
      };
    }
    if (d.kind === 'abort') {
      const r = lastCondition(mName, `abort ${e.id.slice('e-abort:'.length)}`);
      return { ...e, data: { ...d, liveText: termsText(r), liveResult: r?.result } };
    }
    return e;
  });
}

/** The live plan's toolbar: only viewing tools. */
function LiveToolbar({ minimap, onMinimap }: { minimap: boolean; onMinimap: () => void }) {
  const flow = useReactFlow();
  const { zoom } = useViewport();
  const deployedAt = useLive((s) => s.deployedAt);
  const replay = useLive((s) => s.replay);
  return (
    <div className="pl-toolbar" role="toolbar" aria-label="Live plan tools">
      <span className="pl-live-title">Live plan</span>
      <span className="muted mono pl-live-note">
        {replay
          ? `recorded session ${replay}`
          : deployedAt
            ? `deployed ${new Date(deployedAt).toLocaleTimeString()}`
            : 'nothing deployed yet'}
      </span>
      <span className="spacer" />
      <button
        type="button"
        className={`tool ${minimap ? 'on' : ''}`}
        aria-pressed={minimap}
        title="Minimap"
        aria-label="Minimap"
        onClick={onMinimap}
      >
        <MapIcon {...ICON} />
      </button>
      <button
        type="button"
        className="tool"
        title="Fit to view"
        aria-label="Fit to view"
        data-testid="live-fit"
        onClick={() => void flow.fitView({ padding: 0.15, duration: 200 })}
      >
        <Maximize {...ICON} />
      </button>
      <span className="pl-zoom mono">{Math.round(zoom * 100)}%</span>
    </div>
  );
}

/** Saves the box as drawn, so growing content never makes it jump. */
function keepBox(entry: Entry, b: Box): void {
  if (!entry.plan.box)
    entry.plan.box = { x: b.x, y: b.y, w: b.w, h: b.h, collapsed: b.collapsed || undefined };
}

/* --- toolbar, footer, tab strip, machine menu ------------------------------------------- */

function Toolbar({
  onDelete,
  onJunction,
  minimap,
  onMinimap,
}: {
  onDelete: () => void;
  onJunction: (k: JunctionKind) => void;
  minimap: boolean;
  onMinimap: () => void;
}) {
  const flow = useReactFlow();
  const { zoom } = useViewport();
  const project = useProject((s) => s.project);
  usePlanner((s) => s.past.length + s.future.length); // re-render when history changes
  const planner = usePlanner.getState();
  const noMachine = !project || project.machines.length === 0;
  return (
    <div className="pl-toolbar" role="toolbar" aria-label="Planner tools">
      <button
        type="button"
        className="pl-save"
        data-testid="planner-save"
        onClick={() => void useProject.getState().save()}
      >
        <Save {...ICON} /> Save
      </button>
      <button
        type="button"
        className="tool"
        title="Undo (Ctrl+Z)"
        aria-label="Undo"
        data-testid="planner-undo"
        disabled={!planner.canUndo()}
        onClick={() => planner.undo()}
      >
        <Undo2 {...ICON} />
      </button>
      <button
        type="button"
        className="tool"
        title="Redo (Ctrl+Y)"
        aria-label="Redo"
        data-testid="planner-redo"
        disabled={!planner.canRedo()}
        onClick={() => planner.redo()}
      >
        <Redo2 {...ICON} />
      </button>
      <span className="pl-sep" />
      <button
        type="button"
        className="tool"
        data-testid="planner-add-state"
        disabled={noMachine}
        title={noMachine ? 'Add a machine first' : 'Add a state to the selected machine'}
        onClick={() => void addState()}
      >
        <Square {...ICON} /> State
      </button>
      <button
        type="button"
        className="tool"
        data-testid="planner-add-machine"
        title="Add a machine"
        onClick={() => void addMachine()}
      >
        <Workflow {...ICON} /> Machine
      </button>
      <span className="pl-sep" />
      <button
        type="button"
        className="tool mono"
        title="Horizontal combiner: join the selected wires that end at one state (drawing only)"
        data-testid="planner-h"
        onClick={() => onJunction('h')}
      >
        H
      </button>
      <button
        type="button"
        className="tool mono"
        title="Vertical combiner: join the selected wires that end at one state (drawing only)"
        data-testid="planner-v"
        onClick={() => onJunction('v')}
      >
        V
      </button>
      <button
        type="button"
        className="tool mono"
        title="Expander: fan the selected wires of one state out, up to four (drawing only)"
        data-testid="planner-exp"
        onClick={() => onJunction('exp')}
      >
        Exp
      </button>
      <span className="spacer" />
      <button
        type="button"
        className="tool"
        title="Delete the selection (Delete)"
        aria-label="Delete"
        data-testid="planner-delete"
        onClick={onDelete}
      >
        <Trash2 {...ICON} />
      </button>
      <button
        type="button"
        className={`tool ${minimap ? 'on' : ''}`}
        aria-pressed={minimap}
        title="Minimap"
        aria-label="Minimap"
        onClick={onMinimap}
      >
        <MapIcon {...ICON} />
      </button>
      <FullScreenButton />
      <button
        type="button"
        className="tool"
        title="Fit to view"
        aria-label="Fit to view"
        data-testid="planner-fit"
        onClick={() => void flow.fitView({ padding: 0.15, duration: 200 })}
      >
        <Maximize {...ICON} />
      </button>
      <span className="pl-zoom mono" data-testid="planner-zoom">
        {Math.round(zoom * 100)}%
      </span>
    </div>
  );
}

/** Hides the side panels and Messages so the canvas gets the whole screen; again to bring them back. */
let panelsBefore: { sidebarOpen: boolean; inspectorOpen: boolean; bottomOpen: boolean } | null =
  null;
function FullScreenButton() {
  const flow = useReactFlow();
  const full = useShell((s) => !s.sidebarOpen && !s.inspectorOpen && !s.bottomOpen);
  const toggle = () => {
    const s = useShell.getState();
    if (full) {
      useShell.setState(
        panelsBefore ?? { sidebarOpen: true, inspectorOpen: true, bottomOpen: true },
      );
      panelsBefore = null;
    } else {
      panelsBefore = {
        sidebarOpen: s.sidebarOpen,
        inspectorOpen: s.inspectorOpen,
        bottomOpen: s.bottomOpen,
      };
      useShell.setState({ sidebarOpen: false, inspectorOpen: false, bottomOpen: false });
    }
    window.setTimeout(() => void flow.fitView({ padding: 0.1, duration: 200 }), 120);
  };
  return (
    <button
      type="button"
      className={`tool ${full ? 'on' : ''}`}
      aria-pressed={full}
      title={
        full
          ? 'Show the side panels and Messages again'
          : 'Full screen: hide the side panels and Messages'
      }
      aria-label={full ? 'Leave full screen' : 'Full screen'}
      data-testid="planner-fullscreen"
      onClick={toggle}
    >
      {full ? <Shrink {...ICON} /> : <Expand {...ICON} />}
    </button>
  );
}

function Footer() {
  const project = useProject((s) => s.project);
  const saved = useProject((s) => s.saved);
  const savedMachines = useMemo(() => {
    try {
      const p = JSON.parse(saved) as Project | null;
      return new Map((p?.machines ?? []).map((e) => [e.machine.id, JSON.stringify(e)]));
    } catch {
      return new Map<string, string>();
    }
  }, [saved]);
  const machines = project?.machines ?? [];
  const unsaved = machines.filter(
    (e) => savedMachines.get(e.machine.id) !== JSON.stringify(e),
  ).length;
  const removed = [...savedMachines.keys()].filter(
    (id) => !machines.some((e) => e.machine.id === id),
  ).length;
  return (
    <div className="pl-footer mono" data-testid="planner-footer">
      Machines: {machines.length} | Unsaved: {unsaved + removed}
    </div>
  );
}

function MachineMenu({
  x,
  y,
  machine,
  onClose,
}: {
  x: number;
  y: number;
  machine: string;
  onClose: () => void;
}) {
  const project = useProject((s) => s.project);
  useEffect(() => {
    const close = () => onClose();
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', close);
    };
  }, [onClose]);
  if (!project) return null;
  const entry = project.machines.find((e) => e.machine.id === machine);
  if (!entry) return null;
  const label = isConstructed(entry.machine) ? 'Add New Items' : 'Construct Machine';
  const pending = hasPlaceholders(entry);
  const item = (text: string, run: () => void, testId: string, disabled = false, hint?: string) => (
    <button
      type="button"
      role="menuitem"
      className="menu-item"
      disabled={disabled}
      title={hint}
      data-testid={testId}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={() => {
        onClose();
        run();
      }}
    >
      <span className="menu-label">{text}</span>
    </button>
  );
  return (
    <div
      className="menu-list pl-menu"
      role="menu"
      style={{ left: x, top: y }}
      data-testid="machine-menu"
    >
      {item(
        label,
        () => runConstruct(machine),
        'menu-construct',
        !pending,
        pending ? undefined : 'Nothing to build: no placeholders',
      )}
      {item('Open in composer', () => openEditor('machine', machine), 'menu-composer')}
      {item('Delete machine…', () => void askDelete('machine', machine), 'menu-delete')}
    </div>
  );
}

/* --- actions ------------------------------------------------------------------------------- */

function log(level: 'info' | 'warning', text: string) {
  useShell.getState().log(level, 'Planner', text);
}

function runConstruct(machine: string) {
  let report: ReturnType<typeof construct> | null = null;
  let name = '';
  usePlanner.getState().act((draft) => {
    name = entryOf(draft, machine).machine.name;
    report = construct(draft, machine, newId);
  });
  const r = report as ReturnType<typeof construct> | null;
  if (!r) return;
  const parts = [
    r.statesCreated.length && `created states ${r.statesCreated.join(', ')}`,
    r.statesReused.length && `reused states ${r.statesReused.join(', ')}`,
    r.conditionsCreated.length && `created conditions ${r.conditionsCreated.join(', ')}`,
    r.conditionsReused.length && `reused conditions ${r.conditionsReused.join(', ')}`,
  ].filter(Boolean);
  log('info', `Construct ${name}: ${parts.length ? parts.join('; ') : 'nothing new'}.`);
  if (r.stillOpen) {
    log(
      'warning',
      `${name}: ${r.stillOpen} wire(s) or block(s) still have no condition or target.`,
    );
  }
}

async function addState() {
  const project = useProject.getState().project;
  if (!project || project.machines.length === 0) return;
  const machine = usePlanner.getState().machine ?? project.machines[0]!.machine.id;
  const entry = project.machines.find((e) => e.machine.id === machine) ?? project.machines[0]!;
  const taken = new Set(nodesOf(entry).map((n) => n.name));
  const name = await askText(
    `New state in ${entry.machine.name}`,
    'Name (an existing state template is used; a new name is a placeholder)',
    freeNodeName(entry, 'State'),
    (t) => {
      const ok = NameSchema.safeParse(t);
      if (!ok.success) return ok.error.issues[0]!.message;
      return taken.has(t) ? `${entry.machine.name} already has a state called ${t}` : null;
    },
  );
  if (name === null) return;
  usePlanner.getState().act((draft) => {
    const e = entryOf(draft, entry.machine.id);
    const box = boxesOf(draft).get(e.machine.id)!;
    const pos = defaultPos(nodesOf(e).length);
    addNode(draft, e.machine.id, name, pos, newId);
    // Make room for it.
    const need = minBoxSize(e);
    e.plan.box = {
      x: box.x,
      y: box.y,
      w: Math.max(box.w, need.w),
      h: Math.max(box.h, need.h + G.grid),
      collapsed: undefined,
    };
  });
}

async function addMachine() {
  const project = useProject.getState().project;
  if (!project) return;
  const names = project.machines.map((m) => m.machine.name);
  let base = 'Machine';
  for (let i = 2; names.includes(base); i++) base = `Machine${i}`;
  const name = await askText('New machine', 'Name', base, (t) =>
    nameError(useProject.getState().project!, 'machine', t),
  );
  if (name === null) return;
  let made = '';
  usePlanner.getState().act((draft) => {
    const boxes = [...boxesOf(draft).values()];
    const x = boxes.reduce((r, b) => Math.max(r, b.x + b.w + G.boxGap), 0);
    const machine = blankEntity(draft, 'machine', name) as Project['machines'][number]['machine'];
    made = machine.id;
    const entry: Entry = { machine, plan: { machine: machine.id, nodes: [] } };
    const w = 2 * G.gutter + 2 * (G.stateW + 60) + G.stateW;
    entry.plan.box = { x, y: 0, w, h: G.head + 80 + 2 * (G.stateH + 70) + G.blockRow };
    draft.machines.push(entry);
  });
  if (made) usePlanner.getState().focusOn(made);
}

async function askRenumber(machine: string, wire: string) {
  const project = useProject.getState().project;
  if (!project) return;
  const entry = entryOf(project, machine);
  const d = read(entry);
  const w = d.wires.find((x) => x.id === wire);
  if (!w) return;
  const n = d.wires.filter((x) => x.from === w.from).length;
  const names = new Map(nodesOf(entry).map((x) => [x.id, x.name]));
  const text = await askText(
    `Priority of ${names.get(w.from)} → ${names.get(w.to)}`,
    `Priority (1 is checked first, up to ${n})`,
    String(w.priority),
    (t) =>
      /^\d+$/.test(t) && Number(t) >= 1 && Number(t) <= n ? null : `a whole number from 1 to ${n}`,
  );
  if (text === null) return;
  usePlanner.getState().act((draft) => renumber(entryOf(draft, machine), wire, Number(text)));
}

function deleteSelected(nodes: Node[], edges: Edge<WireData>[]) {
  const selNodes = nodes.filter((n) => n.selected);
  const selEdges = edges.filter((e) => e.selected);
  const machines = selNodes.filter((n) => n.type === 'machine').map((n) => n.id.slice(2));
  const rest = selNodes.filter((n) => n.type !== 'machine' && n.type !== 'init');
  if (rest.length || selEdges.length) {
    usePlanner.getState().act((draft) => {
      for (const e of selEdges) {
        const entry = entryOf(draft, e.data!.machine);
        if (e.data!.kind === 'wire') deleteWires(entry, [e.id]);
        else if (e.data!.kind === 'init') setInit(entry, null);
        else setAbortTarget(entry, e.id.slice('e-abort:'.length), null);
      }
      for (const n of rest) {
        const m = machineOfNode(n);
        if (!m) continue;
        const entry = entryOf(draft, m);
        if (n.type === 'state') deleteNodes(entry, [n.id]);
        else if (n.type === 'junction') deleteJunctions(entry, [n.id.slice(2)]);
        else if (n.type === 'block') {
          const b = n.data as BlockData;
          if (b.block) deleteBlocks(entry, [b.block]);
        }
      }
    });
  }
  for (const m of machines) void askDelete('machine', m);
}

function copySelected(nodes: Node[]) {
  const states = nodes.filter((n) => n.selected && n.type === 'state');
  const machine = machineOfNode(states[0]);
  const project = useProject.getState().project;
  if (!machine || !project) return;
  const ids = states.filter((n) => machineOfNode(n) === machine).map((n) => n.id);
  usePlanner
    .getState()
    .setClip({ machine, clip: copyNodes(project, entryOf(project, machine), ids) });
  log('info', `Copied ${ids.length} state(s).`);
}

function pasteClip() {
  const { clip, machine } = usePlanner.getState();
  const project = useProject.getState().project;
  if (!clip || !project) return;
  const target =
    machine && project.machines.some((e) => e.machine.id === machine) ? machine : clip.machine;
  if (!project.machines.some((e) => e.machine.id === target)) return;
  usePlanner.getState().act((draft) => {
    const entry = entryOf(draft, target);
    keepBox(entry, boxesOf(draft).get(target)!);
    pasteNodes(draft, target, clip.clip, { x: 2 * G.grid, y: 2 * G.grid }, newId);
    const need = minBoxSize(entry);
    const b = entry.plan.box!;
    entry.plan.box = { ...b, w: Math.max(b.w, need.w), h: Math.max(b.h, need.h) };
  });
}

function junction(kind: JunctionKind, edges: Edge<WireData>[]) {
  const wires = edges.filter((e) => e.selected && e.data?.kind === 'wire');
  const project = useProject.getState().project;
  if (!project) return;
  if (wires.length === 0)
    return log('warning', 'Select one or more wires first (click a wire; Shift+click for more).');
  const machine = wires[0]!.data!.machine;
  if (wires.some((w) => w.data!.machine !== machine))
    return log('warning', 'The selected wires belong to different machines.');
  const box = boxesOf(project).get(machine)!;
  const pts = wires.map((w) => labelPoint(w.data!.points));
  const at = {
    x: Math.round(pts.reduce((s, p) => s + p.x, 0) / pts.length - box.x),
    y: Math.round(pts.reduce((s, p) => s + p.y, 0) / pts.length - box.y),
  };
  const ids = wires.map((w) => w.id);
  const problem = addJunction(structuredClone(entryOf(project, machine)), kind, ids, at, newId);
  if (problem) return log('warning', problem);
  usePlanner.getState().act((draft) => {
    addJunction(entryOf(draft, machine), kind, ids, at, newId);
  });
}

/* --- the editor -------------------------------------------------------------------------------- */

/** The Planner tab: toolbar, canvas, right-edge FSM / Queues strip, footer (SPEC 6.3). */
export function PlannerEditor() {
  const project = useProject((s) => s.project);
  const view = usePlanner((s) => s.view);
  if (!project) return <div className="editor-empty">No project is open.</div>;
  return (
    <div className="planner" data-testid="editor-planner">
      <div className="pl-main">
        <ReactFlowProvider>
          {view === 'fsm' ? (
            <>
              {project.machines.length === 0 && (
                <div className="pl-empty" data-testid="planner-empty">
                  No machines yet. Use <b>Machine</b> in the toolbar to add one, then <b>State</b>{' '}
                  to draw its states.
                </div>
              )}
              <Canvas />
            </>
          ) : (
            <div className="pl-queues" data-testid="planner-queues">
              <Plus {...ICON} /> The queue diagram arrives in Phase 6: queues hand records from one
              machine to the next.
            </div>
          )}
        </ReactFlowProvider>
        <Footer />
      </div>
      <div className="pl-strip" role="tablist" aria-label="Canvas view">
        {(['fsm', 'queues'] as const).map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            className={view === v ? 'active' : ''}
            data-testid={`planner-view-${v}`}
            onClick={() => usePlanner.getState().setView(v)}
          >
            {v === 'fsm' ? 'FSM' : 'Queues'}
          </button>
        ))}
      </div>
    </div>
  );
}
