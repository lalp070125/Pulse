import { z } from 'zod';

/* ----------------------------------------------------------------------------
 * Variable types (SPEC 5.2) and the values they hold.
 * -------------------------------------------------------------------------- */

export type TypeSpec =
  | { kind: 'bool' }
  | { kind: 'int' }
  | { kind: 'real' }
  | { kind: 'duration' } // milliseconds, whole numbers, never negative
  | { kind: 'string' }
  | { kind: 'enum'; values: string[] }
  | { kind: 'array'; of: TypeSpec; length: number }
  | { kind: 'map'; of: TypeSpec }
  | { kind: 'record'; fields: { name: string; type: TypeSpec }[] };

/** A value as stored in files and in the variable space. Enum values are their name. */
export type Value = boolean | number | string | Value[] | { [key: string]: Value };

export const TypeSpecSchema: z.ZodType<TypeSpec> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('bool') }).strict(),
    z.object({ kind: z.literal('int') }).strict(),
    z.object({ kind: z.literal('real') }).strict(),
    z.object({ kind: z.literal('duration') }).strict(),
    z.object({ kind: z.literal('string') }).strict(),
    z
      .object({
        kind: z.literal('enum'),
        values: z.array(z.string().min(1)).min(1, 'an enum needs at least one value'),
      })
      .strict(),
    z
      .object({
        kind: z.literal('array'),
        of: TypeSpecSchema,
        length: z.number().int().min(1).max(10_000),
      })
      .strict(),
    z.object({ kind: z.literal('map'), of: TypeSpecSchema }).strict(),
    z
      .object({
        kind: z.literal('record'),
        fields: z.array(z.object({ name: z.string().min(1), type: TypeSpecSchema }).strict()),
      })
      .strict(),
  ]),
);

export const ValueSchema: z.ZodType<Value> = z.lazy(() =>
  z.union([
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(ValueSchema),
    z.record(ValueSchema),
  ]),
);

/** Short readable name of a type: `bool`, `array<int, 4>`, `enum(Auto|Manual)`. */
export function typeName(t: TypeSpec): string {
  switch (t.kind) {
    case 'enum':
      return `enum(${t.values.join('|')})`;
    case 'array':
      return `array<${typeName(t.of)}, ${t.length}>`;
    case 'map':
      return `map<string, ${typeName(t.of)}>`;
    case 'record':
      return `record{${t.fields.map((f) => `${f.name}: ${typeName(f.type)}`).join(', ')}}`;
    default:
      return t.kind;
  }
}

export function isNumeric(t: TypeSpec): boolean {
  return t.kind === 'int' || t.kind === 'real' || t.kind === 'duration';
}

/** The value a variable of this type starts with when no default is given. */
export function defaultValue(t: TypeSpec): Value {
  switch (t.kind) {
    case 'bool':
      return false;
    case 'int':
    case 'real':
    case 'duration':
      return 0;
    case 'string':
      return '';
    case 'enum':
      return t.values[0] ?? '';
    case 'array':
      return Array.from({ length: t.length }, () => defaultValue(t.of));
    case 'map':
      return {};
    case 'record': {
      const out: { [key: string]: Value } = {};
      for (const f of t.fields) out[f.name] = defaultValue(f.type);
      return out;
    }
  }
}

function isPlainObject(v: unknown): v is { [key: string]: Value } {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Returns null when `v` fits type `t`, otherwise a plain-language reason. */
export function checkValue(t: TypeSpec, v: unknown, where = 'value'): string | null {
  switch (t.kind) {
    case 'bool':
      return typeof v === 'boolean' ? null : `${where} must be true or false`;
    case 'int':
      return Number.isInteger(v) ? null : `${where} must be a whole number`;
    case 'real':
      return typeof v === 'number' && Number.isFinite(v) ? null : `${where} must be a number`;
    case 'duration':
      return Number.isInteger(v) && (v as number) >= 0
        ? null
        : `${where} must be a whole number of milliseconds (0 or more)`;
    case 'string':
      return typeof v === 'string' ? null : `${where} must be text`;
    case 'enum':
      return typeof v === 'string' && t.values.includes(v)
        ? null
        : `${where} must be one of ${t.values.join(', ')}`;
    case 'array': {
      if (!Array.isArray(v) || v.length !== t.length)
        return `${where} must be a list of exactly ${t.length} items`;
      for (let i = 0; i < v.length; i++) {
        const e = checkValue(t.of, v[i], `${where}[${i}]`);
        if (e) return e;
      }
      return null;
    }
    case 'map': {
      if (!isPlainObject(v)) return `${where} must be a map of named values`;
      for (const [k, item] of Object.entries(v)) {
        const e = checkValue(t.of, item, `${where}.${k}`);
        if (e) return e;
      }
      return null;
    }
    case 'record': {
      if (!isPlainObject(v)) return `${where} must be a record`;
      const names = t.fields.map((f) => f.name);
      for (const k of Object.keys(v)) {
        if (!names.includes(k)) return `${where} has an unknown field "${k}"`;
      }
      for (const f of t.fields) {
        if (!(f.name in v)) return `${where} is missing field "${f.name}"`;
        const e = checkValue(f.type, v[f.name], `${where}.${f.name}`);
        if (e) return e;
      }
      return null;
    }
  }
}

/** True when two types are the same shape. */
export function sameType(a: TypeSpec, b: TypeSpec): boolean {
  return typeName(a) === typeName(b);
}

/** True when a value of type `from` may be written into a variable of type `to`. */
export function assignable(from: TypeSpec, to: TypeSpec): boolean {
  if (sameType(from, to)) return true;
  // A whole number fits into a real.
  return (from.kind === 'int' || from.kind === 'duration') && to.kind === 'real';
}

export function valuesEqual(a: Value, b: Value): boolean {
  if (a === b) return true;
  if (Array.isArray(a)) {
    return Array.isArray(b) && a.length === b.length && a.every((x, i) => valuesEqual(x, b[i]!));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => k in b && valuesEqual(a[k]!, b[k]!));
  }
  return false;
}

export function cloneValue(v: Value): Value {
  if (Array.isArray(v)) return v.map(cloneValue);
  if (isPlainObject(v)) {
    const out: { [key: string]: Value } = {};
    for (const [k, item] of Object.entries(v)) out[k] = cloneValue(item);
    return out;
  }
  return v;
}

/** Compact text of a value for logs and action text: `true`, `42`, `'Auto'`. */
export function valueText(v: Value): string {
  if (typeof v === 'string') return `'${v}'`;
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  return JSON.stringify(v);
}
