import { useMemo, useState } from 'react';
import {
  defaultValue,
  isNumeric,
  sameType,
  templateVariables,
  type CatalogVar,
  type Expr,
  type Project,
  type Role,
  type TypeSpec,
} from '@pulso/core';

/* ----------------------------------------------------------------------------
 * Variable picker (SPEC 6.2): a dialog with categories — Equipment, Globals, Edges,
 * Aggregates, Machine state, Timers, Queues — and a search box. It only offers
 * things whose type fits the slot it was opened for. The list is built from the
 * project every time it opens; it is not a copy.
 * -------------------------------------------------------------------------- */

/** What the slot needs. */
export type Want = 'bool' | 'num' | 'any' | { type: TypeSpec };

const CATEGORIES = [
  'Equipment',
  'Globals',
  'Edges',
  'Aggregates',
  'Machine state',
  'Timers',
  'Queues',
] as const;
type Category = (typeof CATEGORIES)[number];

interface Item {
  category: Category;
  text: string;
  hint: string;
  expr: Expr;
}

function isScalar(t: TypeSpec): boolean {
  return t.kind === 'bool' || isNumeric(t) || t.kind === 'string' || t.kind === 'enum';
}

export function fits(t: TypeSpec, want: Want): boolean {
  if (want === 'bool') return t.kind === 'bool';
  if (want === 'num') return isNumeric(t);
  if (want === 'any') return isScalar(t);
  return sameType(t, want.type) || (isNumeric(t) && isNumeric(want.type));
}

/** Everything a slot of this kind can be filled with. */
export function pickerItems(project: Project, roles: Role[], want: Want): Item[] {
  const items: Item[] = [];
  const vars: CatalogVar[] = templateVariables(project, roles);
  for (const v of vars) {
    if (fits(v.type, want)) {
      items.push({
        category: v.category,
        text: v.text,
        hint: v.direction ? `${v.type.kind} · ${v.direction}` : v.type.kind,
        expr: { op: 'var', ref: v.ref },
      });
    }
  }
  const wantsBool = want === 'bool' || want === 'any';
  const wantsNum = want === 'num' || want === 'any';
  if (wantsBool) {
    for (const v of vars) {
      if (v.type.kind === 'bool') {
        items.push({
          category: 'Edges',
          text: `rising(${v.text})`,
          hint: 'becomes true this tick',
          expr: { op: 'rising', ref: v.ref },
        });
        items.push({
          category: 'Edges',
          text: `falling(${v.text})`,
          hint: 'becomes false this tick',
          expr: { op: 'falling', ref: v.ref },
        });
      }
      if (isScalar(v.type)) {
        items.push({
          category: 'Edges',
          text: `changed(${v.text})`,
          hint: 'differs from the last tick',
          expr: { op: 'changed', ref: v.ref },
        });
      }
      if (v.type.kind === 'array' && v.type.of.kind === 'bool') {
        for (const op of ['any', 'all'] as const) {
          items.push({
            category: 'Aggregates',
            text: `${op}(${v.text})`,
            hint: op === 'any' ? 'at least one is true' : 'all are true',
            expr: { op, ref: v.ref },
          });
        }
      }
    }
    for (const { machine } of project.machines) {
      for (const s of machine.states) {
        items.push({
          category: 'Machine state',
          text: `inState(${machine.name}, ${s.name})`,
          hint: 'that machine is in that state',
          expr: { op: 'inState', machine: machine.id, state: s.id },
        });
      }
    }
  }
  if (wantsNum) {
    for (const v of vars) {
      if (v.type.kind === 'array' && v.type.of.kind === 'bool') {
        items.push({
          category: 'Aggregates',
          text: `count(${v.text})`,
          hint: 'how many are true',
          expr: { op: 'count', ref: v.ref },
        });
      }
    }
  }
  for (const r of roles) {
    if (r.kind !== 'timer') continue;
    const timer = { kind: 'roleTimer', role: r.id } as const;
    if (wantsBool) {
      items.push({
        category: 'Timers',
        text: `timer.done('${r.name}')`,
        hint: 'reached its preset',
        expr: { op: 'timerDone', timer },
      });
      items.push({
        category: 'Timers',
        text: `timer.running('${r.name}')`,
        hint: 'is counting',
        expr: { op: 'timerRunning', timer },
      });
    }
    if (wantsNum) {
      items.push({
        category: 'Timers',
        text: `timer.elapsed('${r.name}')`,
        hint: 'milliseconds counted',
        expr: { op: 'timerElapsed', timer },
      });
    }
  }
  return items;
}

/** The value a fresh literal of this type starts as, for the right side of a comparison. */
export function literalFor(t: TypeSpec): Expr {
  return { op: 'lit', value: defaultValue(t) };
}

export function VariablePicker({
  project,
  roles,
  want,
  title = 'Pick a variable',
  onPick,
  onClose,
}: {
  project: Project;
  roles: Role[];
  want: Want;
  title?: string;
  onPick: (e: Expr) => void;
  onClose: () => void;
}) {
  const items = useMemo(() => pickerItems(project, roles, want), [project, roles, want]);
  const [category, setCategory] = useState<Category>(
    () => CATEGORIES.find((c) => items.some((i) => i.category === c)) ?? 'Equipment',
  );
  const [search, setSearch] = useState('');
  const q = search.trim().toLowerCase();
  const shown = items.filter(
    (i) => (q ? true : i.category === category) && (!q || i.text.toLowerCase().includes(q)),
  );

  return (
    <div className="backdrop" role="presentation" onPointerDown={onClose}>
      <div
        className="dialog picker"
        role="dialog"
        aria-label={title}
        data-testid="variable-picker"
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <div className="dialog-head">
          <span className="dialog-title">{title}</span>
        </div>
        <div className="picker-search">
          <input
            className="input wide"
            autoFocus
            placeholder="Search…"
            value={search}
            data-testid="picker-search"
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="picker-body">
          <div className="picker-cats" role="tablist">
            {CATEGORIES.map((c) => {
              const n = items.filter((i) => i.category === c).length;
              return (
                <button
                  key={c}
                  type="button"
                  role="tab"
                  aria-selected={!q && category === c}
                  className={!q && category === c ? 'active' : ''}
                  onClick={() => {
                    setSearch('');
                    setCategory(c);
                  }}
                >
                  {c}
                  <span className="count">{c === 'Queues' ? '—' : n}</span>
                </button>
              );
            })}
          </div>
          <div className="picker-list" role="listbox">
            {!q && category === 'Queues' && (
              <div className="editor-empty">Queues arrive in Phase 6.</div>
            )}
            {category !== 'Queues' && shown.length === 0 && (
              <div className="editor-empty">
                {q ? 'Nothing matches.' : 'Nothing of this kind fits here.'}
              </div>
            )}
            {(q || category !== 'Queues') &&
              shown.map((i) => (
                <button
                  key={`${i.category}:${i.text}`}
                  type="button"
                  role="option"
                  className="picker-item"
                  data-testid="picker-item"
                  onClick={() => onPick(i.expr)}
                >
                  <span className="mono">{i.text}</span>
                  <span className="picker-hint">{q ? `${i.category} · ${i.hint}` : i.hint}</span>
                </button>
              ))}
          </div>
        </div>
        <div className="dialog-foot">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
