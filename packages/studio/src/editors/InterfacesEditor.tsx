import { Plus } from 'lucide-react';
import { defaultValue, type Direction, type Interface, type Signal } from '@pulso/core';
import { newId } from '../lib/ulid';
import { askDelete, askDeleteInner, freshName, newEntity } from '../state/entities';
import { useProject } from '../state/project';
import { EditorPage, IconButton, NameInput, TypeEditor, ValueEditor, useFocusRow } from './common';

const DIRECTIONS: { id: Direction; label: string; hint: string }[] = [
  { id: 'command', label: 'command', hint: 'written by the logic, sent out to the world' },
  { id: 'feedback', label: 'feedback', hint: 'read from the world' },
  { id: 'param', label: 'param', hint: 'configuration value' },
];

function SignalRow({ iface, s, taken }: { iface: Interface; s: Signal; taken: string[] }) {
  const update = useProject((st) => st.update);
  const edit = (fn: (x: Signal) => void) =>
    update((p) => {
      const x = p.interfaces.find((i) => i.id === iface.id)?.signals.find((y) => y.id === s.id);
      if (x) fn(x);
    });
  return (
    <tr data-testid={`signal-row-${s.name}`}>
      <td>
        <NameInput
          value={s.name}
          taken={taken}
          testId="signal-name"
          onCommit={(name) => edit((x) => (x.name = name))}
        />
      </td>
      <td>
        <TypeEditor
          type={s.type}
          testId="signal-type"
          onChange={(t) =>
            edit((x) => {
              x.type = t;
              x.default = undefined;
            })
          }
        />
      </td>
      <td>
        <select
          className={`input dir dir-${s.direction}`}
          value={s.direction}
          data-testid="signal-direction"
          onChange={(e) => edit((x) => (x.direction = e.target.value as Direction))}
        >
          {DIRECTIONS.map((d) => (
            <option key={d.id} value={d.id} title={d.hint}>
              {d.label}
            </option>
          ))}
        </select>
      </td>
      <td>
        <ValueEditor
          type={s.type}
          value={s.default ?? defaultValue(s.type)}
          onChange={(v) => edit((x) => (x.default = v))}
        />
      </td>
      <td>
        <input
          className="input"
          value={s.unit ?? ''}
          placeholder="unit"
          onChange={(e) => edit((x) => (x.unit = e.target.value || undefined))}
        />
      </td>
      <td>
        <input
          className="input wide"
          value={s.description ?? ''}
          placeholder="what it is for"
          onChange={(e) => edit((x) => (x.description = e.target.value || undefined))}
        />
      </td>
      <td className="cell-actions">
        <IconButton
          title={`Delete signal ${s.name}`}
          onClick={() =>
            void askDeleteInner(`signal '${s.name}'`, s.id, () =>
              update((p) => {
                const i = p.interfaces.find((y) => y.id === iface.id);
                if (i) i.signals = i.signals.filter((y) => y.id !== s.id);
              }),
            )
          }
        />
      </td>
    </tr>
  );
}

function Card({ iface, others }: { iface: Interface; others: string[] }) {
  const update = useProject((s) => s.update);
  const { ref, lit } = useFocusRow(iface.id);
  const edit = (fn: (x: Interface) => void) =>
    update((p) => {
      const x = p.interfaces.find((y) => y.id === iface.id);
      if (x) fn(x);
    });
  return (
    <section
      ref={ref}
      className={`card ${lit ? 'card-lit' : ''}`}
      data-testid={`interface-card-${iface.name}`}
    >
      <header className="card-head">
        <NameInput
          value={iface.name}
          taken={others}
          testId="interface-name"
          className="input card-name"
          onCommit={(name) => edit((x) => (x.name = name))}
        />
        <input
          className="input wide"
          value={iface.description ?? ''}
          placeholder="what kind of connection this describes"
          onChange={(e) => edit((x) => (x.description = e.target.value || undefined))}
        />
        <IconButton
          title={`Delete ${iface.name}`}
          onClick={() => void askDelete('interface', iface.id)}
        />
      </header>
      {iface.signals.length > 0 && (
        <table className="grid">
          <thead>
            <tr>
              <th>Signal</th>
              <th>Type</th>
              <th>Direction</th>
              <th>Default</th>
              <th>Unit</th>
              <th>Description</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {iface.signals.map((s) => (
              <SignalRow
                key={s.id}
                iface={iface}
                s={s}
                taken={iface.signals.filter((o) => o.id !== s.id).map((o) => o.name)}
              />
            ))}
          </tbody>
        </table>
      )}
      <button
        type="button"
        className="btn-small card-add"
        data-testid="add-signal"
        onClick={() =>
          edit((x) =>
            x.signals.push({
              id: newId(),
              name: freshName(
                x.signals.map((s) => s.name),
                'Signal',
              ),
              type: { kind: 'bool' },
              direction: 'feedback',
            }),
          )
        }
      >
        <Plus size={12} strokeWidth={1.5} /> signal
      </button>
    </section>
  );
}

/** Interfaces: a card per interface, rows of signals with type and direction (SPEC 6.2). */
export function InterfacesEditor() {
  const interfaces = useProject((s) => s.project?.interfaces ?? []);
  return (
    <EditorPage
      testId="editor-interfaces"
      title="Interfaces"
      hint="A kind of connection: a group of signals. Names start with I (IMotor, IValve)."
      newLabel="New interface"
      onNew={() => void newEntity('interface')}
    >
      {interfaces.length === 0 && (
        <div className="editor-empty">No interfaces yet. Use “New interface” to add one.</div>
      )}
      <div className="cards">
        {interfaces.map((i) => (
          <Card
            key={i.id}
            iface={i}
            others={interfaces.filter((o) => o.id !== i.id).map((o) => o.name)}
          />
        ))}
      </div>
    </EditorPage>
  );
}
