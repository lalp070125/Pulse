import { useRef, useState } from 'react';
import { ChevronDown, ChevronRight, GripVertical, Plus, X } from 'lucide-react';
import {
  actionText,
  defaultValue,
  refType,
  templateVariables,
  type Action,
  type Operand,
  type Project,
  type Role,
  type StateTemplate,
  type TimerOp,
  type TypeSpec,
} from '@pulso/core';
import { newId } from '../lib/ulid';
import { askDelete, newEntity } from '../state/entities';
import { useProject } from '../state/project';
import { RolesEditor } from './RolesEditor';
import { VariablePicker } from './VariablePicker';
import { EditorPage, IconButton, NameInput, ValueEditor, useFocusRow } from './common';

type GroupKey = 'onEntry' | 'steps' | 'onExit';
const GROUPS: { key: GroupKey; title: string; hint: string }[] = [
  { key: 'onEntry', title: 'On Entry', hint: 'once, on the tick the state becomes active' },
  { key: 'steps', title: 'Steps', hint: 'every tick while the state is active' },
  { key: 'onExit', title: 'On Exit', hint: 'once, on the tick the state is left' },
];
const TIMER_OPS: { id: TimerOp; label: string }[] = [
  { id: 'start', label: 'Start' },
  { id: 'stop', label: 'Stop' },
  { id: 'restart', label: 'Restart' },
  { id: 'reset', label: 'Reset' },
  { id: 'setPreset', label: 'SetPreset' },
];

/** The action kinds of SPEC 5.6. Logic blocks and queues arrive in Phase 6. */
const KINDS = [
  { id: 'equipment', label: 'Equipment', text: 'Conveyor.IMotor.SetRun(true)' },
  { id: 'global', label: 'Global', text: 'Global.SetBoxCount(0)' },
  { id: 'generic', label: 'Generic', text: 'Generic.Set[bool](true)' },
  { id: 'timer', label: 'Timer', text: "Timer.Start('SealTime')" },
  { id: 'logic', label: 'Logic block', text: "Logic.Execute('CountBox')" },
  { id: 'queue', label: 'Queue', text: "Queue.Push('ToLabeler', record)" },
] as const;

/** A new action of a kind, filled with the first sensible choice; null when nothing can be chosen yet. */
function newAction(kind: string, project: Project, roles: Role[]): Action | null {
  const id = newId();
  if (kind === 'equipment') {
    const v = templateVariables(project, roles).find(
      (x) => x.ref.kind === 'roleSignal' && x.direction !== 'feedback',
    );
    return v
      ? {
          id,
          kind: 'equipment',
          target: v.ref,
          value: { from: 'literal', value: defaultValue(v.type) },
        }
      : null;
  }
  if (kind === 'global') {
    const g = project.globals[0];
    return g
      ? {
          id,
          kind: 'global',
          target: g.id,
          value: { from: 'literal', value: defaultValue(g.type) },
        }
      : null;
  }
  if (kind === 'generic') {
    const r = roles.find((x) => x.kind === 'variable');
    return r && r.kind === 'variable'
      ? {
          id,
          kind: 'generic',
          target: r.id,
          value: { from: 'literal', value: defaultValue(r.type) },
        }
      : null;
  }
  if (kind === 'timer') {
    const r = roles.find((x) => x.kind === 'timer');
    return r ? { id, kind: 'timer', op: 'start', timer: { kind: 'roleTimer', role: r.id } } : null;
  }
  return null;
}

/** Why a kind cannot be added right now, or null if it can. */
function unavailable(kind: string, project: Project, roles: Role[]): string | null {
  if (kind === 'logic' || kind === 'queue') return 'Arrives in Phase 6';
  return newAction(kind, project, roles)
    ? null
    : ({
        equipment: 'Add a device role to this state first',
        global: 'Create a global variable first',
        generic: 'Add a variable role to this state first',
        timer: 'Add a timer role to this state first',
      }[kind] ?? null);
}

function OperandEditor({
  project,
  roles,
  type,
  operand,
  onChange,
}: {
  project: Project;
  roles: Role[];
  type: TypeSpec;
  operand: Operand;
  onChange: (o: Operand) => void;
}) {
  const [picking, setPicking] = useState(false);
  const text =
    operand.from === 'variable'
      ? (templateVariables(project, roles).find(
          (v) => JSON.stringify(v.ref) === JSON.stringify(operand.ref),
        )?.text ?? '(missing)')
      : '';
  return (
    <span className="operand">
      <select
        className="input"
        value={operand.from}
        data-testid="operand-from"
        onChange={(e) =>
          e.target.value === 'literal'
            ? onChange({ from: 'literal', value: defaultValue(type) })
            : setPicking(true)
        }
      >
        <option value="literal">value</option>
        <option value="variable">variable</option>
      </select>
      {operand.from === 'literal' ? (
        <ValueEditor
          type={type}
          value={operand.value}
          testId="action-value"
          onChange={(value) => onChange({ from: 'literal', value })}
        />
      ) : (
        <button type="button" className="term-box mono" onClick={() => setPicking(true)}>
          {text}
        </button>
      )}
      {picking && (
        <VariablePicker
          project={project}
          roles={roles}
          want={{ type }}
          title="Write the value of…"
          onClose={() => setPicking(false)}
          onPick={(e) => {
            setPicking(false);
            if (e.op === 'var') onChange({ from: 'variable', ref: e.ref });
          }}
        />
      )}
    </span>
  );
}

function ActionForm({
  project,
  roles,
  action,
  onChange,
}: {
  project: Project;
  roles: Role[];
  action: Action;
  onChange: (a: Action) => void;
}) {
  if (action.kind === 'timer') {
    const timers = roles.filter((r) => r.kind === 'timer');
    return (
      <div className="action-form">
        <select
          className="input"
          value={action.op}
          data-testid="timer-op"
          onChange={(e) => onChange({ ...action, op: e.target.value as TimerOp })}
        >
          {TIMER_OPS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          className="input"
          value={action.timer.kind === 'roleTimer' ? action.timer.role : ''}
          data-testid="timer-role"
          onChange={(e) =>
            onChange({ ...action, timer: { kind: 'roleTimer', role: e.target.value } })
          }
        >
          {timers.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        {action.op === 'setPreset' && (
          <label className="sim-field">
            <span>Preset (ms)</span>
            <input
              className="input mono num"
              type="number"
              min={0}
              value={action.presetMs ?? 0}
              data-testid="timer-preset"
              onChange={(e) =>
                onChange({
                  ...action,
                  presetMs: Math.max(0, Math.trunc(Number(e.target.value) || 0)),
                })
              }
            />
          </label>
        )}
      </div>
    );
  }

  let type: TypeSpec = { kind: 'bool' };
  let target: React.ReactNode;
  if (action.kind === 'equipment') {
    const vars = templateVariables(project, roles).filter(
      (v) => v.ref.kind === 'roleSignal' && v.direction !== 'feedback',
    );
    type = refType(project, roles, action.target) ?? type;
    target = (
      <select
        className="input mono"
        value={JSON.stringify(action.target)}
        data-testid="action-target"
        onChange={(e) => {
          const ref = JSON.parse(e.target.value) as typeof action.target;
          const t = refType(project, roles, ref);
          onChange({
            ...action,
            target: ref,
            value: t ? { from: 'literal', value: defaultValue(t) } : action.value,
          });
        }}
      >
        {!vars.some((v) => JSON.stringify(v.ref) === JSON.stringify(action.target)) && (
          <option value={JSON.stringify(action.target)}>(missing)</option>
        )}
        {vars.map((v) => (
          <option key={v.text} value={JSON.stringify(v.ref)}>
            {v.text}
          </option>
        ))}
      </select>
    );
  } else if (action.kind === 'global') {
    const g = project.globals.find((x) => x.id === action.target);
    type = g?.type ?? type;
    target = (
      <select
        className="input mono"
        value={action.target}
        data-testid="action-target"
        onChange={(e) => {
          const t = project.globals.find((x) => x.id === e.target.value);
          onChange({
            ...action,
            target: e.target.value,
            value: t ? { from: 'literal', value: defaultValue(t.type) } : action.value,
          });
        }}
      >
        {!g && <option value={action.target}>(missing)</option>}
        {project.globals.map((x) => (
          <option key={x.id} value={x.id}>
            Global.{x.name}
          </option>
        ))}
      </select>
    );
  } else {
    const role = roles.find((r) => r.id === action.target);
    type = role?.kind === 'variable' ? role.type : type;
    target = (
      <select
        className="input mono"
        value={action.target}
        data-testid="action-target"
        onChange={(e) => {
          const r = roles.find((x) => x.id === e.target.value);
          onChange({
            ...action,
            target: e.target.value,
            value:
              r?.kind === 'variable'
                ? { from: 'literal', value: defaultValue(r.type) }
                : action.value,
          });
        }}
      >
        {!role && <option value={action.target}>(missing)</option>}
        {roles
          .filter((r) => r.kind === 'variable')
          .map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
      </select>
    );
  }
  return (
    <div className="action-form">
      <span className="sub-label">Set</span>
      {target}
      <span className="sub-label">to</span>
      <OperandEditor
        project={project}
        roles={roles}
        type={type}
        operand={action.value}
        onChange={(value) => onChange({ ...action, value })}
      />
    </div>
  );
}

/**
 * One collapsible list of actions with the + Add menu, drag to reorder and a form per action.
 * Used for On Entry / Steps / On Exit here, and for an interrupt's hold actions in the Planner.
 */
export function ActionGroup({
  project,
  roles,
  group,
  list,
  change,
}: {
  project: Project;
  /** What the actions may name: a template's roles, or a machine's devices and timers. */
  roles: Role[];
  group: { key: string; title: string; hint: string };
  list: Action[];
  /** Applies a change to the list. */
  change: (fn: (actions: Action[]) => void) => void;
}) {
  const [open, setOpen] = useState(true);
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const drag = useRef<string | null>(null);

  return (
    <div className="agroup" data-testid={`group-${group.key}`}>
      <div className="agroup-head">
        <button
          type="button"
          className="collapse-head"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? (
            <ChevronDown size={14} strokeWidth={1.5} />
          ) : (
            <ChevronRight size={14} strokeWidth={1.5} />
          )}
          {group.title}
          <span className="count">{list.length}</span>
        </button>
        <span className="agroup-hint">{group.hint}</span>
        <span className="spacer" />
        <div className="add-menu">
          <button
            type="button"
            className="btn-small"
            aria-haspopup="menu"
            aria-expanded={menu}
            data-testid="add-action"
            onClick={() => setMenu(!menu)}
          >
            <Plus size={12} strokeWidth={1.5} /> Add <ChevronDown size={12} strokeWidth={1.5} />
          </button>
          {menu && (
            <div
              className="menu-list add-menu-list"
              role="menu"
              onPointerLeave={() => setMenu(false)}
            >
              {KINDS.map((k) => {
                const why = unavailable(k.id, project, roles);
                return (
                  <button
                    key={k.id}
                    type="button"
                    role="menuitem"
                    className="menu-item"
                    disabled={why !== null}
                    title={why ?? undefined}
                    data-testid={`add-${k.id}`}
                    onClick={() => {
                      setMenu(false);
                      const a = newAction(k.id, project, roles);
                      if (!a) return;
                      change((actions) => actions.push(a));
                      setEditing(a.id);
                    }}
                  >
                    <span className="menu-label">{k.label}</span>
                    <span className="menu-shortcut mono">{k.text}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
      {open && (
        <div className="actions">
          {list.length === 0 && <div className="actions-empty">No actions.</div>}
          {list.map((a) => (
            <div key={a.id} className="action" data-action-id={a.id} data-testid="action-row">
              <div className="action-line">
                <span
                  className="grip"
                  title="Drag to reorder"
                  data-testid="action-grip"
                  onPointerDown={(e) => {
                    drag.current = a.id;
                    e.currentTarget.setPointerCapture(e.pointerId);
                  }}
                  onPointerMove={(e) => {
                    const dragging = drag.current;
                    if (!dragging) return;
                    const over = document
                      .elementsFromPoint(e.clientX, e.clientY)
                      .map((el) => el.closest<HTMLElement>('[data-action-id]'))
                      .find((el) => el && el.dataset.actionId !== dragging);
                    const overId = over?.dataset.actionId;
                    if (!overId || !list.some((x) => x.id === overId)) return;
                    change((actions) => {
                      const from = actions.findIndex((x) => x.id === dragging);
                      const to = actions.findIndex((x) => x.id === overId);
                      if (from < 0 || to < 0) return;
                      const [moved] = actions.splice(from, 1);
                      actions.splice(to, 0, moved!);
                    });
                  }}
                  onPointerUp={() => (drag.current = null)}
                  onPointerCancel={() => (drag.current = null)}
                >
                  <GripVertical size={14} strokeWidth={1.5} />
                </span>
                <button
                  type="button"
                  className={`action-text mono ${actionText(project, roles, a).includes('(missing)') ? 'term-bad' : ''}`}
                  data-testid="action-text"
                  title="Click to edit"
                  onClick={() => setEditing(editing === a.id ? null : a.id)}
                >
                  {actionText(project, roles, a)}
                </button>
                <IconButton
                  title="Delete action"
                  onClick={() =>
                    change((actions) => {
                      const i = actions.findIndex((x) => x.id === a.id);
                      if (i >= 0) actions.splice(i, 1);
                    })
                  }
                >
                  <X size={14} strokeWidth={1.5} />
                </IconButton>
              </div>
              {editing === a.id && (
                <ActionForm
                  project={project}
                  roles={roles}
                  action={a}
                  onChange={(next) =>
                    change((actions) => {
                      const i = actions.findIndex((x) => x.id === a.id);
                      if (i >= 0) actions[i] = next;
                    })
                  }
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Card({ s, others }: { s: StateTemplate; others: string[] }) {
  const project = useProject((st) => st.project)!;
  const update = useProject((st) => st.update);
  const { ref, lit } = useFocusRow(s.id);
  const edit = (fn: (x: StateTemplate) => void) =>
    update((p) => {
      const x = p.states.find((y) => y.id === s.id);
      if (x) fn(x);
    });
  return (
    <section
      ref={ref}
      className={`card ${lit ? 'card-lit' : ''}`}
      data-testid={`state-card-${s.name}`}
    >
      <header className="card-head">
        <NameInput
          value={s.name}
          taken={others}
          testId="state-name"
          className="input card-name"
          onCommit={(name) => edit((x) => (x.name = name))}
        />
        <input
          className="input wide"
          value={s.description ?? ''}
          placeholder="what the machine is doing in this state"
          onChange={(e) => edit((x) => (x.description = e.target.value || undefined))}
        />
        <IconButton title={`Delete ${s.name}`} onClick={() => void askDelete('state', s.id)} />
      </header>
      <RolesEditor roles={s.roles} change={(fn) => edit((x) => fn(x.roles))} />
      {GROUPS.map((g) => (
        <ActionGroup
          key={g.key}
          project={project}
          roles={s.roles}
          group={g}
          list={s[g.key]}
          change={(fn) => edit((x) => fn(x[g.key]))}
        />
      ))}
    </section>
  );
}

/** States: a card per state template with On Entry, Steps and On Exit (SPEC 5.6, 6.2). */
export function StatesEditor() {
  const states = useProject((s) => s.project?.states ?? []);
  return (
    <EditorPage
      testId="editor-states"
      title="States"
      hint="Reusable modes of a machine. Roles stand for devices and timers that each machine binds."
      newLabel="New state"
      onNew={() => void newEntity('state')}
    >
      {states.length === 0 && (
        <div className="editor-empty">No states yet. Use “New state” to add one.</div>
      )}
      <div className="cards">
        {states.map((s) => (
          <Card key={s.id} s={s} others={states.filter((o) => o.id !== s.id).map((o) => o.name)} />
        ))}
      </div>
    </EditorPage>
  );
}
