import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import {
  defaultValue,
  exprText,
  refType,
  type CmpOp,
  type Expr,
  type Project,
  type Role,
  type TypeSpec,
} from '@pulso/core';
import { ValueEditor } from './common';
import { VariablePicker, literalFor, type Want } from './VariablePicker';

/* ----------------------------------------------------------------------------
 * The IF row of a condition (SPEC 5.5 / 6.2): boxes for the terms, operator
 * dropdowns between them, a NOT toggle and bracket buttons on each term, and a
 * delete on each term. The condition stays a tree; this only draws it.
 * -------------------------------------------------------------------------- */

interface Ctx {
  project: Project;
  roles: Role[];
}

const CMP: { id: CmpOp; text: string }[] = [
  { id: 'eq', text: '=' },
  { id: 'ne', text: '≠' },
  { id: 'lt', text: '<' },
  { id: 'le', text: '≤' },
  { id: 'gt', text: '>' },
  { id: 'ge', text: '≥' },
];

type Group = Extract<Expr, { op: 'and' | 'or' }>;
const isGroup = (e: Expr): e is Group => e.op === 'and' || e.op === 'or';

/** The type a term produces, when it is known (used to type the other side of a comparison). */
function typeOfExpr(ctx: Ctx, e: Expr): TypeSpec | null {
  switch (e.op) {
    case 'var':
      return refType(ctx.project, ctx.roles, e.ref);
    case 'lit':
      return typeof e.value === 'boolean'
        ? { kind: 'bool' }
        : typeof e.value === 'number'
          ? { kind: 'real' }
          : typeof e.value === 'string'
            ? { kind: 'string' }
            : null;
    case 'timerElapsed':
      return { kind: 'duration' };
    case 'count':
      return { kind: 'int' };
    default:
      return { kind: 'bool' };
  }
}

/** A filled box: click it to pick something else. */
function Box({
  text,
  onClick,
  bad,
  testId,
}: {
  text: string;
  onClick: () => void;
  bad?: boolean;
  testId?: string;
}) {
  return (
    <button
      type="button"
      className={`term-box mono ${bad ? 'term-bad' : ''}`}
      onClick={onClick}
      data-testid={testId ?? 'term-box'}
      title="Click to change"
    >
      {text}
    </button>
  );
}

/** One side of a comparison: a variable box or a typed literal. */
function Operand({
  ctx,
  expr,
  other,
  onChange,
}: {
  ctx: Ctx;
  expr: Expr;
  other: Expr;
  onChange: (e: Expr) => void;
}) {
  const [picking, setPicking] = useState(false);
  const otherType = typeOfExpr(ctx, other);
  const want: Want = otherType ? { type: otherType } : 'any';
  const text = exprText(ctx.project, ctx.roles, expr);
  const ownType = otherType ?? typeOfExpr(ctx, expr);
  return (
    <span className="operand">
      {expr.op === 'lit' ? (
        ownType ? (
          <ValueEditor
            type={ownType.kind === 'real' && typeof expr.value === 'number' ? ownType : ownType}
            value={expr.value}
            testId="operand-literal"
            onChange={(value) => onChange({ op: 'lit', value })}
          />
        ) : (
          <span className="mono">{text}</span>
        )
      ) : (
        <Box text={text} bad={text.includes('(missing)')} onClick={() => setPicking(true)} />
      )}
      <button
        type="button"
        className="btn-small"
        title={expr.op === 'lit' ? 'Use a variable instead' : 'Use a fixed value instead'}
        onClick={() =>
          expr.op === 'lit' ? setPicking(true) : onChange(literalFor(ownType ?? { kind: 'bool' }))
        }
      >
        {expr.op === 'lit' ? 'var' : 'value'}
      </button>
      {picking && (
        <VariablePicker
          project={ctx.project}
          roles={ctx.roles}
          want={want}
          onClose={() => setPicking(false)}
          onPick={(e) => {
            setPicking(false);
            onChange(e);
          }}
        />
      )}
    </span>
  );
}

function Term({ ctx, expr, onChange }: { ctx: Ctx; expr: Expr; onChange: (e: Expr) => void }) {
  const [picking, setPicking] = useState(false);
  if (expr.op === 'cmp') {
    return (
      <span className="term-cmp" data-testid="term-cmp">
        <Operand
          ctx={ctx}
          expr={expr.left}
          other={expr.right}
          onChange={(left) => onChange({ ...expr, left })}
        />
        <select
          className="input mono op-select"
          value={expr.cmp}
          data-testid="cmp-op"
          onChange={(e) => onChange({ ...expr, cmp: e.target.value as CmpOp })}
        >
          {CMP.map((c) => (
            <option key={c.id} value={c.id}>
              {c.text}
            </option>
          ))}
        </select>
        <Operand
          ctx={ctx}
          expr={expr.right}
          other={expr.left}
          onChange={(right) => onChange({ ...expr, right })}
        />
      </span>
    );
  }
  if (expr.op === 'lit' && typeof expr.value === 'boolean') {
    return (
      <span className="term-lit">
        <select
          className="input mono"
          value={String(expr.value)}
          data-testid="lit-bool"
          onChange={(e) => onChange({ op: 'lit', value: e.target.value === 'true' })}
        >
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
        <button type="button" className="btn-small" onClick={() => setPicking(true)}>
          pick…
        </button>
        {picking && (
          <VariablePicker
            project={ctx.project}
            roles={ctx.roles}
            want="bool"
            onClose={() => setPicking(false)}
            onPick={(e) => {
              setPicking(false);
              onChange(e);
            }}
          />
        )}
      </span>
    );
  }
  const text = exprText(ctx.project, ctx.roles, expr);
  return (
    <>
      <Box text={text} bad={text.includes('(missing)')} onClick={() => setPicking(true)} />
      {picking && (
        <VariablePicker
          project={ctx.project}
          roles={ctx.roles}
          want="bool"
          onClose={() => setPicking(false)}
          onPick={(e) => {
            setPicking(false);
            onChange(e);
          }}
        />
      )}
    </>
  );
}

function GroupView({
  ctx,
  group,
  top,
  onChange,
}: {
  ctx: Ctx;
  group: Group;
  top: boolean;
  onChange: (g: Group) => void;
}) {
  const [adding, setAdding] = useState<null | 'term' | 'compare'>(null);
  const setArgs = (args: Expr[]) => onChange({ ...group, args });
  const setArg = (i: number, e: Expr) => setArgs(group.args.map((a, j) => (j === i ? e : a)));

  return (
    <span
      className={`group ${top ? 'group-top' : 'group-nested'}`}
      data-testid={top ? 'if-row' : 'group'}
    >
      {!top && <span className="bracket">(</span>}
      {group.args.map((arg, i) => {
        const negated = arg.op === 'not';
        const inner = arg.op === 'not' ? arg.arg : arg;
        const setInner = (e: Expr) => setArg(i, negated ? { op: 'not', arg: e } : e);
        return (
          <span key={i} className="term-slot">
            {i > 0 && (
              <select
                className="input mono op-select"
                value={group.op}
                data-testid="group-op"
                onChange={(e) => onChange({ ...group, op: e.target.value as 'and' | 'or' })}
              >
                <option value="and">AND</option>
                <option value="or">OR</option>
              </select>
            )}
            <span className="term" data-testid="term">
              <button
                type="button"
                className={`not-toggle ${negated ? 'on' : ''}`}
                aria-pressed={negated}
                title="NOT"
                data-testid="not-toggle"
                onClick={() => setArg(i, negated ? inner : { op: 'not', arg: inner })}
              >
                NOT
              </button>
              {isGroup(inner) ? (
                <GroupView
                  ctx={ctx}
                  group={inner}
                  top={false}
                  onChange={(g) =>
                    g.args.length === 0
                      ? setArgs(group.args.filter((_, j) => j !== i))
                      : setInner(g.args.length === 1 && !negated ? g.args[0]! : g)
                  }
                />
              ) : (
                <Term ctx={ctx} expr={inner} onChange={setInner} />
              )}
              {!isGroup(inner) && (
                <button
                  type="button"
                  className="btn-small"
                  title="Put this term in brackets"
                  data-testid="bracket"
                  onClick={() => setInner({ op: group.op === 'and' ? 'or' : 'and', args: [inner] })}
                >
                  ( )
                </button>
              )}
              <button
                type="button"
                className="icon-btn"
                title="Delete this term"
                aria-label="Delete this term"
                data-testid="delete-term"
                onClick={() => setArgs(group.args.filter((_, j) => j !== i))}
              >
                <X size={12} strokeWidth={1.5} />
              </button>
            </span>
          </span>
        );
      })}
      <button
        type="button"
        className="btn-small"
        data-testid="add-term"
        onClick={() => setAdding('term')}
      >
        <Plus size={12} strokeWidth={1.5} /> term
      </button>
      <button
        type="button"
        className="btn-small"
        data-testid="add-compare"
        onClick={() => setAdding('compare')}
      >
        <Plus size={12} strokeWidth={1.5} /> compare
      </button>
      {!top && <span className="bracket">)</span>}
      {adding && (
        <VariablePicker
          project={ctx.project}
          roles={ctx.roles}
          want={adding === 'term' ? 'bool' : 'any'}
          title={adding === 'term' ? 'Add a term' : 'Compare a variable'}
          onClose={() => setAdding(null)}
          onPick={(e) => {
            const kind = adding;
            setAdding(null);
            if (kind === 'term') return setArgs([...group.args, e]);
            const t = typeOfExpr(ctx, e) ?? { kind: 'bool' };
            setArgs([
              ...group.args,
              { op: 'cmp', cmp: 'eq', left: e, right: { op: 'lit', value: defaultValue(t) } },
            ]);
          }}
        />
      )}
    </span>
  );
}

export function ExprEditor({
  project,
  roles,
  expr,
  onChange,
}: {
  project: Project;
  roles: Role[];
  expr: Expr;
  onChange: (e: Expr) => void;
}) {
  const ctx: Ctx = { project, roles };
  // The IF row is always a group; a single term is shown as a group of one and stored bare.
  const root: Group = isGroup(expr) ? expr : { op: 'and', args: [expr] };
  return (
    <div className="if-line">
      <span className="if-label">IF</span>
      <GroupView
        ctx={ctx}
        group={root}
        top
        onChange={(g) =>
          onChange(
            g.args.length === 0
              ? { op: 'lit', value: true }
              : g.op === 'and' && g.args.length === 1
                ? g.args[0]!
                : g,
          )
        }
      />
    </div>
  );
}
