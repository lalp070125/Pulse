import { expect, test } from '@playwright/test';
import { Engine, type Project } from '@pulso/core';
import { addMachine, addState, newProject, openPlanner, setCondition, wire } from './helpers';
import {
  CONDITIONS,
  STATES,
  buildLibrary,
  composeSealer,
  fillCondition,
  fillState,
  openFromTree,
} from './sealer';

/* ----------------------------------------------------------------------------
 * Phase 3 acceptance (SPEC 14): draw the two-machine demo from placeholders,
 * construct it, save, and the engine runs it. UI only.
 *
 * The two machines coordinate through inState(...) and globals; the ToSealer queue
 * of SPEC 12 arrives with queues in Phase 6 (owner decision).
 * -------------------------------------------------------------------------- */

test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(300_000);
const SHOTS = 'test-results/screens';

const SEALER = ['Idle', 'Feed', 'Push', 'Seal', 'Release', 'Faulted'];
const SEALER_WIRES: [string, string, string][] = [
  ['Idle', 'Feed', 'StartPressed'],
  ['Feed', 'Push', 'BoxArrived'],
  ['Push', 'Seal', 'PusherOut'],
  ['Seal', 'Release', 'SealDone'],
  ['Release', 'Feed', 'PusherHome'],
  ['Faulted', 'Idle', 'ResetPressed'],
];
const INFEED = ['Off', 'Gap', 'Handover'];
const INFEED_WIRES: [string, string, string][] = [
  ['Off', 'Gap', 'StartPressed'],
  ['Gap', 'Handover', 'GapDone'],
  ['Handover', 'Gap', 'SealerPushing'],
];
const INFEED_CONDITIONS: (typeof CONDITIONS)[number][] = [
  {
    name: 'GapDone',
    description: 'The gap between two boxes has passed.',
    roles: [['Gap', 'timer']],
    terms: ["timer.done('Gap')"],
  },
  {
    name: 'SealerPushing',
    description: 'The Sealer has taken the box (it is pushing it).',
    roles: [],
    terms: ['inState(Sealer, Push)'],
  },
];
const INFEED_STATES: (typeof STATES)[number][] = [
  { name: 'Off', description: 'Waiting for Start.', roles: [] },
  {
    name: 'Gap',
    description: 'Waiting the gap time before the next box.',
    roles: [['Gap', 'timer']],
    onEntry: [{ restart: 'Gap' }],
  },
  { name: 'Handover', description: 'A box is ready; wait until the Sealer takes it.', roles: [] },
];

test('Phase 3 acceptance: two machines drawn from placeholders, constructed, saved, run by the engine', async ({
  page,
}) => {
  await newProject(page, 'demo');
  // The devices and globals (Phase 2 editors). No states or conditions exist yet.
  await buildLibrary(page);

  // 1. Draw both machines from placeholders.
  await openPlanner(page);
  await addMachine(page, 'Sealer');
  for (const s of SEALER) await addState(page, 'Sealer', s);
  await addMachine(page, 'Infeed');
  for (const s of INFEED) await addState(page, 'Infeed', s);
  await expect(page.getByTestId('state-node-Idle')).toContainText('[Idle]');
  await page.getByTestId('planner-fit').click();

  await wire(page, 'init-out-Sealer', 'in-Idle');
  await wire(page, 'init-out-Infeed', 'in-Off');
  await expect(page.getByTestId('problem-row').filter({ hasText: 'Init node' })).toHaveCount(2); // the validator ignores placeholders
  for (const [from, to, cond] of SEALER_WIRES) {
    await wire(page, `out-${from}`, `in-${to}`);
    await setCondition(page, `chip-${from}-${to}`, cond);
    await expect(page.getByTestId(`chip-${from}-${to}`)).toHaveText(`[${cond}]`);
  }
  await setCondition(page, 'slot-abort-Sealer-1', 'PusherStuck');
  await wire(page, 'abort-out-abort-Sealer-1', 'in-Faulted');
  await setCondition(page, 'slot-trigger-Sealer-1', 'StopPressed');
  await setCondition(page, 'slot-resume-Sealer-1', 'StartPressed');

  for (const [from, to, cond] of INFEED_WIRES) {
    await wire(page, `out-${from}`, `in-${to}`);
    await setCondition(page, `chip-${from}-${to}`, cond);
  }
  await expect(page.getByTestId('planner-footer')).toHaveText('Machines: 2 | Unsaved: 2');
  await page.screenshot({ path: `${SHOTS}/acceptance-placeholders.png` });
  await page.getByTestId('planner-save').click();
  await expect(page.getByTestId('planner-footer')).toHaveText('Machines: 2 | Unsaved: 0');

  // 2. Construct each machine. The second one reuses StartPressed instead of making a copy.
  await page.getByTestId('machine-head-Sealer').click({ button: 'right' });
  await page.getByTestId('menu-construct').click();
  await expect(page.getByTestId('messages')).toContainText(
    'Construct Sealer: created states Idle, Feed, Push, Seal, Release, Faulted; created conditions StartPressed, BoxArrived, PusherOut, SealDone, PusherHome, ResetPressed, PusherStuck, StopPressed.',
  );
  await page.getByTestId('machine-head-Infeed').click({ button: 'right' });
  await page.getByTestId('menu-construct').click();
  await expect(page.getByTestId('messages')).toContainText(
    'Construct Infeed: created states Off, Gap, Handover; created conditions GapDone, SealerPushing; reused conditions StartPressed.',
  );
  await expect(page.getByTestId('state-node-Idle')).not.toHaveClass(/placeholder/);
  await expect(page.getByTestId('chip-Gap-Handover')).toHaveText('GapDone');

  // 3. Build the skeletons with the Phase 2 editors: every "TO DO" gets its rule, states their actions.
  await openFromTree(page, 'Conditions');
  for (const c of [...CONDITIONS, ...INFEED_CONDITIONS]) await fillCondition(page, c);
  await expect(
    page.getByTestId('condition-card-SealerPushing').getByTestId('condition-summary'),
  ).toContainText('IF( inState(Sealer, Push) )');
  await openFromTree(page, 'States');
  for (const s of [...STATES, ...INFEED_STATES]) await fillState(page, s);

  // 4. Devices, timers and bindings in the composer.
  await openFromTree(page, 'Machines');
  await composeSealer(page, false);
  const infeed = page.getByTestId('machine-card-Infeed');
  await infeed.getByTestId('add-timer').click();
  await infeed.getByTestId('timer-name').fill('Gap');
  await infeed.getByTestId('timer-preset-ms').fill('500');
  await infeed.getByTestId('auto-bind').click();
  await expect(infeed.getByTestId('unbound-count')).toHaveText('All roles bound');

  // 5. The hold action of the Stop interrupt, on the Planner.
  await openPlanner(page);
  await page.getByTestId('planner-fit').click();
  await page.getByTestId('hold-trigger-Sealer-1').click();
  const hold = page.getByTestId('hold-dialog').getByTestId('group-onHold');
  await hold.getByTestId('add-action').click();
  await hold.getByTestId('add-equipment').click();
  await hold.getByTestId('action-target').selectOption({ label: 'Conveyor.IMotor.Run' });
  await hold.getByTestId('action-value').selectOption('false');
  await page.getByTestId('hold-close').click();

  // 6. No problems left; save.
  await expect(page.getByTestId('problem-row')).toHaveCount(0);
  await page.getByTestId('planner-fit').click();
  await page.screenshot({ path: `${SHOTS}/acceptance-constructed.png` });
  await page.getByTestId('planner-save').click();
  await expect(page.getByTestId('status-saved')).toContainText('No unsaved');

  // 7. The engine runs what was saved: both machines, coordinating through inState(...).
  const saved = (await (await page.request.get('/api/project')).json()) as { project: Project };
  expect(saved.project.machines.every((m) => m.plan.placeholders === undefined)).toBe(true);
  const engine = new Engine(saved.project);
  const state = (m: string) => engine.machine(m).state;
  engine.step(1);
  expect([state('Sealer'), state('Infeed')]).toEqual(['Idle', 'Off']);
  engine.inject('Global.Start', true);
  engine.step(1);
  expect([state('Sealer'), state('Infeed')]).toEqual(['Feed', 'Gap']);
  engine.runForMs(600); // the 500 ms gap passes
  expect([state('Sealer'), state('Infeed')]).toEqual(['Feed', 'Handover']);
  engine.inject('Sealer.BoxAtStop.ISensor.Present', true);
  engine.step(2);
  expect(state('Sealer')).toBe('Push');
  expect(state('Infeed')).toBe('Gap'); // it saw the Sealer take the box
  // The pusher extends (simulated 400 ms), the seal runs, the cycle goes on.
  engine.inject('Sealer.BoxAtStop.ISensor.Present', false);
  engine.runForMs(500);
  expect(state('Sealer')).toBe('Seal');
});
