import { describe, expect, it } from 'vitest';
import { actionText, compileProject, conditionSummary, templateVariables } from '@pulso/core';
import { buildBoxSealer } from './seed/boxSealer';

/* The text the editors show must be the text the compiler shows: one wording, no drift. */

describe('template catalog and text (against the seed project)', () => {
  const project = buildBoxSealer();
  const compiled = compileProject(project);

  it('the seed compiles without errors', () => {
    expect(compiled.problems.filter((p) => p.level === 'error')).toEqual([]);
  });

  it('offers every global and every signal of an equipment role, derived from the project', () => {
    const tpl = project.conditions.find((c) => c.roles.some((r) => r.kind === 'equipment'))!;
    const vars = templateVariables(project, tpl.roles);
    for (const g of project.globals) {
      expect(vars.some((v) => v.text === `Global.${g.name}`)).toBe(true);
    }
    const role = tpl.roles.find((r) => r.kind === 'equipment')!;
    expect(vars.some((v) => v.text.startsWith(`${role.name}.`) && v.category === 'Equipment')).toBe(
      true,
    );
  });

  it('reads each condition the way the compiler summarises it', () => {
    let checked = 0;
    for (const { machine } of project.machines) {
      const cm = compiled.machines.find((m) => m.id === machine.id)!;
      for (const ci of machine.conditions) {
        const tpl = project.conditions.find((c) => c.id === ci.template)!;
        const cc = cm.conditions.find((c) => c.id === ci.id)!;
        // The compiler names devices by instance, the template by role: compare when the names agree.
        const namesAgree = tpl.roles.every((r) => {
          const b = ci.bindings.find((x) => x.role === r.id);
          const inst =
            b && b.kind === 'instance' ? machine.instances.find((i) => i.id === b.instance) : null;
          const tm = b && b.kind === 'timer' ? machine.timers.find((t) => t.id === b.timer) : null;
          return (!inst || inst.name === r.name) && (!tm || tm.name === r.name);
        });
        if (!namesAgree) continue;
        expect(conditionSummary(project, tpl.roles, tpl.expr)).toBe(cc.summary);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('reads each action the way the compiler does', () => {
    let checked = 0;
    for (const { machine } of project.machines) {
      const cm = compiled.machines.find((m) => m.id === machine.id)!;
      for (const node of machine.states) {
        const tpl = project.states.find((s) => s.id === node.template)!;
        const cn = cm.nodes.find((n) => n.id === node.id)!;
        const namesAgree = tpl.roles.every((r) => {
          const b = node.bindings.find((x) => x.role === r.id);
          const inst =
            b && b.kind === 'instance' ? machine.instances.find((i) => i.id === b.instance) : null;
          const tm = b && b.kind === 'timer' ? machine.timers.find((t) => t.id === b.timer) : null;
          return (!inst || inst.name === r.name) && (!tm || tm.name === r.name);
        });
        if (!namesAgree) continue;
        const pairs: [typeof tpl.onEntry, typeof cn.onEntry][] = [
          [tpl.onEntry, cn.onEntry],
          [tpl.steps, cn.steps],
          [tpl.onExit, cn.onExit],
        ];
        for (const [authored, compiledActions] of pairs) {
          authored.forEach((a, i) => {
            expect(actionText(project, tpl.roles, a)).toBe(compiledActions[i]!.text);
            checked++;
          });
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});
