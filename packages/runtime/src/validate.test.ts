import { describe, expect, it } from 'vitest';
import { validateProject, type Project } from '@pulso/core';
import { buildBoxSealer } from './seed/boxSealer';

/* The validator (SPEC 6.5), checked against the seed project and small deliberate breakages of it. */

const seed = (): Project => structuredClone(buildBoxSealer());
const errors = (p: Project) => validateProject(p).filter((i) => i.level === 'error');

describe('validator', () => {
  it('finds nothing wrong with the seed project', () => {
    expect(validateProject(seed())).toEqual([]);
  });

  it('names an unbound role and points at the machine', () => {
    const p = seed();
    const m = p.machines[0]!.machine;
    m.states[0]!.bindings = [];
    const found = errors(p).find((i) => i.message.includes('is not bound'));
    expect(found).toBeDefined();
    expect(found!.at).toEqual({ kind: 'machine', id: m.id });
    expect(found!.where).toContain(m.states[0]!.name);
  });

  it('warns about a state nothing leads to', () => {
    const p = seed();
    const m = p.machines[0]!.machine;
    const first = m.states[0]!;
    m.states.push({ ...first, id: '01JSEED0000000000000009999', name: 'Orphan' });
    const found = validateProject(p).find((i) => i.message.includes('unreachable'));
    expect(found?.level).toBe('warning');
    expect(found?.where).toContain('Orphan');
  });

  it('warns about a state with no way out', () => {
    const p = seed();
    const m = p.machines[0]!.machine;
    const from = m.states[0]!.id;
    m.transitions = m.transitions.filter((t) => t.from !== from);
    const found = validateProject(p).find((i) => i.message.includes('no way out'));
    expect(found?.where).toContain(m.states[0]!.name);
  });

  it('reports a transition whose condition is gone', () => {
    const p = seed();
    const m = p.machines[0]!.machine;
    m.transitions[0]!.condition = '01JSEED0000000000000009998';
    expect(validateProject(p).some((i) => i.message.includes('has no condition'))).toBe(true);
  });

  it('reports a duplicate priority and two writers of one signal', () => {
    const p = seed();
    const m = p.machines[0]!.machine;
    const t = m.transitions[0]!;
    m.transitions.push({ ...t, id: '01JSEED0000000000000009997' });
    expect(validateProject(p).some((i) => i.message.includes('share priority'))).toBe(true);

    const q = seed();
    const tpl = q.states.find((s) => s.steps.length > 0)!;
    tpl.steps.push({ ...tpl.steps[0]!, id: '01JSEED0000000000000009996' });
    expect(validateProject(q).some((i) => i.message.includes('written by two actions'))).toBe(true);
  });

  it('reports an action that writes a value of the wrong type', () => {
    const p = seed();
    const tpl = p.states.find((s) => s.onEntry.some((a) => a.kind === 'global'))!;
    const a = tpl.onEntry.find((x) => x.kind === 'global')!;
    if (a.kind === 'global') a.value = { from: 'literal', value: 'not a number or bool' };
    expect(errors(p).length).toBeGreaterThan(0);
  });

  it('flags a library item left pointing at a deleted global, and points at it', () => {
    const p = seed();
    const tpl = p.states.find((s) => s.onEntry.some((a) => a.kind === 'global'))!;
    const used = tpl.onEntry.find((a) => a.kind === 'global');
    if (used?.kind !== 'global') throw new Error('seed changed');
    p.globals = p.globals.filter((g) => g.id !== used.target);
    const found = errors(p).find((i) => i.at?.kind === 'state' && i.at.id === tpl.id);
    expect(found?.message).toContain('no longer exists');
  });
});
