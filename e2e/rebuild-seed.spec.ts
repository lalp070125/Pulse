import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { Project } from '@pulso/core';
import { Engine } from '@pulso/core';
import { loadProject } from '../packages/runtime/src/store';
import { openPlanner, setCondition, watchReloads, wire } from './helpers';
import {
  CONDITIONS,
  STATES,
  buildLibrary,
  composeSealer,
  createNamed,
  fillCondition,
  fillState,
  openFromTree,
} from './sealer';

/* ----------------------------------------------------------------------------
 * Phase 2 acceptance (SPEC 14): the seed machine can be rebuilt from an empty
 * project using only the UI. Every step below is a click or a keystroke in the
 * Studio; nothing is written through the API. At the end the saved project is
 * compared with /projects/box-sealer-demo, with every ID replaced by the name
 * of what it points at (IDs are random, names are what the user typed).
 *
 * Steps 1-6 use the Phase 2 editors; step 7 draws the wiring (Init, transitions,
 * abort, interrupt with its hold action) on the Phase 3 Planner canvas.
 * -------------------------------------------------------------------------- */

test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(240_000);

const SHOTS = 'test-results/screens';
const SEED_DIR = path.resolve('projects/box-sealer-demo');

/* --- comparison ------------------------------------------------------------- */

/**
 * Replaces every ID with a readable label of what it names ("Interface IMotor › Signal Run"),
 * drops the IDs themselves and the drawing (plan.json: positions only for this machine).
 */
function comparable(p: Project): unknown {
  const labels = new Map<string, string>();
  const label = (id: string, text: string) => labels.set(id, text);
  for (const g of p.globals) label(g.id, `Global ${g.name}`);
  for (const i of p.interfaces) {
    label(i.id, `Interface ${i.name}`);
    for (const s of i.signals) label(s.id, `Interface ${i.name} › ${s.name}`);
  }
  for (const e of p.equipment) label(e.id, `Equipment ${e.name}`);
  for (const t of [...p.conditions, ...p.states]) {
    label(t.id, `Template ${t.name}`);
    // A role is only used inside its own template, so its name is enough (the seed shares role objects).
    for (const r of t.roles) label(r.id, `Role ${r.name}`);
  }
  for (const { machine: m } of p.machines) {
    label(m.id, `Machine ${m.name}`);
    for (const i of m.instances) label(i.id, `Instance ${i.name}`);
    for (const t of m.timers) label(t.id, `Timer ${t.name}`);
    for (const s of m.states) label(s.id, `Node ${s.name}`);
    for (const c of m.conditions) {
      const tpl = p.conditions.find((x) => x.id === c.template);
      label(c.id, `Uses ${tpl?.name ?? '?'}`);
    }
  }
  const swap = (v: unknown): unknown => {
    if (typeof v === 'string') return labels.get(v) ?? v;
    if (Array.isArray(v)) return v.map(swap);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) {
        if (k === 'id' || x === undefined) continue;
        out[k] = k === 'bindings' ? sortBindings(swap(x)) : swap(x);
      }
      return out;
    }
    return v;
  };
  const sortBindings = (v: unknown) =>
    (v as { role: string }[]).slice().sort((a, b) => a.role.localeCompare(b.role));

  return {
    globals: swap(p.globals),
    interfaces: swap(p.interfaces),
    equipment: swap(p.equipment),
    conditions: swap(p.conditions),
    states: swap(p.states),
    machines: p.machines.map(({ machine: m }) => swap(m)),
  };
}

/* --- the test ---------------------------------------------------------------- */

test('Acceptance: rebuild the seed Sealer machine from an empty project, UI only', async ({
  page,
}) => {
  const seed = await loadProject(SEED_DIR);
  expect(seed.problems).toEqual([]);

  watchReloads(page);
  await page.goto('/studio');
  await expect(page.getByTestId('status-connection')).toContainText('Connected');
  await page.getByRole('menuitem', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: /New Project/ }).click();
  const projectName = `rebuild-${Date.now()}`;
  await page.getByTestId('dialog-input').fill(projectName);
  await page.getByTestId('dialog-ok').click();
  await expect(page.getByTestId('title-text')).toContainText(projectName);

  await buildLibrary(page);

  // 4. Condition templates, from term boxes and the variable picker.
  await openFromTree(page, 'Conditions');
  for (const c of CONDITIONS) {
    await createNamed(page, c.name);
    await fillCondition(page, c);
  }
  await expect(
    page.getByTestId('condition-card-PusherStuck').getByTestId('condition-summary'),
  ).toContainText(
    "IF( Cylinder.ICylinder.Extend AND NOT Cylinder.ICylinder.Extended AND timer.done('Watchdog') )",
  );
  await page.screenshot({ path: `${SHOTS}/rebuild-conditions.png` });

  // 5. State templates, with the + Add menu and action forms.
  await openFromTree(page, 'States');
  for (const st of STATES) {
    await createNamed(page, st.name);
    await fillState(page, st);
  }
  await expect(
    page.getByTestId('state-card-Push').getByTestId('group-onEntry').getByTestId('action-text'),
  ).toHaveText([
    'Conveyor.IMotor.SetRun(false)',
    'Pusher.ICylinder.SetExtend(true)',
    "Timer.Restart('Watchdog')",
  ]);
  await page.screenshot({ path: `${SHOTS}/rebuild-states.png` });

  // 6. The machine: instances, timers, states and conditions it uses, bindings.
  await openFromTree(page, 'Machines');
  await createNamed(page, 'Sealer');
  await composeSealer(page, true);

  // 7. The Planner (Phase 3): the machine's states are already on the canvas; draw the wiring.
  await openPlanner(page);
  await page.getByTestId('planner-fit').click();
  await wire(page, 'init-out-Sealer', 'in-Idle');
  const TRANSITIONS: [string, string, string][] = [
    ['Idle', 'Feed', 'StartPressed'],
    ['Feed', 'Push', 'BoxArrived'],
    ['Push', 'Seal', 'PusherOut'],
    ['Seal', 'Release', 'SealDone'],
    ['Release', 'Feed', 'PusherHome'],
    ['Faulted', 'Idle', 'ResetPressed'],
  ];
  for (const [from, to, cond] of TRANSITIONS) {
    await wire(page, `out-${from}`, `in-${to}`);
    await setCondition(page, `chip-${from}-${to}`, cond); // the instance the composer already bound
    await expect(page.getByTestId(`chip-${from}-${to}`)).toHaveText(cond);
  }
  await setCondition(page, 'slot-abort-Sealer-1', 'PusherStuck');
  await wire(page, 'abort-out-abort-Sealer-1', 'in-Faulted');
  await setCondition(page, 'slot-trigger-Sealer-1', 'StopPressed');
  await setCondition(page, 'slot-resume-Sealer-1', 'StartPressed');
  // The hold action: the same action form as in the States editor, on the machine's real devices.
  await page.getByTestId('hold-trigger-Sealer-1').click();
  const hold = page.getByTestId('hold-dialog').getByTestId('group-onHold');
  await hold.getByTestId('add-action').click();
  await hold.getByTestId('add-equipment').click();
  await hold.getByTestId('action-target').selectOption({ label: 'Conveyor.IMotor.Run' });
  await hold.getByTestId('action-value').selectOption('false');
  await expect(hold.getByTestId('action-text')).toHaveText(['Conveyor.IMotor.SetRun(false)']);
  await page.getByTestId('hold-close').click();
  await expect(page.getByTestId('hold-trigger-Sealer-1')).toHaveText('hold: 1');

  // Nothing is left for the validator to complain about.
  await expect(page.getByTestId('problem-row')).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/rebuild-planner.png` });

  // 8. Save, then compare what is on disk with the seed: library, machine and wiring.
  await page.getByTestId('planner-save').click();
  await expect(page.getByTestId('status-saved')).toContainText('No unsaved');
  const saved = (await (await page.request.get('/api/project')).json()) as { project: Project };
  expect(saved.project.info.name).toBe(projectName);
  expect(comparable(saved.project)).toEqual(comparable(seed.project!));

  // 9. The engine runs the rebuilt machine: Start, a box arrives, it is pushed.
  const engine = new Engine(saved.project);
  engine.step(1);
  expect(engine.machine('Sealer').state).toBe('Idle');
  engine.inject('Global.Start', true);
  engine.step(1);
  expect(engine.machine('Sealer').state).toBe('Feed');
  engine.inject('Sealer.BoxAtStop.ISensor.Present', true);
  engine.step(1);
  expect(engine.machine('Sealer').state).toBe('Push');
});
