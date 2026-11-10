import { useEffect, useState } from 'react';
import {
  Activity,
  AudioWaveform,
  Box,
  Boxes,
  Braces,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Cpu,
  FileText,
  FlaskConical,
  Folder,
  GitBranch,
  Image,
  LayoutDashboard,
  Library,
  ListTree,
  Monitor,
  Network,
  Plug,
  ScrollText,
  Server,
  Shapes,
  Split,
  Variable,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { useShell, type StudioMode } from '../state/store';
import { useProject } from '../state/project';
import {
  askDelete,
  askRename,
  duplicateEntity,
  newEntity,
  openEditor,
  showUsages,
} from '../state/entities';
import { sidebarTitle, treeFor, type TreeIcon, type TreeNode } from './treeData';
import { useMonitor, type MonitorPart } from '../monitor/store';

const MONITOR_PARTS: Record<string, MonitorPart> = {
  'mon.plan': 'plan',
  'mon.signals': 'wave',
  'mon.log': 'log',
};

const ICONS: Record<TreeIcon, LucideIcon> = {
  target: Server,
  runtime: Cpu,
  panel: LayoutDashboard,
  twin: Box,
  routing: Network,
  library: Library,
  global: Variable,
  interface: Plug,
  equipment: Boxes,
  logic: Braces,
  condition: Split,
  state: CircleDot,
  machine: Workflow,
  planner: GitBranch,
  test: FlaskConical,
  report: FileText,
  monitor: Monitor,
  wave: AudioWaveform,
  log: ScrollText,
  widget: Shapes,
  screen: Monitor,
  image: Image,
  model: ListTree,
  folder: Folder,
};

const MODES: { id: StudioMode; label: string; tip: string }[] = [
  { id: 'plan', label: 'Plan', tip: 'Describe the machine and draw its logic' },
  { id: 'monitor', label: 'Monitor', tip: 'Watch the running machine live' },
  { id: 'test', label: 'Test', tip: 'Run automatic test cases' },
];

interface ContextMenuState {
  x: number;
  y: number;
  node: TreeNode;
}

function collectOpen(nodes: TreeNode[], into: Set<string>): Set<string> {
  for (const n of nodes) {
    if (n.startOpen) into.add(n.id);
    if (n.children) collectOpen(n.children, into);
  }
  return into;
}

interface ContextItem {
  label: string;
  action?: () => void;
}

/** New / Rename / Duplicate / Delete / Find usages (SPEC 6.1). They work on library items and machines. */
function contextItems(node: TreeNode): ContextItem[] {
  const e = node.entity;
  const labels = ['New', 'Rename', 'Duplicate', 'Delete', 'Find usages'];
  if (!e) return labels.map((label) => ({ label }));
  const id = e.id;
  return [
    { label: 'New', action: () => void newEntity(e.kind) },
    { label: 'Rename', action: id ? () => void askRename(e.kind, id) : undefined },
    {
      label: 'Duplicate',
      action: id
        ? () => {
            const copy = duplicateEntity(e.kind, id);
            if (copy) openEditor(e.kind, copy);
          }
        : undefined,
    },
    { label: 'Delete', action: id ? () => void askDelete(e.kind, id) : undefined },
    { label: 'Find usages', action: id ? () => void showUsages(e.kind, id) : undefined },
  ];
}

export function Sidebar() {
  const app = useShell((s) => s.app);
  const mode = useShell((s) => s.mode);
  const selected = useShell((s) => s.selectedTreeId);
  const connection = useShell((s) => s.connection);
  const address = useShell((s) => s.runtimeAddress);
  const project = useProject((s) => s.project);
  const nodes = treeFor(app, mode, project);
  const [open, setOpen] = useState<Set<string>>(() => collectOpen(nodes, new Set()));
  const [menu, setMenu] = useState<ContextMenuState | null>(null);

  // Each tree starts with its own default groups open.
  useEffect(() => {
    setOpen((prev) =>
      collectOpen(treeFor(app, mode, useProject.getState().project), new Set(prev)),
    );
  }, [app, mode]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', close);
    };
  }, [menu]);

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const activate = (node: TreeNode) => {
    const shell = useShell.getState();
    shell.selectTreeNode(node.id);
    if (node.group) toggle(node.id);
    if (node.entity) {
      openEditor(node.entity.kind, node.entity.id);
      return;
    }
    // Live Plan, Waveform Monitor and Event Log are three parts of one Monitor tab (SPEC 7):
    // a click in one moves the others, so they are shown together.
    const part = MONITOR_PARTS[node.id];
    if (app === 'studio' && part) {
      shell.openTab({ id: 'doc:monitor', title: 'Monitor', closable: true, note: '' });
      useMonitor.getState().showPart(part);
      return;
    }
    // Studio opens a document tab for the node; Panel and Twin have fixed tabs.
    if (app === 'studio' && !node.children) {
      shell.openTab({
        id: `doc:${node.id}`,
        title: node.label.replace(/ \(\d+\)$/, ''),
        closable: true,
        note: `The ${node.label} screen is built in Phase ${node.phase ?? '?'}.`,
      });
    }
  };

  const renderNode = (node: TreeNode, depth: number) => {
    const Icon = ICONS[node.icon];
    const isOpen = open.has(node.id);
    const isRuntime = node.id === 'target.runtime';
    return (
      <div key={node.id} role="none">
        <div
          role="treeitem"
          aria-expanded={node.group ? isOpen : undefined}
          aria-selected={selected === node.id}
          tabIndex={0}
          className={`tree-row ${selected === node.id ? 'selected' : ''}`}
          style={{ paddingLeft: `calc(var(--pad) + ${depth} * 12px)` }}
          onClick={() => activate(node)}
          onKeyDown={(e) => e.key === 'Enter' && activate(node)}
          onContextMenu={(e) => {
            e.preventDefault();
            useShell.getState().selectTreeNode(node.id);
            setMenu({ x: e.clientX, y: e.clientY, node });
          }}
        >
          <span className="tree-arrow">
            {node.group &&
              (isOpen ? (
                <ChevronDown size={14} strokeWidth={1.5} />
              ) : (
                <ChevronRight size={14} strokeWidth={1.5} />
              ))}
          </span>
          <Icon className={`tree-icon icon-${node.icon}`} size={14} strokeWidth={1.5} />
          <span className="tree-label">{node.label}</span>
          {isRuntime ? (
            <span className={`tree-hint tree-conn ${connection}`} title={`Runtime ${connection}`}>
              <span className="status-dot" /> {address ?? '—'}
            </span>
          ) : (
            node.hint && <span className="tree-hint">({node.hint})</span>
          )}
        </div>
        {node.group && isOpen && (
          <div role="group">
            {node.children && node.children.length > 0 ? (
              node.children.map((child) => renderNode(child, depth + 1))
            ) : (
              <div
                className="tree-row tree-empty"
                style={{ paddingLeft: `calc(var(--pad) + ${depth + 1} * 12px + 18px)` }}
              >
                (empty)
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const title = sidebarTitle(app);
  return (
    <aside className="sidebar" data-testid="sidebar">
      {app === 'studio' && (
        <div className="mode-pills" role="tablist" aria-label="Studio mode">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={mode === m.id}
              className={mode === m.id ? 'active' : ''}
              title={m.tip}
              onClick={() => useShell.getState().setMode(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}
      {title && <div className="panel-head">{title}</div>}
      <div className="tree" role="tree" data-testid="project-tree">
        {nodes.map((n) => renderNode(n, 0))}
      </div>
      {app === 'studio' && mode === 'plan' && (
        <div className="sidebar-note">
          <Activity size={14} strokeWidth={1.5} />{' '}
          {project ? `Project: ${project.info.name}` : 'No project is open.'}
        </div>
      )}
      {menu && (
        <div
          className="menu-list context-menu"
          role="menu"
          style={{ left: menu.x, top: menu.y }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {contextItems(menu.node).map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className="menu-item"
              disabled={!item.action}
              title={item.action ? undefined : 'Not available for this item'}
              onClick={() => {
                setMenu(null);
                item.action?.();
              }}
            >
              <span className="menu-label">{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}
