import { useMemo, useState } from 'react';
import {
  NameSchema,
  entryOf,
  read,
  setBlockCondition,
  setWireCondition,
  type CondChoice,
  type PlanCond,
  type Project,
} from '@pulso/core';
import { newId } from '../lib/ulid';
import { useProject } from '../state/project';
import { usePlanner, type ChooserTarget } from './store';

/* ----------------------------------------------------------------------------
 * Pick or create the condition of a wire or a block (SPEC 6.3): a condition this
 * machine already uses, one from the library, or a new name typed here, which
 * becomes a [placeholder] until Construct Machine builds it.
 * -------------------------------------------------------------------------- */

interface Option {
  key: string;
  text: string;
  hint: string;
  choice: CondChoice;
}

function current(project: Project, t: ChooserTarget): PlanCond | null {
  const d = read(entryOf(project, t.machine));
  if ('wire' in t) return d.wires.find((w) => w.id === t.wire)?.condition ?? null;
  if (t.slot === 'abort') return d.aborts.find((a) => a.id === t.block)?.condition ?? null;
  return d.interrupts.find((i) => i.id === t.block)?.[t.slot] ?? null;
}

function optionsFor(project: Project, machineId: string): Option[] {
  const entry = entryOf(project, machineId);
  const used = entry.machine.conditions.map((c) => {
    const tpl = project.conditions.find((t) => t.id === c.template);
    const same = entry.machine.conditions.filter((x) => x.template === c.template).length;
    return {
      key: `i:${c.id}`,
      text: tpl?.name ?? '(missing)',
      hint:
        same > 1
          ? `used in ${entry.machine.name} · one of ${same}`
          : `used in ${entry.machine.name}`,
      choice: { instance: c.id },
    };
  });
  const usedTemplates = new Set(entry.machine.conditions.map((c) => c.template));
  const library = project.conditions
    .filter((t) => !usedTemplates.has(t.id))
    .map((t) => ({
      key: `t:${t.id}`,
      text: t.name,
      hint: 'library · adds it to this machine',
      choice: { template: t.id },
    }));
  return [...used, ...library];
}

export function ConditionChooser() {
  const target = usePlanner((s) => s.chooser);
  const project = useProject((s) => s.project);
  const [search, setSearch] = useState('');
  const options = useMemo(
    () => (project && target ? optionsFor(project, target.machine) : []),
    [project, target],
  );
  if (!project || !target) return null;

  const close = () => {
    setSearch('');
    usePlanner.getState().setChooser(null);
  };
  const choose = (choice: CondChoice) => {
    usePlanner.getState().act((draft) => {
      if ('wire' in target) setWireCondition(draft, target.machine, target.wire, choice, newId);
      else setBlockCondition(draft, target.machine, target.block, target.slot, choice, newId);
    });
    close();
  };

  const q = search.trim();
  const shown = options.filter((o) => !q || o.text.toLowerCase().includes(q.toLowerCase()));
  const exact = options.some((o) => o.text === q);
  const validName = q !== '' && NameSchema.safeParse(q).success;
  const now = current(project, target);
  const nowText =
    now === null
      ? '(none)'
      : now.kind === 'placeholder'
        ? `[${now.name}]`
        : (options.find((o) => o.key === `i:${now.id}`)?.text ?? '(missing)');
  const where = 'wire' in target ? 'this wire' : `the ${target.slot} block`;

  return (
    <div className="backdrop" role="presentation" onPointerDown={close}>
      <div
        className="dialog picker"
        role="dialog"
        aria-label="Choose a condition"
        data-testid="condition-chooser"
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close();
          if (e.key === 'Enter' && validName) choose({ name: q });
        }}
      >
        <div className="dialog-head">
          <span className="dialog-title">Condition for {where}</span>
          <span className="muted mono">now: {nowText}</span>
        </div>
        <div className="picker-search">
          <input
            className="input wide"
            autoFocus
            placeholder="Search, or type a new name and press Enter…"
            value={search}
            data-testid="cond-search"
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="picker-list chooser-list" role="listbox">
          {validName && !exact && (
            <button
              type="button"
              role="option"
              className="picker-item"
              data-testid="cond-new"
              onClick={() => choose({ name: q })}
            >
              <span className="mono placeholder-text">[{q}]</span>
              <span className="picker-hint">new placeholder · Construct Machine creates it</span>
            </button>
          )}
          {q !== '' && !validName && (
            <div className="editor-empty">
              Names use letters, digits and _ only, and do not start with a digit.
            </div>
          )}
          {shown.map((o) => (
            <button
              key={o.key}
              type="button"
              role="option"
              className="picker-item"
              data-testid="cond-option"
              onClick={() => choose(o.choice)}
            >
              <span className="mono">{o.text}</span>
              <span className="picker-hint">{o.hint}</span>
            </button>
          ))}
          {shown.length === 0 && !validName && q === '' && (
            <div className="editor-empty">
              No conditions yet. Type a name to make a placeholder.
            </div>
          )}
        </div>
        <div className="dialog-foot">
          <button
            type="button"
            className="btn"
            data-testid="cond-clear"
            disabled={now === null}
            onClick={() => choose(null)}
          >
            Remove condition
          </button>
          <span className="spacer" />
          <button type="button" className="btn" onClick={close}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
