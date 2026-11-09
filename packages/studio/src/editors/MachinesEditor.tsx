import { Plus } from 'lucide-react';
import {
  sameType,
  type Binding,
  type Machine,
  type Project,
  type Role,
  type TypeSpec,
} from '@pulso/core';
import { newId } from '../lib/ulid';
import { askDelete, askDeleteInner, freshName, newEntity } from '../state/entities';
import { useProject } from '../state/project';
import { useShell } from '../state/store';
import { EditorPage, IconButton, NameInput, useFocusRow } from './common';

/** A machine's users of templates: a state node or a condition instance, each with role bindings. */
interface User {
  kind: 'state' | 'condition';
  id: string;
  label: string;
  roles: Role[];
  bindings: Binding[];
}

function usersOf(p: Project, m: Machine): User[] {
  const out: User[] = [];
  for (const s of m.states) {
    const tpl = p.states.find((t) => t.id === s.template);
    out.push({
      kind: 'state',
      id: s.id,
      label: `State '${s.name}'`,
      roles: tpl?.roles ?? [],
      bindings: s.bindings,
    });
  }
  for (const c of m.conditions) {
    const tpl = p.conditions.find((t) => t.id === c.template);
    out.push({
      kind: 'condition',
      id: c.id,
      label: `Condition '${tpl?.name ?? '(missing)'}'`,
      roles: tpl?.roles ?? [],
      bindings: c.bindings,
    });
  }
  return out;
}

/** Everything a variable role of this type could be bound to in this machine. */
function variableChoices(p: Project, m: Machine, type: TypeSpec) {
  const out: { key: string; text: string; ref: Extract<Binding, { kind: 'variable' }>['ref'] }[] =
    [];
  for (const g of p.globals) {
    if (sameType(g.type, type)) {
      out.push({
        key: `g:${g.id}`,
        text: `Global.${g.name}`,
        ref: { kind: 'global', global: g.id },
      });
    }
  }
  for (const inst of m.instances) {
    const eq = p.equipment.find((e) => e.id === inst.equipment);
    for (const ifId of eq?.interfaces ?? []) {
      const iface = p.interfaces.find((i) => i.id === ifId);
      for (const s of iface?.signals ?? []) {
        if (!sameType(s.type, type)) continue;
        out.push({
          key: `s:${inst.id}/${iface!.id}/${s.id}`,
          text: `${inst.name}.${iface!.name}.${s.name}`,
          ref: { kind: 'signal', instance: inst.id, interface: iface!.id, signal: s.id },
        });
      }
    }
  }
  return out;
}

function bindingKey(b: Binding | undefined): string {
  if (!b) return '';
  if (b.kind === 'instance') return `i:${b.instance}`;
  if (b.kind === 'timer') return `t:${b.timer}`;
  return b.ref.kind === 'global'
    ? `g:${b.ref.global}`
    : `s:${b.ref.instance}/${b.ref.interface}/${b.ref.signal}`;
}

function BindingRow({ m, user, role }: { m: Machine; user: User; role: Role }) {
  const project = useProject((s) => s.project)!;
  const update = useProject((s) => s.update);
  const bound = user.bindings.find((b) => b.role === role.id);

  const setBinding = (next: Binding | null) =>
    update((p) => {
      const mm = p.machines.find((x) => x.machine.id === m.id)?.machine;
      if (!mm) return;
      const target =
        user.kind === 'state'
          ? mm.states.find((s) => s.id === user.id)
          : mm.conditions.find((c) => c.id === user.id);
      if (!target) return;
      target.bindings = target.bindings.filter((b) => b.role !== role.id);
      if (next) target.bindings.push(next);
    });

  let needs = '';
  let options: { key: string; text: string; binding: Binding }[] = [];
  if (role.kind === 'equipment') {
    const eqName = project.equipment.find((e) => e.id === role.equipment)?.name ?? '(missing type)';
    needs = `a ${eqName}`;
    options = m.instances
      .filter((i) => i.equipment === role.equipment)
      .map((i) => ({
        key: `i:${i.id}`,
        text: i.name,
        binding: { role: role.id, kind: 'instance', instance: i.id },
      }));
  } else if (role.kind === 'timer') {
    needs = 'a timer';
    options = m.timers.map((t) => ({
      key: `t:${t.id}`,
      text: t.name,
      binding: { role: role.id, kind: 'timer', timer: t.id },
    }));
  } else {
    needs = `a variable (${role.type.kind})`;
    options = variableChoices(project, m, role.type).map((c) => ({
      key: c.key,
      text: c.text,
      binding: { role: role.id, kind: 'variable', ref: c.ref },
    }));
  }
  const current = bindingKey(bound);
  const known = options.some((o) => o.key === current);
  const unbound = !bound;
  return (
    <tr className={unbound ? 'row-warn' : ''} data-testid={`binding-${user.label}-${role.name}`}>
      <td>{user.label}</td>
      <td className="mono">{role.name}</td>
      <td className="muted">{needs}</td>
      <td>
        <select
          className={`input mono ${unbound || (bound && !known) ? 'invalid-warn' : ''}`}
          value={current}
          data-testid="binding-select"
          onChange={(e) =>
            setBinding(options.find((o) => o.key === e.target.value)?.binding ?? null)
          }
        >
          <option value="">{options.length ? '— not bound —' : '— nothing to bind to —'}</option>
          {bound && !known && <option value={current}>(no longer exists)</option>}
          {options.map((o) => (
            <option key={o.key} value={o.key}>
              {o.text}
            </option>
          ))}
        </select>
      </td>
      <td className="warn-text">{unbound ? 'Unbound' : bound && !known ? 'Broken' : ''}</td>
    </tr>
  );
}

/** Binds every unbound role that has an obvious answer: same name, or the only one of its kind. */
function autoBind(m: Machine, p: Project): number {
  let count = 0;
  const users = usersOf(p, m);
  for (const u of users) {
    const target =
      u.kind === 'state'
        ? m.states.find((s) => s.id === u.id)
        : m.conditions.find((c) => c.id === u.id);
    if (!target) continue;
    for (const role of u.roles) {
      if (target.bindings.some((b) => b.role === role.id)) continue;
      let binding: Binding | null = null;
      if (role.kind === 'equipment') {
        const same = m.instances.filter((i) => i.equipment === role.equipment);
        const pick =
          same.find((i) => i.name === role.name) ?? (same.length === 1 ? same[0] : undefined);
        if (pick) binding = { role: role.id, kind: 'instance', instance: pick.id };
      } else if (role.kind === 'timer') {
        const pick =
          m.timers.find((t) => t.name === role.name) ??
          (m.timers.length === 1 ? m.timers[0] : undefined);
        if (pick) binding = { role: role.id, kind: 'timer', timer: pick.id };
      } else {
        const choices = variableChoices(p, m, role.type);
        const pick =
          choices.find((c) => c.text.endsWith(`.${role.name}`)) ??
          (choices.length === 1 ? choices[0] : undefined);
        if (pick) binding = { role: role.id, kind: 'variable', ref: pick.ref };
      }
      if (binding) {
        target.bindings.push(binding);
        count++;
      }
    }
  }
  return count;
}

function Card({ m, others }: { m: Machine; others: string[] }) {
  const project = useProject((s) => s.project)!;
  const update = useProject((s) => s.update);
  const { ref, lit } = useFocusRow(m.id);
  const edit = (fn: (x: Machine) => void) =>
    update((p) => {
      const x = p.machines.find((y) => y.machine.id === m.id)?.machine;
      if (x) fn(x);
    });
  const users = usersOf(project, m);
  const rows = users.flatMap((u) => u.roles.map((r) => ({ u, r })));
  const unbound = rows.filter(({ u, r }) => !u.bindings.some((b) => b.role === r.id)).length;

  return (
    <section
      ref={ref}
      className={`card ${lit ? 'card-lit' : ''}`}
      data-testid={`machine-card-${m.name}`}
    >
      <header className="card-head">
        <NameInput
          value={m.name}
          taken={[...others, 'Global']}
          testId="machine-name"
          className="input card-name"
          onCommit={(name) => edit((x) => (x.name = name))}
        />
        <label className="inline-field">
          Cycle time
          <input
            className="input mono num"
            type="number"
            min={1}
            max={60000}
            value={m.cycleMs}
            data-testid="machine-cycle"
            onChange={(e) =>
              edit(
                (x) =>
                  (x.cycleMs = Math.max(
                    1,
                    Math.min(60000, Math.trunc(Number(e.target.value) || 1)),
                  )),
              )
            }
          />
          ms
        </label>
        <span className="spacer" />
        <IconButton title={`Delete ${m.name}`} onClick={() => void askDelete('machine', m.id)} />
      </header>

      <div className="sub-section">
        <div className="sub-head">
          <span className="sub-label">Instances — real devices in this machine</span>
          <button
            type="button"
            className="btn-small"
            data-testid="add-instance"
            disabled={project.equipment.length === 0}
            title={project.equipment.length === 0 ? 'Create an equipment type first' : undefined}
            onClick={() =>
              edit((x) => {
                const eq = project.equipment[0]!;
                x.instances.push({
                  id: newId(),
                  name: freshName(
                    x.instances.map((i) => i.name),
                    eq.name,
                  ),
                  equipment: eq.id,
                });
              })
            }
          >
            <Plus size={12} strokeWidth={1.5} /> instance
          </button>
        </div>
        {m.instances.length > 0 && (
          <table className="grid compact">
            <thead>
              <tr>
                <th>Name</th>
                <th>Equipment type</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {m.instances.map((i) => (
                <tr key={i.id} data-testid={`instance-${i.name}`}>
                  <td>
                    <NameInput
                      value={i.name}
                      taken={m.instances.filter((o) => o.id !== i.id).map((o) => o.name)}
                      testId="instance-name"
                      onCommit={(name) =>
                        edit((x) => {
                          const t = x.instances.find((o) => o.id === i.id);
                          if (t) t.name = name;
                        })
                      }
                    />
                  </td>
                  <td>
                    <select
                      className="input"
                      value={i.equipment}
                      data-testid="instance-type"
                      onChange={(e) =>
                        edit((x) => {
                          const t = x.instances.find((o) => o.id === i.id);
                          if (t) t.equipment = e.target.value;
                        })
                      }
                    >
                      {!project.equipment.some((e) => e.id === i.equipment) && (
                        <option value={i.equipment}>(missing type)</option>
                      )}
                      {project.equipment.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="cell-actions">
                    <IconButton
                      title={`Delete instance ${i.name}`}
                      onClick={() =>
                        void askDeleteInner(`instance '${i.name}'`, i.id, () =>
                          edit((x) => (x.instances = x.instances.filter((o) => o.id !== i.id))),
                        )
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="sub-section">
        <div className="sub-head">
          <span className="sub-label">Timers</span>
          <button
            type="button"
            className="btn-small"
            data-testid="add-timer"
            onClick={() =>
              edit((x) =>
                x.timers.push({
                  id: newId(),
                  name: freshName(
                    x.timers.map((t) => t.name),
                    'Timer',
                  ),
                  presetMs: 1000,
                }),
              )
            }
          >
            <Plus size={12} strokeWidth={1.5} /> timer
          </button>
        </div>
        {m.timers.length > 0 && (
          <table className="grid compact">
            <thead>
              <tr>
                <th>Name</th>
                <th>Preset (ms)</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {m.timers.map((t) => (
                <tr key={t.id} data-testid={`timer-${t.name}`}>
                  <td>
                    <NameInput
                      value={t.name}
                      taken={m.timers.filter((o) => o.id !== t.id).map((o) => o.name)}
                      testId="timer-name"
                      onCommit={(name) =>
                        edit((x) => {
                          const y = x.timers.find((o) => o.id === t.id);
                          if (y) y.name = name;
                        })
                      }
                    />
                  </td>
                  <td>
                    <input
                      className="input mono num"
                      type="number"
                      min={0}
                      value={t.presetMs}
                      data-testid="timer-preset-ms"
                      onChange={(e) =>
                        edit((x) => {
                          const y = x.timers.find((o) => o.id === t.id);
                          if (y) y.presetMs = Math.max(0, Math.trunc(Number(e.target.value) || 0));
                        })
                      }
                    />
                  </td>
                  <td className="cell-actions">
                    <IconButton
                      title={`Delete timer ${t.name}`}
                      onClick={() =>
                        void askDeleteInner(`timer '${t.name}'`, t.id, () =>
                          edit((x) => (x.timers = x.timers.filter((o) => o.id !== t.id))),
                        )
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="sub-section">
        <div className="sub-head">
          <span className="sub-label">States this machine uses</span>
          <select
            className="input"
            value=""
            data-testid="add-state-instance"
            disabled={project.states.length === 0}
            onChange={(e) => {
              const tpl = project.states.find((s) => s.id === e.target.value);
              if (!tpl) return;
              edit((x) =>
                x.states.push({
                  id: newId(),
                  name: freshName(
                    x.states.map((s) => s.name),
                    tpl.name,
                  ),
                  template: tpl.id,
                  bindings: [],
                }),
              );
            }}
          >
            <option value="">
              {project.states.length ? '+ add a state…' : 'no state templates yet'}
            </option>
            {project.states.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="chips">
          {m.states.map((s) => (
            <span key={s.id} className="chip" data-testid="state-instance">
              <span className="mono">{s.name}</span>
              <button
                type="button"
                aria-label={`Remove state ${s.name}`}
                onClick={() =>
                  void askDeleteInner(`state '${s.name}' in ${m.name}`, s.id, () =>
                    edit((x) => (x.states = x.states.filter((o) => o.id !== s.id))),
                  )
                }
              >
                ×
              </button>
            </span>
          ))}
          {m.states.length === 0 && <span className="muted">none yet</span>}
        </div>
      </div>

      <div className="sub-section">
        <div className="sub-head">
          <span className="sub-label">Conditions this machine uses</span>
          <select
            className="input"
            value=""
            data-testid="add-condition-instance"
            disabled={project.conditions.length === 0}
            onChange={(e) => {
              const tpl = project.conditions.find((c) => c.id === e.target.value);
              if (!tpl) return;
              edit((x) => x.conditions.push({ id: newId(), template: tpl.id, bindings: [] }));
            }}
          >
            <option value="">
              {project.conditions.length ? '+ add a condition…' : 'no conditions yet'}
            </option>
            {project.conditions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="chips">
          {m.conditions.map((c) => {
            const tpl = project.conditions.find((t) => t.id === c.template);
            return (
              <span key={c.id} className="chip" data-testid="condition-instance">
                <span className="mono">{tpl?.name ?? '(missing)'}</span>
                <button
                  type="button"
                  aria-label={`Remove condition ${tpl?.name ?? ''}`}
                  onClick={() =>
                    void askDeleteInner(`condition '${tpl?.name}' in ${m.name}`, c.id, () =>
                      edit((x) => (x.conditions = x.conditions.filter((o) => o.id !== c.id))),
                    )
                  }
                >
                  ×
                </button>
              </span>
            );
          })}
          {m.conditions.length === 0 && <span className="muted">none yet</span>}
        </div>
      </div>

      <div className="sub-section" data-testid="binding-table">
        <div className="sub-head">
          <span className="sub-label">Bindings — which real thing each role stands for</span>
          <span className={unbound ? 'warn-text' : 'muted'} data-testid="unbound-count">
            {unbound === 0 ? 'All roles bound' : `${unbound} unbound`}
          </span>
          <button
            type="button"
            className="btn-small"
            data-testid="auto-bind"
            disabled={unbound === 0}
            title="Bind roles whose name matches, or that have only one possible answer"
            onClick={() => {
              let n = 0;
              edit((x) => {
                n = autoBind(x, useProject.getState().project!);
              });
              useShell
                .getState()
                .log(
                  'info',
                  'Composer',
                  n ? `Auto-bound ${n} role(s).` : 'No role had an obvious answer.',
                );
            }}
          >
            Auto-bind
          </button>
        </div>
        {rows.length > 0 ? (
          <table className="grid compact">
            <thead>
              <tr>
                <th>Used by</th>
                <th>Role</th>
                <th>Needs</th>
                <th>Bound to</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ u, r }) => (
                <BindingRow key={`${u.id}/${r.id}`} m={m} user={u} role={r} />
              ))}
            </tbody>
          </table>
        ) : (
          <div className="muted">
            No roles to bind: the states and conditions used here need no devices.
          </div>
        )}
      </div>
    </section>
  );
}

/** Machines (composer): instances, timers, the states and conditions used, and the binding table (SPEC 5.4, 6.2). */
export function MachinesEditor() {
  const machines = useProject((s) => s.project?.machines ?? []);
  return (
    <EditorPage
      testId="editor-machines"
      title="Machines"
      hint="Put real devices in a machine and say which one each role stands for. The wiring between states is drawn in the Planner."
      newLabel="New machine"
      onNew={() => void newEntity('machine')}
    >
      {machines.length === 0 && (
        <div className="editor-empty">No machines yet. Use “New machine” to add one.</div>
      )}
      <div className="cards">
        {machines.map(({ machine: m }) => (
          <Card
            key={m.id}
            m={m}
            others={machines.filter((o) => o.machine.id !== m.id).map((o) => o.machine.name)}
          />
        ))}
      </div>
    </EditorPage>
  );
}
