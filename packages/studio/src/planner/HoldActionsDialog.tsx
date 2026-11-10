import {
  entryOf,
  read,
  setHoldActions,
  type Action,
  type Machine,
  type Operand,
  type Role,
  type TimerRef,
  type VarRef,
} from '@pulso/core';
import { ActionGroup } from '../editors/StatesEditor';
import { useProject } from '../state/project';
import { usePlanner } from './store';

/* ----------------------------------------------------------------------------
 * The actions an interrupt runs once when the machine is held (SPEC 5.7). They act
 * on the machine's real devices and timers, so the shared action form (made for
 * template roles) sees each device and timer as a role of the same name and ID;
 * the actions are translated on the way in and out.
 * -------------------------------------------------------------------------- */

export function machineRoles(m: Machine): Role[] {
  return [
    ...m.instances.map((i): Role => ({
      id: i.id,
      name: i.name,
      kind: 'equipment',
      equipment: i.equipment,
    })),
    ...m.timers.map((t): Role => ({ id: t.id, name: t.name, kind: 'timer' })),
  ];
}

const refIn = (r: VarRef): VarRef =>
  r.kind === 'signal'
    ? { kind: 'roleSignal', role: r.instance, interface: r.interface, signal: r.signal }
    : r;
const refOut = (r: VarRef): VarRef =>
  r.kind === 'roleSignal'
    ? { kind: 'signal', instance: r.role, interface: r.interface, signal: r.signal }
    : r;
const opIn = (o: Operand): Operand => (o.from === 'variable' ? { ...o, ref: refIn(o.ref) } : o);
const opOut = (o: Operand): Operand => (o.from === 'variable' ? { ...o, ref: refOut(o.ref) } : o);
const timerIn = (t: TimerRef): TimerRef =>
  t.kind === 'timer' ? { kind: 'roleTimer', role: t.timer } : t;
const timerOut = (t: TimerRef): TimerRef =>
  t.kind === 'roleTimer' ? { kind: 'timer', timer: t.role } : t;

/** Machine form (concrete devices and timers) → role form for the shared editor. */
export function toRoleForm(a: Action): Action {
  if (a.kind === 'timer') return { ...a, timer: timerIn(a.timer) };
  if (a.kind === 'equipment') return { ...a, target: refIn(a.target), value: opIn(a.value) };
  return { ...a, value: opIn(a.value) };
}

/** Role form → machine form, as stored in machine.json. */
export function toMachineForm(a: Action): Action {
  if (a.kind === 'timer') return { ...a, timer: timerOut(a.timer) };
  if (a.kind === 'equipment') return { ...a, target: refOut(a.target), value: opOut(a.value) };
  return { ...a, value: opOut(a.value) };
}

export function HoldActionsDialog() {
  const hold = usePlanner((s) => s.hold);
  const project = useProject((s) => s.project);
  if (!project || !hold) return null;
  const entry = entryOf(project, hold.machine);
  const it = read(entry).interrupts.find((i) => i.id === hold.interrupt);
  if (!it) return null;
  const close = () => usePlanner.getState().setHold(null);
  return (
    <div className="backdrop" role="presentation" onPointerDown={close}>
      <div
        className="dialog hold-dialog"
        role="dialog"
        aria-label="Hold actions"
        data-testid="hold-dialog"
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && close()}
      >
        <div className="dialog-head">
          <span className="dialog-title">Hold actions — {entry.machine.name}</span>
        </div>
        <div className="dialog-body">
          <ActionGroup
            project={project}
            roles={machineRoles(entry.machine)}
            group={{
              key: 'onHold',
              title: 'On Hold',
              hint: 'once, when the interrupt holds the machine',
            }}
            list={it.onHold.map(toRoleForm)}
            change={(fn) =>
              usePlanner.getState().act((draft) => {
                const e = entryOf(draft, hold.machine);
                const cur = read(e).interrupts.find((i) => i.id === hold.interrupt);
                if (!cur) return;
                const list = cur.onHold.map(toRoleForm);
                fn(list);
                setHoldActions(e, hold.interrupt, list.map(toMachineForm));
              })
            }
          />
        </div>
        <div className="dialog-foot">
          <span className="spacer" />
          <button type="button" className="btn" data-testid="hold-close" onClick={close}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
