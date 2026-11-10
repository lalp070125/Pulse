import { expect, test, type Page } from '@playwright/test';
import { addMachine, addState, newProject, openPlanner, setCondition, wire } from './helpers';
import type { Project } from '@pulso/core';
import { buildBoxSealer } from '../packages/runtime/src/seed/boxSealer';

/* Phase 3: the Planner canvas, driven through the real UI. Each test makes its own project. */

test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(120_000);

const SHOTS = 'test-results/screens';

/** Puts a copy of the seed project (Sealer, fully wired) into the open project. */
async function loadSeed(page: Page): Promise<void> {
  const got = (await (await page.request.get('/api/project')).json()) as { project: Project };
  const seed = buildBoxSealer();
  seed.info = got.project.info;
  expect((await page.request.put('/api/project', { data: { project: seed } })).ok()).toBe(true);
  await page.reload();
  await expect(page.getByTestId('status-connection')).toContainText('Connected');
}

test('Planner shows the seed Sealer: box, Init, states, wires with priorities and labels, blocks', async ({
  page,
}) => {
  await newProject(page);
  await loadSeed(page);
  await openPlanner(page);
  await expect(page.getByTestId('machine-box-Sealer')).toBeVisible();
  for (const s of ['Idle', 'Feed', 'Push', 'Seal', 'Release', 'Faulted']) {
    await expect(page.getByTestId(`state-node-${s}`)).toBeVisible();
  }
  await expect(page.getByTestId('chip-Idle-Feed')).toHaveText('StartPressed');
  await expect(page.getByTestId('badge-Idle-Feed')).toHaveText('1');
  await expect(page.getByTestId('chip-Release-Feed')).toHaveText('PusherHome');
  await expect(page.getByTestId('slot-abort-Sealer-1')).toHaveText('PusherStuck');
  await expect(page.getByTestId('slot-trigger-Sealer-1')).toHaveText('StopPressed');
  await expect(page.getByTestId('slot-resume-Sealer-1')).toHaveText('StartPressed');
  await expect(page.getByTestId('hold-trigger-Sealer-1')).toHaveText('hold: 1');
  await expect(page.getByTestId('planner-footer')).toHaveText('Machines: 1 | Unsaved: 0');
  await page.screenshot({ path: `${SHOTS}/planner-seed.png` });
});

test('Planner: draw from placeholders, wire, priorities, undo/redo, save, Construct, delete, copy/paste', async ({
  page,
}) => {
  await newProject(page);
  await openPlanner(page);
  await expect(page.getByTestId('planner-empty')).toBeVisible();
  await expect(page.getByTestId('planner-add-state')).toBeDisabled();

  // A machine and three placeholder states (no templates exist in this empty project).
  await addMachine(page, 'Line');
  await addState(page, 'Line', 'Warmup');
  await addState(page, 'Line', 'Running');
  await addState(page, 'Line', 'Stopped');
  await expect(page.getByTestId('state-node-Warmup')).toContainText('[Warmup]');
  await expect(page.getByTestId('state-node-Warmup')).toHaveClass(/placeholder/);
  await expect(page.getByTestId('machine-box-Line')).toContainText('3 to build');

  // Wires: Init → Warmup, then three transitions, one of them back up.
  await wire(page, 'init-out-Line', 'in-Warmup');
  await wire(page, 'out-Warmup', 'in-Running');
  await wire(page, 'out-Running', 'in-Stopped');
  await wire(page, 'out-Running', 'in-Warmup');
  await expect(page.getByTestId('chip-Warmup-Running')).toHaveText('(no condition)');
  await expect(page.getByTestId('badge-Running-Stopped')).toHaveText('1');
  await expect(page.getByTestId('badge-Running-Warmup')).toHaveText('2');

  // Conditions typed on the wires become [placeholders].
  await setCondition(page, 'chip-Warmup-Running', 'HeatDone');
  await setCondition(page, 'chip-Running-Stopped', 'StopPressed');
  await setCondition(page, 'chip-Running-Warmup', 'TooCold');
  await expect(page.getByTestId('chip-Warmup-Running')).toHaveText('[HeatDone]');

  // Renumber: Running → Warmup becomes priority 1, the other closes up to 2. Undo, redo.
  await page.getByTestId('badge-Running-Warmup').dblclick();
  await page.getByTestId('dialog-input').fill('1');
  await page.getByTestId('dialog-ok').click();
  await expect(page.getByTestId('badge-Running-Warmup')).toHaveText('1');
  await expect(page.getByTestId('badge-Running-Stopped')).toHaveText('2');
  await page.getByTestId('planner-undo').click();
  await expect(page.getByTestId('badge-Running-Warmup')).toHaveText('2');
  await page.getByTestId('planner-redo').click();
  await expect(page.getByTestId('badge-Running-Warmup')).toHaveText('1');

  // The abort block: a placeholder condition, wired to Stopped.
  await expect(page.getByTestId('slot-abort-Line-1')).toHaveText('(Unassigned)');
  await setCondition(page, 'slot-abort-Line-1', 'Overheat');
  await expect(page.getByTestId('slot-abort-Line-1')).toHaveText('[Overheat]');
  await wire(page, 'abort-out-abort-Line-1', 'in-Stopped');

  await expect(page.getByTestId('planner-footer')).toHaveText('Machines: 1 | Unsaved: 1');
  await page.screenshot({ path: `${SHOTS}/planner-placeholders.png` });
  await page.getByTestId('planner-save').click();
  await expect(page.getByTestId('planner-footer')).toHaveText('Machines: 1 | Unsaved: 0');
  await expect(page.getByTestId('status-saved')).toContainText('No unsaved');

  // Placeholders survive a reload (they live in plan.json).
  await page.reload();
  await openPlanner(page);
  await expect(page.getByTestId('state-node-Warmup')).toContainText('[Warmup]');
  await expect(page.getByTestId('chip-Running-Warmup')).toHaveText('[TooCold]');
  await expect(page.getByTestId('slot-abort-Line-1')).toHaveText('[Overheat]');

  // The validator does not read placeholders: to it the machine has no states and no Init yet.
  // Click-to-go takes us to the machine on the canvas.
  const problem = page
    .getByTestId('problem-row')
    .filter({ hasText: "Machine 'Line': the Init node" });
  await expect(problem).toHaveCount(1);
  await page.getByTestId('project-tree').getByText('Global Variables', { exact: true }).click();
  await problem.click();
  await expect(page.getByTestId('editor-planner')).toBeVisible();
  await expect(page.getByTestId('machine-box-Line')).toHaveClass(/selected/);

  // Construct Machine: everything becomes real; conditions are TO DO.
  await page.getByTestId('machine-head-Line').click({ button: 'right' });
  await expect(page.getByTestId('menu-construct')).toHaveText('Construct Machine');
  await page.getByTestId('menu-construct').click();
  await expect(page.getByTestId('messages')).toContainText(
    'Construct Line: created states Warmup, Running, Stopped; created conditions HeatDone, StopPressed, TooCold, Overheat.',
  );
  await expect(page.getByTestId('state-node-Warmup')).not.toHaveClass(/placeholder/);
  await expect(page.getByTestId('chip-Warmup-Running')).toHaveText('HeatDone');
  await expect(page.getByTestId('slot-abort-Line-1')).toHaveText('Overheat');
  await expect(problem).toHaveCount(0); // Init now points at a real state
  await expect(page.getByTestId('problem-row').filter({ hasText: 'TO DO' }).first()).toBeVisible();
  await page.getByTestId('machine-head-Line').click({ button: 'right' });
  await expect(page.getByTestId('menu-construct')).toHaveText('Add New Items');
  await expect(page.getByTestId('menu-construct')).toBeDisabled();
  await page.keyboard.press('Escape');

  // The library now holds the new templates; a condition shows its TO DO term.
  await page.getByTestId('project-tree').getByText('Conditions', { exact: true }).click();
  await expect(
    page.getByTestId('condition-card-HeatDone').getByTestId('condition-summary'),
  ).toContainText('IF( TO DO )');
  await page.getByTestId('project-tree').getByText('Planner', { exact: true }).click();

  // Copy and paste a state; delete a state with its wires.
  await page.getByTestId('state-node-Warmup').click();
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');
  await expect(page.getByTestId('state-node-Warmup2')).toBeVisible();
  await page.getByTestId('state-node-Stopped').click();
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('state-node-Stopped')).toHaveCount(0);
  await expect(page.getByTestId('chip-Running-Stopped')).toHaveCount(0);
  await expect(page.getByTestId('slot-abort-Line-1')).toHaveText('Overheat'); // the block stays, unwired

  // Collapse and expand the machine box; the Queues view is a Phase 6 placeholder.
  await page
    .getByTestId('machine-box-Line')
    .getByRole('button', { name: 'Collapse machine' })
    .click();
  await expect(page.getByTestId('state-node-Warmup')).toHaveCount(0);
  await page
    .getByTestId('machine-box-Line')
    .getByRole('button', { name: 'Expand machine' })
    .click();
  await expect(page.getByTestId('state-node-Warmup')).toBeVisible();
  await page.getByTestId('planner-view-queues').click();
  await expect(page.getByTestId('planner-queues')).toContainText('Phase 6');
  await page.getByTestId('planner-view-fsm').click();
  await expect(page.getByTestId('state-node-Warmup')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/planner-constructed.png` });
});

test('Planner: H / V / Exp junctions are drawing only; box-select and delete', async ({ page }) => {
  await newProject(page);
  await loadSeed(page);
  await openPlanner(page);
  await page.getByTestId('planner-fit').click();
  const before = ((await (await page.request.get('/api/project')).json()) as { project: Project })
    .project.machines[0]!.machine;

  // A combiner needs wires that end at one state: Idle → Feed and Release → Feed do.
  await page.getByTestId('chip-Idle-Feed').click();
  await page.getByTestId('chip-Release-Feed').click({ modifiers: ['Shift'] });
  await page.getByTestId('planner-h').click();
  await expect(page.getByTestId('junction-h')).toHaveCount(1);

  // An expander needs wires leaving one state; two wires that do not share one are refused.
  await page.getByTestId('chip-Feed-Push').click();
  await page.getByTestId('chip-Seal-Release').click({ modifiers: ['Shift'] });
  await page.getByTestId('planner-exp').click();
  await expect(page.getByTestId('messages')).toContainText(
    'An expander fans out wires that leave the same state.',
  );
  await expect(page.getByTestId('junction-exp')).toHaveCount(0);

  // The junction changes the drawing only: the logic saved is the same as before.
  await page.getByTestId('planner-save').click();
  await expect(page.getByTestId('status-saved')).toContainText('No unsaved');
  const after = ((await (await page.request.get('/api/project')).json()) as { project: Project })
    .project.machines[0]!;
  expect(after.machine).toEqual(before);
  expect(after.plan.junctions).toHaveLength(1);
  await page.screenshot({ path: `${SHOTS}/planner-junction.png` });

  // Box-select two states by dragging on empty canvas, then delete both (undo brings them back).
  const seal = (await page.getByTestId('state-node-Seal').boundingBox())!;
  const release = (await page.getByTestId('state-node-Release').boundingBox())!;
  const left = Math.min(seal.x, release.x) - 8;
  const top = Math.min(seal.y, release.y) - 8;
  const right = Math.max(seal.x + seal.width, release.x + release.width) + 8;
  const bottom = Math.max(seal.y + seal.height, release.y + release.height) + 8;
  await page.keyboard.down('Shift');
  await page.mouse.move(left, top);
  await page.mouse.down();
  await page.mouse.move(right, bottom, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect(page.getByTestId('state-node-Seal')).toHaveClass(/selected/);
  await expect(page.getByTestId('state-node-Release')).toHaveClass(/selected/);
  await page.getByTestId('planner-delete').click();
  await expect(page.getByTestId('state-node-Seal')).toHaveCount(0);
  await expect(page.getByTestId('state-node-Release')).toHaveCount(0);
  await page.getByTestId('planner-undo').click();
  await expect(page.getByTestId('state-node-Seal')).toBeVisible();
  await expect(page.getByTestId('chip-Seal-Release')).toHaveText('SealDone');
});
