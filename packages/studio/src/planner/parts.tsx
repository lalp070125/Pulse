import { createContext, useContext, type MouseEvent } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  NodeResizer,
  Position,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { BlockSlot } from '@pulso/core';
import { labelPoint, roundedPath, type Pt } from './geometry';

/* ----------------------------------------------------------------------------
 * The drawn parts of the Planner (SPEC 6.3): machine box, Init node, state node,
 * abort / interrupt blocks, drawing-only junctions, and the wire with its
 * priority badge and condition label. They only draw; every change goes through
 * the actions in PlannerCtx.
 * -------------------------------------------------------------------------- */

export interface PlannerActions {
  machineMenu(e: MouseEvent, machine: string): void;
  toggleCollapse(machine: string): void;
  resizeBox(machine: string, box: { x: number; y: number; w: number; h: number }): void;
  /** Opens the condition chooser for a block; `block` null means "create it first". */
  chooseBlock(machine: string, block: string | null, slot: BlockSlot): void;
  openHold(machine: string, interrupt: string | null): void;
  chooseWire(machine: string, wire: string): void;
  renumberWire(machine: string, wire: string): void;
}

export const PlannerCtx = createContext<PlannerActions | null>(null);
const useActions = () => useContext(PlannerCtx)!;

/* --- machine box ----------------------------------------------------------------- */

export type MachineData = {
  machine: string;
  name: string;
  collapsed: boolean;
  minW: number;
  minH: number;
  todo: number;
};
export type MachineNodeT = Node<MachineData, 'machine'>;

export function MachineNode({ data, selected }: NodeProps<MachineNodeT>) {
  const act = useActions();
  return (
    <div
      className={`pl-machine ${selected ? 'selected' : ''} ${data.collapsed ? 'collapsed' : ''}`}
      data-testid={`machine-box-${data.name}`}
    >
      {!data.collapsed && (
        <NodeResizer
          isVisible={selected}
          minWidth={data.minW}
          minHeight={data.minH}
          lineClassName="pl-resize-line"
          handleClassName="pl-resize-handle"
          onResizeEnd={(_, p) =>
            act.resizeBox(data.machine, { x: p.x, y: p.y, w: p.width, h: p.height })
          }
        />
      )}
      <div
        className="pl-machine-head"
        data-testid={`machine-head-${data.name}`}
        title="Drag to move · right-click for Construct Machine"
        onContextMenu={(e) => {
          e.preventDefault();
          act.machineMenu(e, data.machine);
        }}
      >
        <button
          type="button"
          className="pl-collapse nodrag"
          aria-label={data.collapsed ? 'Expand machine' : 'Collapse machine'}
          aria-expanded={!data.collapsed}
          onClick={() => act.toggleCollapse(data.machine)}
        >
          {data.collapsed ? (
            <ChevronRight size={14} strokeWidth={1.5} />
          ) : (
            <ChevronDown size={14} strokeWidth={1.5} />
          )}
        </button>
        <span className="pl-machine-name">{data.name}</span>
        {data.todo > 0 && (
          <span
            className="pl-todo"
            title="Placeholders not built yet: right-click → Construct Machine"
          >
            {data.todo} to build
          </span>
        )}
      </div>
    </div>
  );
}

/* --- Init ----------------------------------------------------------------------------- */

export type InitNodeT = Node<{ machine: string; name: string }, 'init'>;

export function InitNode({ data }: NodeProps<InitNodeT>) {
  return (
    <div
      className="pl-init"
      title="Init: where the machine starts. Drag from it to the first state."
      data-testid={`init-${data.name}`}
    >
      <span>Init</span>
      <Handle
        type="source"
        position={Position.Bottom}
        id="out"
        className="pl-port"
        data-testid={`init-out-${data.name}`}
      />
    </div>
  );
}

/* --- state ------------------------------------------------------------------------------ */

export type StateData = {
  machine: string;
  name: string;
  placeholder: boolean;
  entry: string[];
};
export type StateNodeT = Node<StateData, 'state'>;

export function StateNode({ data, selected }: NodeProps<StateNodeT>) {
  const label = data.placeholder ? `[${data.name}]` : data.name;
  return (
    <div
      className={`pl-state ${data.placeholder ? 'placeholder' : ''} ${selected ? 'selected' : ''}`}
      data-testid={`state-node-${data.name}`}
      title={
        data.placeholder
          ? 'Placeholder: no state template yet. Construct Machine creates it.'
          : undefined
      }
    >
      <Handle
        type="target"
        position={Position.Top}
        id="in"
        className="pl-port"
        data-testid={`in-${data.name}`}
      />
      <div className="pl-state-head">{label}</div>
      <div className="pl-state-body mono">
        {data.placeholder ? (
          <span className="pl-todo-line">to do</span>
        ) : data.entry.length === 0 ? (
          <span className="pl-muted">no entry actions</span>
        ) : (
          data.entry.slice(0, 4).map((t, i) => <div key={i}>{t}</div>)
        )}
      </div>
      <div className="pl-caption">entry</div>
      <Handle
        type="source"
        position={Position.Bottom}
        id="out"
        className="pl-port"
        data-testid={`out-${data.name}`}
      />
    </div>
  );
}

/* --- abort / interrupt blocks ------------------------------------------------------------- */

export type BlockData = {
  machine: string;
  machineName: string;
  slot: BlockSlot;
  /** null for the unassigned block shown when a machine has none yet. */
  block: string | null;
  label: string | null;
  placeholder: boolean;
  hold: number;
  index: number;
};
export type BlockNodeT = Node<BlockData, 'block'>;

const BLOCK_TITLE: Record<BlockSlot, string> = {
  abort: 'Abort',
  trigger: 'Interrupt Trig',
  resume: 'Interrupt Resume',
};
const BLOCK_HINT: Record<BlockSlot, string> = {
  abort: 'checked in every state; when true, leaves the state and goes to its target',
  trigger: 'when true, the machine holds where it is',
  resume: 'when true, a held machine continues where it was',
};

export function BlockNode({ data, selected }: NodeProps<BlockNodeT>) {
  const act = useActions();
  const id = `${data.slot}-${data.machineName}-${data.index}`;
  return (
    <div className={`pl-block-wrap ${selected ? 'selected' : ''}`} data-testid={`block-${id}`}>
      <button
        type="button"
        className={`pl-slot nodrag mono ${data.label === null ? 'unassigned' : ''} ${data.placeholder ? 'placeholder' : ''}`}
        title="Double-click to pick or create the condition"
        data-testid={`slot-${id}`}
        onDoubleClick={() => act.chooseBlock(data.machine, data.block, data.slot)}
      >
        {data.label ?? '(Unassigned)'}
      </button>
      <div className={`pl-block pl-block-${data.slot}`} title={BLOCK_HINT[data.slot]}>
        {data.slot === 'abort' && (
          <Handle
            type="source"
            position={Position.Top}
            id="out"
            className="pl-port"
            isConnectable={data.block !== null}
            data-testid={`abort-out-${id}`}
          />
        )}
        <span>{BLOCK_TITLE[data.slot]}</span>
        {data.slot === 'trigger' && (
          <button
            type="button"
            className="pl-hold nodrag"
            data-testid={`hold-${id}`}
            title="Actions that run once when the machine is held"
            onClick={() => act.openHold(data.machine, data.block)}
          >
            hold: {data.hold}
          </button>
        )}
      </div>
    </div>
  );
}

/* --- junctions (drawing only) ------------------------------------------------------------- */

export type JunctionNodeT = Node<{ kind: 'h' | 'v' | 'exp' }, 'junction'>;

export function JunctionNode({ data, selected }: NodeProps<JunctionNodeT>) {
  const title =
    data.kind === 'exp'
      ? 'Expander: one wire fans out (drawing only)'
      : `${data.kind === 'h' ? 'Horizontal' : 'Vertical'} combiner: wires join (drawing only)`;
  return (
    <div
      className={`pl-junction pl-junction-${data.kind} ${selected ? 'selected' : ''}`}
      title={title}
      data-testid={`junction-${data.kind}`}
    />
  );
}

export const nodeTypes = {
  machine: MachineNode,
  init: InitNode,
  state: StateNode,
  block: BlockNode,
  junction: JunctionNode,
};

/* --- wires ---------------------------------------------------------------------------------- */

export type WireData = {
  kind: 'wire' | 'init' | 'abort';
  machine: string;
  points: Pt[];
  back: boolean;
  /** Wires only: */
  wire?: string;
  priority?: number;
  label?: string | null;
  placeholder?: boolean;
  /** Names for test IDs and tooltips: "Idle-Feed". */
  ends: string;
};
export type WireEdgeT = Edge<WireData, 'wire'>;

export function WireEdge({ id, data, selected }: EdgeProps<WireEdgeT>) {
  const act = useActions();
  if (!data) return null;
  const path = roundedPath(data.points);
  const start = data.points[0]!;
  const mid = labelPoint(data.points);
  const open = data.kind === 'wire' && !data.label;
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd="url(#pl-arrow)"
        className={`pl-wire pl-wire-${data.kind} ${selected ? 'selected' : ''} ${data.placeholder || open ? 'placeholder' : ''}`}
        interactionWidth={14}
      />
      {data.kind === 'wire' && (
        <EdgeLabelRenderer>
          <button
            type="button"
            className="pl-badge nodrag nopan"
            style={{
              transform: `translate(-50%, -50%) translate(${start.x}px, ${start.y + 14}px)`,
            }}
            title="Priority: checked in this order. Double-click to renumber."
            data-testid={`badge-${data.ends}`}
            onDoubleClick={() => act.renumberWire(data.machine, data.wire!)}
          >
            {data.priority}
          </button>
          <button
            type="button"
            className={`pl-chip nodrag nopan mono ${data.placeholder ? 'placeholder' : ''} ${open ? 'open' : ''}`}
            style={{
              // Beside a vertical piece, above a horizontal one: never on top of the badge or the line.
              // A back wire's lane runs along the box edge, so its label goes on the inner side.
              transform: mid.vertical
                ? data.back
                  ? `translate(calc(-100% - 12px), -50%) translate(${mid.x}px, ${mid.y}px)`
                  : `translate(12px, -50%) translate(${mid.x}px, ${mid.y}px)`
                : `translate(-50%, calc(-100% - 4px)) translate(${mid.x}px, ${mid.y}px)`,
            }}
            title="Condition. Double-click to pick or create it."
            data-testid={`chip-${data.ends}`}
            onDoubleClick={() => act.chooseWire(data.machine, data.wire!)}
          >
            {data.label ?? '(no condition)'}
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const edgeTypes = { wire: WireEdge };
