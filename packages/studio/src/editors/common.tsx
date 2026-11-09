import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { NameSchema, defaultValue, type TypeSpec, type Value } from '@pulso/core';
import { useProject } from '../state/project';

/* Small building blocks shared by all the library editors. */

/** Page wrapper: title bar with the "New" button, and scroll-to-focus for a tree click. */
export function EditorPage({
  title,
  hint,
  onNew,
  newLabel,
  children,
  testId,
}: {
  title: string;
  hint: string;
  onNew?: () => void;
  newLabel?: string;
  children: ReactNode;
  testId: string;
}) {
  return (
    <div className="editor" data-testid={testId}>
      <div className="editor-head">
        <div>
          <div className="editor-title">{title}</div>
          <div className="editor-hint">{hint}</div>
        </div>
        {onNew && (
          <button type="button" className="btn-primary" onClick={onNew} data-testid="editor-new">
            <Plus size={14} strokeWidth={1.5} /> {newLabel ?? 'New'}
          </button>
        )}
      </div>
      <div className="editor-body">{children}</div>
    </div>
  );
}

/** Scrolls an element into view and flashes it when the user asked to look at entity `id`. */
export function useFocusRow(id: string) {
  const ref = useRef<HTMLElement | null>(null);
  const focus = useProject((s) => s.focus);
  const [lit, setLit] = useState(false);
  useEffect(() => {
    if (focus?.id !== id) return;
    ref.current?.scrollIntoView({ block: 'nearest' });
    setLit(true);
    const t = window.setTimeout(() => setLit(false), 1600);
    return () => window.clearTimeout(t);
  }, [focus, id]);
  return { ref: ref as React.RefObject<never>, lit };
}

/** A name field that only accepts valid, unused names; a bad edit is shown and not applied. */
export function NameInput({
  value,
  onCommit,
  taken,
  testId,
  className = 'input',
}: {
  value: string;
  onCommit: (name: string) => void;
  /** Other names this one must differ from. */
  taken: string[];
  testId?: string;
  className?: string;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  let problem: string | null = null;
  const parsed = NameSchema.safeParse(text);
  if (!parsed.success) problem = parsed.error.issues[0]!.message;
  else if (taken.includes(text)) problem = `the name ${text} is already used`;
  return (
    <span className="name-input">
      <input
        className={`${className} mono ${problem ? 'invalid' : ''}`}
        value={text}
        data-testid={testId}
        title={problem ?? undefined}
        aria-invalid={problem !== null}
        onChange={(e) => {
          setText(e.target.value);
          if (NameSchema.safeParse(e.target.value).success && !taken.includes(e.target.value)) {
            onCommit(e.target.value);
          }
        }}
        onBlur={() => problem && setText(value)}
      />
    </span>
  );
}

export function IconButton({
  title,
  onClick,
  children,
  testId,
}: {
  title: string;
  onClick: () => void;
  children?: ReactNode;
  testId?: string;
}) {
  return (
    <button
      type="button"
      className="icon-btn"
      title={title}
      aria-label={title}
      onClick={onClick}
      data-testid={testId}
    >
      {children ?? <Trash2 size={14} strokeWidth={1.5} />}
    </button>
  );
}

/* --- type picker (SPEC 5.2), with nested editors for array / map / record ---------- */

const KIND_LABELS: [TypeSpec['kind'], string][] = [
  ['bool', 'bool'],
  ['int', 'int'],
  ['real', 'real'],
  ['duration', 'duration (ms)'],
  ['string', 'string'],
  ['enum', 'enum'],
  ['array', 'array'],
  ['map', 'map'],
  ['record', 'record'],
];

export function typeOfKind(kind: TypeSpec['kind']): TypeSpec {
  switch (kind) {
    case 'enum':
      return { kind: 'enum', values: ['A', 'B'] };
    case 'array':
      return { kind: 'array', of: { kind: 'bool' }, length: 2 };
    case 'map':
      return { kind: 'map', of: { kind: 'bool' } };
    case 'record':
      return { kind: 'record', fields: [{ name: 'Field1', type: { kind: 'bool' } }] };
    default:
      return { kind } as TypeSpec;
  }
}

export function TypeEditor({
  type,
  onChange,
  simple = false,
  testId,
}: {
  type: TypeSpec;
  onChange: (t: TypeSpec) => void;
  /** Hide array/map/record (used inside nested element slots only when needed). */
  simple?: boolean;
  testId?: string;
}) {
  const kinds = simple ? KIND_LABELS.slice(0, 6) : KIND_LABELS;
  return (
    <span className="type-editor">
      <select
        className="input"
        value={type.kind}
        data-testid={testId}
        onChange={(e) => onChange(typeOfKind(e.target.value as TypeSpec['kind']))}
      >
        {kinds.map(([k, label]) => (
          <option key={k} value={k}>
            {label}
          </option>
        ))}
      </select>
      {type.kind === 'enum' && (
        <input
          className="input mono"
          title="Enum values, separated by commas"
          defaultValue={type.values.join(', ')}
          key={type.values.join(',')}
          onBlur={(e) => {
            const values = e.target.value
              .split(',')
              .map((v) => v.trim())
              .filter((v) => v.length > 0);
            if (values.length > 0) onChange({ kind: 'enum', values });
          }}
        />
      )}
      {type.kind === 'array' && (
        <>
          <input
            className="input num"
            type="number"
            min={1}
            max={10000}
            title="Number of items"
            value={type.length}
            onChange={(e) =>
              onChange({
                ...type,
                length: Math.max(1, Math.min(10000, Number(e.target.value) || 1)),
              })
            }
          />
          <span className="nested">
            <TypeEditor type={type.of} onChange={(of) => onChange({ ...type, of })} />
          </span>
        </>
      )}
      {type.kind === 'map' && (
        <span className="nested">
          <TypeEditor type={type.of} onChange={(of) => onChange({ ...type, of })} />
        </span>
      )}
      {type.kind === 'record' && (
        <span className="nested record-fields">
          {type.fields.map((f, i) => (
            <span key={i} className="record-field">
              <input
                className="input mono"
                value={f.name}
                title="Field name"
                onChange={(e) => {
                  const fields = type.fields.map((x, j) =>
                    j === i ? { ...x, name: e.target.value } : x,
                  );
                  onChange({ ...type, fields });
                }}
              />
              <TypeEditor
                type={f.type}
                onChange={(t) =>
                  onChange({
                    ...type,
                    fields: type.fields.map((x, j) => (j === i ? { ...x, type: t } : x)),
                  })
                }
              />
              <IconButton
                title="Remove field"
                onClick={() => onChange({ ...type, fields: type.fields.filter((_, j) => j !== i) })}
              />
            </span>
          ))}
          <button
            type="button"
            className="btn-small"
            onClick={() =>
              onChange({
                ...type,
                fields: [
                  ...type.fields,
                  { name: `Field${type.fields.length + 1}`, type: { kind: 'bool' } },
                ],
              })
            }
          >
            <Plus size={12} strokeWidth={1.5} /> field
          </button>
        </span>
      )}
    </span>
  );
}

/* --- value editor: follows the type ------------------------------------------------- */

export function ValueEditor({
  type,
  value,
  onChange,
  testId,
}: {
  type: TypeSpec;
  value: Value;
  onChange: (v: Value) => void;
  testId?: string;
}) {
  switch (type.kind) {
    case 'bool':
      return (
        <select
          className="input mono"
          value={String(value === true)}
          data-testid={testId}
          onChange={(e) => onChange(e.target.value === 'true')}
        >
          <option value="false">false</option>
          <option value="true">true</option>
        </select>
      );
    case 'int':
    case 'real':
    case 'duration':
      return (
        <input
          className="input mono num"
          type="number"
          step={type.kind === 'real' ? 'any' : 1}
          min={type.kind === 'duration' ? 0 : undefined}
          value={typeof value === 'number' ? value : 0}
          data-testid={testId}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onChange(type.kind === 'real' ? n : Math.trunc(n));
          }}
        />
      );
    case 'string':
      return (
        <input
          className="input mono"
          value={typeof value === 'string' ? value : ''}
          data-testid={testId}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'enum':
      return (
        <select
          className="input mono"
          value={typeof value === 'string' ? value : ''}
          data-testid={testId}
          onChange={(e) => onChange(e.target.value)}
        >
          {type.values.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      );
    case 'array': {
      const items = Array.isArray(value) ? value : [];
      return (
        <span className="nested">
          {items.map((item, i) => (
            <span key={i} className="record-field">
              <span className="field-index mono">[{i}]</span>
              <ValueEditor
                type={type.of}
                value={item}
                onChange={(v) => onChange(items.map((x, j) => (j === i ? v : x)))}
              />
            </span>
          ))}
        </span>
      );
    }
    case 'record': {
      const obj = (
        typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {}
      ) as {
        [k: string]: Value;
      };
      return (
        <span className="nested">
          {type.fields.map((f) => (
            <span key={f.name} className="record-field">
              <span className="field-index mono">{f.name}</span>
              <ValueEditor
                type={f.type}
                value={obj[f.name] ?? defaultValue(f.type)}
                onChange={(v) => onChange({ ...obj, [f.name]: v })}
              />
            </span>
          ))}
        </span>
      );
    }
    case 'map': {
      const obj = (
        typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {}
      ) as {
        [k: string]: Value;
      };
      return (
        <span className="nested">
          {Object.entries(obj).map(([k, v]) => (
            <span key={k} className="record-field">
              <span className="field-index mono">{k}</span>
              <ValueEditor
                type={type.of}
                value={v}
                onChange={(nv) => onChange({ ...obj, [k]: nv })}
              />
              <IconButton
                title="Remove entry"
                onClick={() => {
                  const next = { ...obj };
                  delete next[k];
                  onChange(next);
                }}
              />
            </span>
          ))}
          <button
            type="button"
            className="btn-small"
            onClick={() => {
              let n = 1;
              while (`key${n}` in obj) n++;
              onChange({ ...obj, [`key${n}`]: defaultValue(type.of) });
            }}
          >
            <Plus size={12} strokeWidth={1.5} /> entry
          </button>
        </span>
      );
    }
  }
}
