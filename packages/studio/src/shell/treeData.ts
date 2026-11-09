import type { AppId } from '@pulso/core';
import type { StudioMode } from '../state/store';

/**
 * The fixed skeleton of each sidebar tree. In Phase 0 the project is empty,
 * so groups have no entities inside them yet; later phases fill them from the
 * project model (never from a second copy).
 */
export type TreeIcon =
  | 'target'
  | 'runtime'
  | 'panel'
  | 'twin'
  | 'routing'
  | 'library'
  | 'global'
  | 'interface'
  | 'equipment'
  | 'logic'
  | 'condition'
  | 'state'
  | 'machine'
  | 'planner'
  | 'test'
  | 'report'
  | 'monitor'
  | 'wave'
  | 'log'
  | 'widget'
  | 'screen'
  | 'image'
  | 'model'
  | 'folder';

export interface TreeNode {
  id: string;
  label: string;
  icon: TreeIcon;
  /** Grey text on the right of the row. */
  hint?: string;
  /** A group can be expanded. A group with no children shows "(empty)". */
  group?: boolean;
  children?: TreeNode[];
  /** Phase in which the editor behind this node is built. */
  phase?: number;
  startOpen?: boolean;
}

const PLAN: TreeNode[] = [
  {
    id: 'target',
    label: 'Target',
    icon: 'target',
    group: true,
    startOpen: true,
    children: [
      { id: 'target.runtime', label: 'Runtime (local)', icon: 'runtime', group: true, phase: 4 },
      { id: 'target.panels', label: 'Panels (0)', icon: 'panel', group: true, phase: 7 },
      { id: 'target.twin', label: 'Twin', icon: 'twin', phase: 8 },
    ],
  },
  { id: 'routing', label: 'Routing', icon: 'routing', hint: 'bus manager', group: true, phase: 2 },
  {
    id: 'library',
    label: 'Library',
    icon: 'library',
    group: true,
    startOpen: true,
    children: [
      { id: 'lib.globals', label: 'Global Variables', icon: 'global', group: true, phase: 2 },
      { id: 'lib.interfaces', label: 'Interfaces', icon: 'interface', group: true, phase: 2 },
      { id: 'lib.equipment', label: 'Equipment', icon: 'equipment', group: true, phase: 2 },
      { id: 'lib.logic', label: 'Logic Blocks', icon: 'logic', group: true, phase: 6 },
      { id: 'lib.conditions', label: 'Conditions', icon: 'condition', group: true, phase: 2 },
      { id: 'lib.states', label: 'States', icon: 'state', group: true, phase: 2 },
    ],
  },
  { id: 'machines', label: 'Machines', icon: 'machine', hint: 'composer', group: true, phase: 2 },
  { id: 'planner', label: 'Planner', icon: 'planner', hint: 'canvas', phase: 3 },
];

const MONITOR: TreeNode[] = [
  { id: 'mon.plan', label: 'Live Plan', icon: 'monitor', phase: 4 },
  { id: 'mon.signals', label: 'Waveform Monitor', icon: 'wave', phase: 4 },
  { id: 'mon.log', label: 'Event Log', icon: 'log', phase: 4 },
  { id: 'mon.inspect', label: 'Inspectors', icon: 'folder', hint: 'timers, queues', phase: 4 },
];

const TEST: TreeNode[] = [
  { id: 'test.manager', label: 'Test Manager', icon: 'test', phase: 5 },
  { id: 'test.reports', label: 'Reports', icon: 'report', phase: 5 },
];

const PANEL: TreeNode[] = [
  { id: 'p.targets', label: 'Target Devices', icon: 'target', group: true, phase: 7 },
  {
    id: 'p.widgets',
    label: 'Widgets',
    icon: 'widget',
    group: true,
    startOpen: true,
    children: [
      'Basic Shapes',
      'Lines & Pipework',
      '3D Shapes',
      'Text & Fields',
      'Buttons & Inputs',
      'Gauges & Charts',
      'Alarms & Dialogs',
    ].map((label) => ({ id: `p.w.${label}`, label, icon: 'folder', group: true, phase: 7 })),
  },
  { id: 'p.screens', label: 'Screens', icon: 'screen', group: true, phase: 7 },
  { id: 'p.images', label: 'Image Library', icon: 'image', group: true, phase: 7 },
  { id: 'p.mapping', label: 'Variable Mapping', icon: 'routing', phase: 7 },
];

const TWIN: TreeNode[] = [
  {
    id: 't.models',
    label: 'Models Library',
    icon: 'model',
    group: true,
    startOpen: true,
    phase: 8,
  },
  {
    id: 't.instances',
    label: 'Instances',
    icon: 'equipment',
    group: true,
    startOpen: true,
    phase: 8,
  },
];

export function treeFor(app: AppId, mode: StudioMode): TreeNode[] {
  if (app === 'panel') return PANEL;
  if (app === 'twin') return TWIN;
  return mode === 'plan' ? PLAN : mode === 'monitor' ? MONITOR : TEST;
}

export function sidebarTitle(app: AppId): string | null {
  if (app === 'panel') return 'PROJECT';
  if (app === 'twin') return 'SCENE';
  return null;
}
