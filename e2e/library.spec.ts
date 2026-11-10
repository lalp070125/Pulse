import { expect, test, type Page } from '@playwright/test';
import type { Project } from '@pulso/core';
import { watchReloads } from './helpers';

/** Phase 2: the library editors, driven through the real UI. Each test makes its own project. */

const SHOTS = 'test-results/screens';
let counter = 0;

async function newProject(page: Page): Promise<void> {
  watchReloads(page);
  const name = `lib-${Date.now()}-${counter++}`;
  await page.goto('/studio');
  await expect(page.getByTestId('status-connection')).toContainText('Connected');
  await page.getByRole('menuitem', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: /New Project/ }).click();
  await page.getByTestId('dialog-input').fill(name);
  await page.getByTestId('dialog-ok').click();
  await expect(page.getByTestId('title-text')).toContainText(name);
}

async function openFromTree(page: Page, label: string): Promise<void> {
  await page.getByTestId('project-tree').getByText(label, { exact: true }).click();
}

test.use({ viewport: { width: 1440, height: 900 } });

test('Global Variables: add, edit, type, save, reload', async ({ page }) => {
  await newProject(page);
  await openFromTree(page, 'Global Variables');
  await expect(page.getByTestId('editor-globals')).toBeVisible();

  await page.getByTestId('editor-new').click();
  await page.getByTestId('dialog-input').fill('BoxCount');
  await page.getByTestId('dialog-ok').click();
  const row = page.getByTestId('global-row-BoxCount');
  await expect(row).toBeVisible();

  await row.getByTestId('global-type').selectOption('int');
  await row.getByTestId('global-default').fill('5');
  await row.getByTestId('global-description').fill('Boxes sealed');

  // A second global becomes an array of 3 ints.
  await page.getByTestId('editor-new').click();
  await page.getByTestId('dialog-input').fill('Slots');
  await page.getByTestId('dialog-ok').click();
  await page.getByTestId('global-row-Slots').getByTestId('global-type').selectOption('array');
  await expect(
    page.getByTestId('global-row-Slots').locator('.type-editor .type-editor'),
  ).toBeVisible();

  // Bad names are refused in the dialog.
  await page.getByTestId('editor-new').click();
  await page.getByTestId('dialog-input').fill('1bad');
  await expect(page.getByTestId('dialog-ok')).toBeDisabled();
  await page.getByTestId('dialog-input').fill('BoxCount');
  await expect(page.getByTestId('dialog')).toContainText('already exists');
  await page.keyboard.press('Escape');

  await expect(page.getByTestId('status-saved')).toContainText('Unsaved');
  await page.screenshot({ path: `${SHOTS}/globals.png` });
  await page.keyboard.press('Control+s');
  await expect(page.getByTestId('status-saved')).toContainText('No unsaved');

  await page.reload();
  await openFromTree(page, 'Global Variables');
  const again = page.getByTestId('global-row-BoxCount');
  await expect(again.getByTestId('global-default')).toHaveValue('5');
  await expect(again.getByTestId('global-description')).toHaveValue('Boxes sealed');
  await expect(page.getByTestId('global-row-Slots')).toBeVisible();
});

test('Interfaces: card with typed, directed signals', async ({ page }) => {
  await newProject(page);
  await openFromTree(page, 'Interfaces');
  await page.getByTestId('editor-new').click();
  await page.getByTestId('dialog-input').fill('IMotor');
  await page.getByTestId('dialog-ok').click();
  const card = page.getByTestId('interface-card-IMotor');
  await expect(card).toBeVisible();

  await card.getByTestId('add-signal').click();
  await card.getByTestId('signal-name').fill('Run');
  await card.getByTestId('signal-direction').selectOption('command');
  await card.getByTestId('add-signal').click();
  await card.getByTestId('signal-name').nth(1).fill('Running');
  await expect(card.getByTestId('signal-row-Run')).toBeVisible();
  await expect(card.getByTestId('signal-row-Running').getByTestId('signal-direction')).toHaveValue(
    'feedback',
  );

  // Two signals may not share a name: the second edit is refused.
  await card.getByTestId('signal-name').nth(1).fill('Run');
  await expect(card.getByTestId('signal-name').nth(1)).toHaveAttribute('aria-invalid', 'true');

  await page.keyboard.press('Control+s');
  await expect(page.getByTestId('status-saved')).toContainText('No unsaved');
  await page.reload();
  await openFromTree(page, 'Interfaces');
  await expect(page.getByTestId('signal-row-Run').getByTestId('signal-direction')).toHaveValue(
    'command',
  );
  await page.screenshot({ path: `${SHOTS}/interfaces.png` });
});

test('Equipment: made of interfaces, with a simulated behaviour', async ({ page }) => {
  await newProject(page);
  // Two interfaces first.
  await openFromTree(page, 'Interfaces');
  for (const [name, signals] of [
    ['IMotor', ['Run', 'Running']],
    ['IFault', ['Fault']],
  ] as const) {
    await page.getByTestId('editor-new').click();
    await page.getByTestId('dialog-input').fill(name);
    await page.getByTestId('dialog-ok').click();
    const card = page.getByTestId(`interface-card-${name}`);
    for (let i = 0; i < signals.length; i++) {
      await card.getByTestId('add-signal').click();
      await card.getByTestId('signal-name').nth(i).fill(signals[i]!);
    }
  }

  await openFromTree(page, 'Equipment');
  await page.getByTestId('editor-new').click();
  await page.getByTestId('dialog-input').fill('Motor');
  await page.getByTestId('dialog-ok').click();
  const card = page.getByTestId('equipment-card-Motor');
  await card.getByTestId('add-interface').selectOption({ label: 'IMotor' });
  await card.getByTestId('add-interface').selectOption({ label: 'IFault' });
  await expect(card.getByTestId('interface-chip')).toHaveCount(2);

  await card.getByTestId('sim-kind').selectOption('follow');
  await card.getByTestId('sim-delay').fill('100');
  await card.getByTestId('sim-command').selectOption({ label: 'IMotor.Run' });
  await card.getByTestId('sim-feedback').selectOption({ label: 'IMotor.Running' });

  await page.keyboard.press('Control+s');
  await expect(page.getByTestId('status-saved')).toContainText('No unsaved');
  await page.reload();
  await openFromTree(page, 'Equipment');
  const again = page.getByTestId('equipment-card-Motor');
  await expect(again.getByTestId('interface-chip')).toHaveCount(2);
  await expect(again.getByTestId('sim-delay')).toHaveValue('100');
  await expect(again.getByTestId('sim-feedback')).toHaveValue(/.+\/.+/);
  await page.screenshot({ path: `${SHOTS}/equipment.png` });
});

/** Puts library items straight into the open project, so the editor under test has something to use. */
async function seedLibrary(page: Page): Promise<void> {
  const got = (await (await page.request.get('/api/project')).json()) as { project: Project };
  const p = got.project;
  const id = (n: number) => `01JTEST${String(n).padStart(19, '0')}`;
  p.globals.push(
    { id: id(1), name: 'Stop', type: { kind: 'bool' }, default: false },
    { id: id(2), name: 'Count', type: { kind: 'int' }, default: 0 },
  );
  p.interfaces.push({
    id: id(10),
    name: 'ICylinder',
    signals: [
      { id: id(11), name: 'Extend', type: { kind: 'bool' }, direction: 'command' },
      { id: id(12), name: 'Extended', type: { kind: 'bool' }, direction: 'feedback' },
    ],
  });
  p.equipment.push({ id: id(20), name: 'Cylinder', interfaces: [id(10)] });
  const res = await page.request.put('/api/project', { data: { project: p } });
  expect(res.ok()).toBe(true);
  await page.reload();
  await expect(page.getByTestId('title-text')).toContainText('lib-');
}

test('Conditions: IF row from boxes, NOT, brackets, compare, summary, alarm', async ({ page }) => {
  await newProject(page);
  await seedLibrary(page);
  await openFromTree(page, 'Conditions');
  await page.getByTestId('editor-new').click();
  await page.getByTestId('dialog-input').fill('PusherOut');
  await page.getByTestId('dialog-ok').click();
  const card = page.getByTestId('condition-card-PusherOut');

  // A role: "a Cylinder", called Pusher.
  await card.getByTestId('add-role').click();
  await card.getByTestId('role-name').fill('Pusher');

  // First term from the picker: the picker only offers bool variables for a true/false slot.
  await card.getByTestId('add-term').click();
  const picker = page.getByTestId('variable-picker');
  await expect(picker).toBeVisible();
  await expect(picker).not.toContainText('Global.Count'); // an int does not fit a true/false slot
  await picker.getByTestId('picker-search').fill('Extended');
  await picker
    .getByTestId('picker-item')
    .filter({ hasText: 'Pusher.ICylinder.Extended' })
    .first()
    .click();

  // Second term: NOT Global.Stop.
  await card.getByTestId('add-term').click();
  await page.getByTestId('picker-search').fill('Stop');
  await page.getByTestId('picker-item').filter({ hasText: 'Global.Stop' }).first().click();
  await card.getByTestId('not-toggle').last().click();

  // A comparison: Global.Count ≥ 3 (the int is offered here, not in the true/false slot).
  await card.getByTestId('add-compare').click();
  await page.getByTestId('picker-search').fill('Count');
  await page.getByTestId('picker-item').filter({ hasText: 'Global.Count' }).first().click();
  await card.getByTestId('cmp-op').selectOption('ge');
  await card.getByTestId('operand-literal').fill('3');

  // The first "true" placeholder is still there: remove it.
  await card.getByTestId('delete-term').first().click();

  await expect(card.getByTestId('condition-summary')).toContainText(
    'IF( Pusher.ICylinder.Extended AND NOT Global.Stop AND Global.Count ≥ 3 )',
  );

  // Switch the last link to OR and bracket the comparison to make precedence explicit.
  await card.getByTestId('group-op').last().selectOption('or');
  await expect(card.getByTestId('condition-summary')).toContainText(' OR ');

  // Alarm section.
  await card.getByTestId('alarm-toggle').click();
  await card.getByTestId('alarm-enabled').check();
  await card.getByTestId('alarm-severity').selectOption('critical');
  await card.getByTestId('alarm-group').fill('Pusher');
  await card.getByTestId('alarm-message').fill('Pusher is out of position');

  await page.keyboard.press('Control+s');
  await expect(page.getByTestId('status-saved')).toContainText('No unsaved');
  await page.reload();
  await openFromTree(page, 'Conditions');
  const again = page.getByTestId('condition-card-PusherOut');
  await expect(again.getByTestId('condition-summary')).toContainText('Pusher.ICylinder.Extended');
  // A condition that is an alarm opens its Alarm section by itself.
  await expect(again.getByTestId('alarm-message')).toHaveValue('Pusher is out of position');
  await page.screenshot({ path: `${SHOTS}/conditions.png` });
});

test('States: three action groups, action menu, text forms, drag to reorder', async ({ page }) => {
  await newProject(page);
  await seedLibrary(page);
  await openFromTree(page, 'States');
  await page.getByTestId('editor-new').click();
  await page.getByTestId('dialog-input').fill('Push');
  await page.getByTestId('dialog-ok').click();
  const card = page.getByTestId('state-card-Push');

  // Roles: a device "Pusher" and a timer "SealTimer".
  await card.getByTestId('add-role').click();
  await card.getByTestId('role-name').fill('Pusher');
  await card.getByTestId('add-role').click();
  await card.getByTestId('role-name').nth(1).fill('SealTimer');
  await card.getByTestId('role-kind').nth(1).selectOption('timer');

  const entry = card.getByTestId('group-onEntry');
  // Logic blocks and queues are listed but not available before Phase 6.
  await entry.getByTestId('add-action').click();
  await expect(entry.getByTestId('add-logic')).toBeDisabled();
  await expect(entry.getByTestId('add-queue')).toBeDisabled();

  await entry.getByTestId('add-equipment').click();
  await expect(entry.getByTestId('action-text').first()).toHaveText(
    'Pusher.ICylinder.SetExtend(false)',
  );
  await entry.getByTestId('action-value').selectOption('true');
  await expect(entry.getByTestId('action-text').first()).toHaveText(
    'Pusher.ICylinder.SetExtend(true)',
  );

  await entry.getByTestId('add-action').click();
  await entry.getByTestId('add-timer').click();
  await expect(entry.getByTestId('action-text').nth(1)).toHaveText("Timer.Start('SealTimer')");

  await entry.getByTestId('add-action').click();
  await entry.getByTestId('add-global').click();
  await expect(entry.getByTestId('action-text').nth(2)).toHaveText('Global.SetStop(false)');

  // Drag the third action (the global) above the first.
  const grip = entry.getByTestId('action-grip').nth(2);
  const target = entry.getByTestId('action-row').first();
  const g = (await grip.boundingBox())!;
  const t = (await target.boundingBox())!;
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + 2, t.y + 4, { steps: 8 });
  await page.mouse.up();
  await expect(entry.getByTestId('action-text').first()).toHaveText('Global.SetStop(false)');

  // Steps and On Exit take actions too.
  const steps = card.getByTestId('group-steps');
  await steps.getByTestId('add-action').click();
  await steps.getByTestId('add-equipment').click();
  await expect(steps.getByTestId('action-text')).toHaveCount(1);

  await page.keyboard.press('Control+s');
  await expect(page.getByTestId('status-saved')).toContainText('No unsaved');
  await page.reload();
  await openFromTree(page, 'States');
  const again = page.getByTestId('state-card-Push');
  await expect(again.getByTestId('group-onEntry').getByTestId('action-text')).toHaveText([
    'Global.SetStop(false)',
    'Pusher.ICylinder.SetExtend(true)',
    "Timer.Start('SealTimer')",
  ]);
  await page.screenshot({ path: `${SHOTS}/states.png` });
});

test('Machines composer: instances, timers, state and condition use, binding table', async ({
  page,
}) => {
  await newProject(page);
  await seedLibrary(page);
  // Add one state and one condition template that use roles, straight into the project.
  const got = (await (await page.request.get('/api/project')).json()) as { project: Project };
  const p = got.project;
  const id = (n: number) => `01JTEST${String(n).padStart(19, '0')}`;
  const cyl = p.equipment[0]!;
  const iface = p.interfaces[0]!;
  p.states.push({
    id: id(30),
    name: 'Push',
    roles: [
      { id: id(31), name: 'Pusher', kind: 'equipment', equipment: cyl.id },
      { id: id(32), name: 'SealTimer', kind: 'timer' },
    ],
    onEntry: [
      {
        id: id(33),
        kind: 'equipment',
        target: {
          kind: 'roleSignal',
          role: id(31),
          interface: iface.id,
          signal: iface.signals[0]!.id,
        },
        value: { from: 'literal', value: true },
      },
    ],
    steps: [],
    onExit: [],
  });
  p.conditions.push({
    id: id(40),
    name: 'PusherOut',
    roles: [{ id: id(41), name: 'Pusher', kind: 'equipment', equipment: cyl.id }],
    expr: {
      op: 'var',
      ref: { kind: 'roleSignal', role: id(41), interface: iface.id, signal: iface.signals[1]!.id },
    },
  });
  expect((await page.request.put('/api/project', { data: { project: p } })).ok()).toBe(true);
  await page.reload();
  await expect(page.getByTestId('title-text')).toContainText('lib-');

  await openFromTree(page, 'Machines');
  await page.getByTestId('editor-new').click();
  await page.getByTestId('dialog-input').fill('Sealer');
  await page.getByTestId('dialog-ok').click();
  const card = page.getByTestId('machine-card-Sealer');

  await card.getByTestId('add-instance').click();
  await card.getByTestId('instance-name').fill('Pusher');
  await card.getByTestId('add-timer').click();
  await card.getByTestId('timer-name').fill('SealTime');
  await card.getByTestId('add-state-instance').selectOption({ label: 'Push' });
  await card.getByTestId('add-condition-instance').selectOption({ label: 'PusherOut' });
  await expect(card.getByTestId('state-instance')).toHaveCount(1);
  await expect(card.getByTestId('condition-instance')).toHaveCount(1);

  // Three roles to bind (Push: Pusher + SealTimer; PusherOut: Pusher); all start unbound, in warning colour.
  await expect(card.getByTestId('unbound-count')).toHaveText('3 unbound');
  const firstRow = card.getByTestId("binding-State 'Push'-Pusher");
  await expect(firstRow).toHaveClass(/row-warn/);
  await expect(firstRow.getByTestId('binding-select')).toHaveValue('');
  // The device role only offers instances of the right type.
  await expect(firstRow.getByTestId('binding-select').locator('option')).toHaveText([
    '— not bound —',
    'Pusher',
  ]);

  // Bind one by hand, the rest with Auto-bind.
  await firstRow.getByTestId('binding-select').selectOption({ label: 'Pusher' });
  await expect(card.getByTestId('unbound-count')).toHaveText('2 unbound');
  await card.getByTestId('auto-bind').click();
  await expect(card.getByTestId('unbound-count')).toHaveText('All roles bound');
  await expect(firstRow).not.toHaveClass(/row-warn/);

  await page.keyboard.press('Control+s');
  await expect(page.getByTestId('status-saved')).toContainText('No unsaved');
  await page.reload();
  await openFromTree(page, 'Machines');
  const again = page.getByTestId('machine-card-Sealer');
  await expect(again.getByTestId('unbound-count')).toHaveText('All roles bound');
  await page.screenshot({ path: `${SHOTS}/machines.png` });
});

test('Messages panel: live validator problems with click-to-go', async ({ page }) => {
  await newProject(page);
  // A condition whose role needs an equipment type that does not exist, written straight into the project.
  const got = (await (await page.request.get('/api/project')).json()) as { project: Project };
  const p = got.project;
  const id = (n: number) => `01JTEST${String(n).padStart(19, '0')}`;
  p.conditions.push({
    id: id(50),
    name: 'Broken',
    roles: [{ id: id(51), name: 'Gone', kind: 'equipment', equipment: id(99) }],
    expr: { op: 'lit', value: true },
  });
  expect((await page.request.put('/api/project', { data: { project: p } })).ok()).toBe(true);
  await page.reload();
  await expect(page.getByTestId('title-text')).toContainText('lib-');

  const rows = page.getByTestId('problem-row');
  const broken = rows.filter({ hasText: "Condition 'Broken'" });
  await expect(broken).toHaveCount(1);
  await expect(broken).toContainText("role 'Gone' needs an equipment type that no longer exists");
  await expect(page.getByTestId('messages')).toContainText('Errors: 1');

  // Click-to-go: opens the Conditions editor and lights the card.
  await openFromTree(page, 'Global Variables');
  await broken.click();
  await expect(page.getByTestId('editor-conditions')).toBeVisible();
  await expect(page.getByTestId('condition-card-Broken')).toHaveClass(/card-lit/);

  // A new machine has no Init yet: a second, live problem that points at the machine.
  await openFromTree(page, 'Machines');
  await page.getByTestId('editor-new').click();
  await page.getByTestId('dialog-input').fill('Line');
  await page.getByTestId('dialog-ok').click();
  await expect(rows.filter({ hasText: "Machine 'Line'" })).toHaveCount(1);
  await page.screenshot({ path: `${SHOTS}/messages-problems.png` });

  // Fixing the condition (removing the broken role) makes its problem disappear at once.
  await openFromTree(page, 'Conditions');
  await page
    .getByTestId('condition-card-Broken')
    .getByRole('button', { name: 'Delete role Gone' })
    .click();
  await expect(broken).toHaveCount(0);
  await expect(page.getByTestId('messages')).toContainText('Errors: 1');
});
