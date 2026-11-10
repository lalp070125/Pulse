import { X } from 'lucide-react';
import type { Equipment, Interface, SimModel } from '@pulso/core';
import { askDelete, newEntity } from '../state/entities';
import { useProject } from '../state/project';
import { EditorPage, IconButton, NameInput, useFocusRow } from './common';

type Sel = { interface: string; signal: string };
const keyOf = (s: Sel) => `${s.interface}/${s.signal}`;
const selOf = (key: string): Sel => {
  const [i, s] = key.split('/');
  return { interface: i ?? '', signal: s ?? '' };
};

/** Picks one signal out of the interfaces the equipment is made of. */
function SignalSelect({
  label,
  value,
  options,
  onChange,
  testId,
}: {
  label: string;
  value: Sel;
  options: { key: string; text: string }[];
  onChange: (s: Sel) => void;
  testId?: string;
}) {
  const current = keyOf(value);
  return (
    <label className="sim-field">
      <span>{label}</span>
      <select
        className="input mono"
        value={current}
        data-testid={testId}
        onChange={(e) => onChange(selOf(e.target.value))}
      >
        {!options.some((o) => o.key === current) && (
          <option value={current}>(missing signal)</option>
        )}
        {options.map((o) => (
          <option key={o.key} value={o.key}>
            {o.text}
          </option>
        ))}
      </select>
    </label>
  );
}

function SimEditor({
  eq,
  interfaces,
  edit,
}: {
  eq: Equipment;
  interfaces: Interface[];
  edit: (fn: (x: Equipment) => void) => void;
}) {
  const own = eq.interfaces
    .map((id) => interfaces.find((i) => i.id === id))
    .filter((i): i is Interface => i !== undefined);
  const options = own.flatMap((i) =>
    i.signals.map((s) => ({ key: `${i.id}/${s.id}`, text: `${i.name}.${s.name}` })),
  );
  const first = (n: number): Sel => selOf(options[n]?.key ?? options[0]?.key ?? '/');
  const model = eq.simModel;
  const setKind = (kind: string) =>
    edit((x) => {
      if (kind === 'none') x.simModel = undefined;
      else if (kind === 'follow')
        x.simModel = { kind: 'follow', command: first(0), feedback: first(1), delayMs: 100 };
      else
        x.simModel = {
          kind: 'cylinder',
          command: first(0),
          extended: first(1),
          retracted: first(2),
          travelMs: 400,
        };
    });
  const patch = (fn: (m: SimModel) => void) =>
    edit((x) => {
      if (x.simModel) fn(x.simModel);
    });
  return (
    <div className="sim" data-testid="sim-model">
      <div className="sim-head">
        <span className="sub-label">Simulated behaviour</span>
        <select
          className="input"
          value={model?.kind ?? 'none'}
          data-testid="sim-kind"
          onChange={(e) => setKind(e.target.value)}
        >
          <option value="none">none (inputs stay as set)</option>
          <option value="follow">follow (feedback copies command after a delay)</option>
          <option value="cylinder">cylinder (travels out and back)</option>
        </select>
      </div>
      {model?.kind === 'follow' && (
        <div className="sim-fields">
          <SignalSelect
            label="Command"
            value={model.command}
            options={options}
            testId="sim-command"
            onChange={(s) => patch((m) => m.kind === 'follow' && (m.command = s))}
          />
          <SignalSelect
            label="Feedback"
            value={model.feedback}
            options={options}
            testId="sim-feedback"
            onChange={(s) => patch((m) => m.kind === 'follow' && (m.feedback = s))}
          />
          <label className="sim-field">
            <span>Delay (ms)</span>
            <input
              className="input mono num"
              type="number"
              min={0}
              value={model.delayMs}
              data-testid="sim-delay"
              onChange={(e) =>
                patch(
                  (m) =>
                    m.kind === 'follow' &&
                    (m.delayMs = Math.max(0, Math.trunc(Number(e.target.value) || 0))),
                )
              }
            />
          </label>
        </div>
      )}
      {model?.kind === 'cylinder' && (
        <div className="sim-fields">
          <SignalSelect
            label="Command"
            value={model.command}
            options={options}
            testId="sim-command"
            onChange={(s) => patch((m) => m.kind === 'cylinder' && (m.command = s))}
          />
          <SignalSelect
            label="Extended"
            value={model.extended}
            options={options}
            testId="sim-extended"
            onChange={(s) => patch((m) => m.kind === 'cylinder' && (m.extended = s))}
          />
          <SignalSelect
            label="Retracted"
            value={model.retracted}
            options={options}
            testId="sim-retracted"
            onChange={(s) => patch((m) => m.kind === 'cylinder' && (m.retracted = s))}
          />
          <label className="sim-field">
            <span>Travel (ms)</span>
            <input
              className="input mono num"
              type="number"
              min={1}
              value={model.travelMs}
              data-testid="sim-travel"
              onChange={(e) =>
                patch(
                  (m) =>
                    m.kind === 'cylinder' &&
                    (m.travelMs = Math.max(1, Math.trunc(Number(e.target.value) || 1))),
                )
              }
            />
          </label>
        </div>
      )}
    </div>
  );
}

function Card({
  eq,
  others,
  interfaces,
}: {
  eq: Equipment;
  others: string[];
  interfaces: Interface[];
}) {
  const update = useProject((s) => s.update);
  const { ref, lit } = useFocusRow(eq.id);
  const edit = (fn: (x: Equipment) => void) =>
    update((p) => {
      const x = p.equipment.find((y) => y.id === eq.id);
      if (x) fn(x);
    });
  const free = interfaces.filter((i) => !eq.interfaces.includes(i.id));
  return (
    <section
      ref={ref}
      className={`card ${lit ? 'card-lit' : ''}`}
      data-testid={`equipment-card-${eq.name}`}
    >
      <header className="card-head">
        <NameInput
          value={eq.name}
          taken={others}
          testId="equipment-name"
          className="input card-name"
          onCommit={(name) => edit((x) => (x.name = name))}
        />
        <input
          className="input wide"
          value={eq.description ?? ''}
          placeholder="what this device is"
          onChange={(e) => edit((x) => (x.description = e.target.value || undefined))}
        />
        <IconButton
          title={`Delete ${eq.name}`}
          onClick={() => void askDelete('equipment', eq.id)}
        />
      </header>
      <div className="chips" data-testid="equipment-interfaces">
        <span className="sub-label">Made of</span>
        {eq.interfaces.map((id) => {
          const i = interfaces.find((x) => x.id === id);
          return (
            <span key={id} className={`chip ${i ? '' : 'chip-bad'}`} data-testid="interface-chip">
              <span className="mono">{i ? i.name : '(missing interface)'}</span>
              <button
                type="button"
                aria-label={`Remove ${i?.name ?? 'interface'}`}
                onClick={() => edit((x) => (x.interfaces = x.interfaces.filter((y) => y !== id)))}
              >
                <X size={12} strokeWidth={1.5} />
              </button>
            </span>
          );
        })}
        <select
          className="input"
          value=""
          data-testid="add-interface"
          disabled={free.length === 0}
          onChange={(e) => e.target.value && edit((x) => x.interfaces.push(e.target.value))}
        >
          <option value="">{free.length === 0 ? 'no more interfaces' : '+ add interface…'}</option>
          {free.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </select>
      </div>
      <SimEditor eq={eq} interfaces={interfaces} edit={edit} />
    </section>
  );
}

/** Equipment: a card per equipment type; pick the interfaces it is made of (SPEC 6.2). */
export function EquipmentEditor() {
  const equipment = useProject((s) => s.project?.equipment ?? []);
  const interfaces = useProject((s) => s.project?.interfaces ?? []);
  return (
    <EditorPage
      testId="editor-equipment"
      title="Equipment"
      hint="A device type made of one or more interfaces: Motor = IMotor + IFault."
      newLabel="New equipment"
      onNew={() => void newEntity('equipment')}
    >
      {equipment.length === 0 && (
        <div className="editor-empty">No equipment types yet. Use “New equipment” to add one.</div>
      )}
      <div className="cards">
        {equipment.map((e) => (
          <Card
            key={e.id}
            eq={e}
            interfaces={interfaces}
            others={equipment.filter((o) => o.id !== e.id).map((o) => o.name)}
          />
        ))}
      </div>
    </EditorPage>
  );
}
