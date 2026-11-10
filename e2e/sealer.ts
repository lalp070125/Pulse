import { expect, type Locator, type Page } from '@playwright/test';

/* ----------------------------------------------------------------------------
 * The seed's Sealer (SPEC 12), written as what a user types and clicks in the
 * Phase 2 editors. Used by the rebuild test and by the Phase 3 acceptance test.
 * -------------------------------------------------------------------------- */

export async function openFromTree(page: Page, label: string): Promise<void> {
  await page.getByTestId('project-tree').getByText(label, { exact: true }).click();
}

export async function createNamed(page: Page, name: string): Promise<void> {
  await page.getByTestId('editor-new').click();
  await page.getByTestId('dialog-input').fill(name);
  await page.getByTestId('dialog-ok').click();
}

/** Picks the item whose text is exactly `text` in the open variable picker. */
export async function pick(page: Page, text: string): Promise<void> {
  const picker = page.getByTestId('variable-picker');
  await picker.getByTestId('picker-search').fill(text);
  await picker
    .getByTestId('picker-item')
    .filter({ has: page.getByText(text, { exact: true }) })
    .click();
  await expect(picker).toBeHidden();
}

export type RoleSpec = [name: string, kind: 'device' | 'timer', equipment?: string];

export async function addRoles(card: Locator, roles: RoleSpec[]): Promise<void> {
  for (let i = 0; i < roles.length; i++) {
    const [name, kind, equipment] = roles[i]!;
    await card.getByTestId('add-role').click();
    await card.getByTestId('role-name').nth(i).fill(name);
    const row = card.getByTestId(`role-${name}`);
    if (kind === 'timer') await row.getByTestId('role-kind').selectOption('timer');
    else await row.getByTestId('role-equipment').selectOption({ label: equipment! });
  }
}

/* --- the seed, written as what a user would type --------------------------- */

export const INTERFACES: {
  name: string;
  description: string;
  signals: [name: string, direction: 'command' | 'feedback', description?: string][];
}[] = [
  {
    name: 'IMotor',
    description: 'A motor that can be switched on and reports that it runs.',
    signals: [
      ['Run', 'command', 'Switch the motor on'],
      ['Running', 'feedback', 'The motor is turning'],
    ],
  },
  {
    name: 'IFault',
    description: 'A device that can report its own fault.',
    signals: [['Fault', 'feedback']],
  },
  {
    name: 'ISensor',
    description: 'A presence sensor.',
    signals: [['Present', 'feedback', 'Something is in front of the sensor']],
  },
  {
    name: 'ICylinder',
    description: 'A pneumatic cylinder with end-position sensors.',
    signals: [
      ['Extend', 'command', 'Push out (false = pull back)'],
      ['Extended', 'feedback', 'Fully out'],
      ['Retracted', 'feedback', 'Fully back'],
    ],
  },
  { name: 'IIndicator', description: 'A lamp.', signals: [['On', 'command']] },
];

export const GLOBALS: [name: string, type: 'bool' | 'int', description: string, unit?: string][] = [
  ['Start', 'bool', 'Start button'],
  ['Stop', 'bool', 'Stop button'],
  ['Running', 'bool', 'The machine is producing'],
  ['BoxCount', 'int', 'Boxes sealed (counting arrives with logic blocks)', 'boxes'],
  ['FaultReset', 'bool', 'Fault reset button'],
];

export type ActionSpec =
  { eq: string; value: boolean } | { global: string; value: boolean } | { restart: string };

export const STATES: {
  name: string;
  description: string;
  roles: RoleSpec[];
  onEntry?: ActionSpec[];
  steps?: ActionSpec[];
  onExit?: ActionSpec[];
}[] = [
  {
    name: 'Idle',
    description: 'Waiting for Start. Everything off.',
    roles: [
      ['Conveyor', 'device', 'Motor'],
      ['Lamp', 'device', 'Indicator'],
    ],
    onEntry: [
      { eq: 'Conveyor.IMotor.Run', value: false },
      { global: 'Running', value: false },
      { eq: 'Lamp.IIndicator.On', value: false },
    ],
  },
  {
    name: 'Feed',
    description: 'Conveyor runs until a box reaches the stop.',
    roles: [
      ['Conveyor', 'device', 'Motor'],
      ['Lamp', 'device', 'Indicator'],
    ],
    onEntry: [
      { global: 'Running', value: true },
      { eq: 'Lamp.IIndicator.On', value: true },
    ],
    steps: [{ eq: 'Conveyor.IMotor.Run', value: true }],
  },
  {
    name: 'Push',
    description: 'Conveyor stops, the pusher moves the box under the seal head.',
    roles: [
      ['Conveyor', 'device', 'Motor'],
      ['Pusher', 'device', 'Cylinder'],
      ['Watchdog', 'timer'],
    ],
    onEntry: [
      { eq: 'Conveyor.IMotor.Run', value: false },
      { eq: 'Pusher.ICylinder.Extend', value: true },
      { restart: 'Watchdog' },
    ],
  },
  {
    name: 'Seal',
    description: 'The seal head presses for the seal time.',
    roles: [
      ['SealHead', 'device', 'Cylinder'],
      ['SealTimer', 'timer'],
    ],
    onEntry: [{ eq: 'SealHead.ICylinder.Extend', value: true }, { restart: 'SealTimer' }],
    onExit: [{ eq: 'SealHead.ICylinder.Extend', value: false }],
  },
  {
    name: 'Release',
    description: 'The pusher pulls back.',
    roles: [['Pusher', 'device', 'Cylinder']],
    onEntry: [{ eq: 'Pusher.ICylinder.Extend', value: false }],
  },
  {
    name: 'Faulted',
    description: 'Everything off, lamp on, wait for Fault Reset.',
    roles: [
      ['Conveyor', 'device', 'Motor'],
      ['Pusher', 'device', 'Cylinder'],
      ['SealHead', 'device', 'Cylinder'],
      ['Lamp', 'device', 'Indicator'],
    ],
    onEntry: [
      { eq: 'Conveyor.IMotor.Run', value: false },
      { eq: 'Pusher.ICylinder.Extend', value: false },
      { eq: 'SealHead.ICylinder.Extend', value: false },
      { global: 'Running', value: false },
      { eq: 'Lamp.IIndicator.On', value: true },
    ],
  },
];

export const CONDITIONS: {
  name: string;
  description: string;
  roles: RoleSpec[];
  /** Picker texts, joined with AND; a leading "!" switches NOT on. */
  terms: string[];
  alarm?: { group: string; message: string };
}[] = [
  {
    name: 'StartPressed',
    description: 'Start button pressed (rising edge).',
    roles: [],
    terms: ['rising(Global.Start)'],
  },
  {
    name: 'StopPressed',
    description: 'Stop button pressed (rising edge).',
    roles: [],
    terms: ['rising(Global.Stop)'],
  },
  {
    name: 'BoxArrived',
    description: 'A box is at the stop.',
    roles: [['Sensor', 'device', 'Sensor']],
    terms: ['Sensor.ISensor.Present'],
  },
  {
    name: 'PusherOut',
    description: 'The cylinder is fully extended.',
    roles: [['Cylinder', 'device', 'Cylinder']],
    terms: ['Cylinder.ICylinder.Extended'],
  },
  {
    name: 'SealDone',
    description: 'The timer has finished.',
    roles: [['Timer', 'timer']],
    terms: ["timer.done('Timer')"],
  },
  {
    name: 'PusherHome',
    description: 'The cylinder is fully retracted.',
    roles: [['Cylinder', 'device', 'Cylinder']],
    terms: ['Cylinder.ICylinder.Retracted'],
  },
  {
    name: 'PusherStuck',
    description:
      'Extend was commanded but the cylinder did not report Extended before the watchdog ran out.',
    roles: [
      ['Cylinder', 'device', 'Cylinder'],
      ['Watchdog', 'timer'],
    ],
    terms: ['Cylinder.ICylinder.Extend', '!Cylinder.ICylinder.Extended', "timer.done('Watchdog')"],
    alarm: { group: 'Sealer', message: 'Pusher did not extend within 2 s' },
  },
  {
    name: 'ResetPressed',
    description: 'Fault Reset pressed (rising edge).',
    roles: [],
    terms: ['rising(Global.FaultReset)'],
  },
];

/** Steps 1-3 of the seed: interfaces, equipment with simulation, globals. */
export async function buildLibrary(page: Page): Promise<void> {
  // 1. Interfaces.
  await openFromTree(page, 'Interfaces');
  for (const i of INTERFACES) {
    await createNamed(page, i.name);
    const card = page.getByTestId(`interface-card-${i.name}`);
    await card.getByPlaceholder('what kind of connection this describes').fill(i.description);
    for (let n = 0; n < i.signals.length; n++) {
      const [name, direction, description] = i.signals[n]!;
      await card.getByTestId('add-signal').click();
      await card.getByTestId('signal-name').nth(n).fill(name);
      const row = card.getByTestId(`signal-row-${name}`);
      await row.getByTestId('signal-direction').selectOption(direction);
      if (description) await row.getByPlaceholder('what it is for').fill(description);
    }
  }

  // 2. Equipment, with simulated behaviour.
  await openFromTree(page, 'Equipment');
  const EQUIPMENT: [string, string[], string?][] = [
    [
      'Motor',
      ['IMotor', 'IFault'],
      'Motor with fault feedback. Simulated: Running follows Run after 100 ms.',
    ],
    ['Sensor', ['ISensor']],
    ['Cylinder', ['ICylinder'], 'Simulated: takes 400 ms to travel out or back.'],
    ['Indicator', ['IIndicator']],
  ];
  for (const [name, ifaces, description] of EQUIPMENT) {
    await createNamed(page, name);
    const card = page.getByTestId(`equipment-card-${name}`);
    if (description) await card.getByPlaceholder('what this device is').fill(description);
    for (const i of ifaces) await card.getByTestId('add-interface').selectOption({ label: i });
  }
  {
    const motor = page.getByTestId('equipment-card-Motor');
    await motor.getByTestId('sim-kind').selectOption('follow');
    await motor.getByTestId('sim-command').selectOption({ label: 'IMotor.Run' });
    await motor.getByTestId('sim-feedback').selectOption({ label: 'IMotor.Running' });
    await motor.getByTestId('sim-delay').fill('100');
    const cyl = page.getByTestId('equipment-card-Cylinder');
    await cyl.getByTestId('sim-kind').selectOption('cylinder');
    await cyl.getByTestId('sim-command').selectOption({ label: 'ICylinder.Extend' });
    await cyl.getByTestId('sim-extended').selectOption({ label: 'ICylinder.Extended' });
    await cyl.getByTestId('sim-retracted').selectOption({ label: 'ICylinder.Retracted' });
    await cyl.getByTestId('sim-travel').fill('400');
  }

  // 3. Global variables.
  await openFromTree(page, 'Global Variables');
  for (const [name, type, description, unit] of GLOBALS) {
    await createNamed(page, name);
    const row = page.getByTestId(`global-row-${name}`);
    if (type !== 'bool') await row.getByTestId('global-type').selectOption(type);
    if (unit) await row.getByPlaceholder('unit').fill(unit);
    await row.getByTestId('global-description').fill(description);
  }
}

/** Fills in a condition card: description, roles, the IF row from the picker, the alarm. */
export async function fillCondition(page: Page, c: (typeof CONDITIONS)[number]): Promise<void> {
  const card = page.getByTestId(`condition-card-${c.name}`);
  await card.getByPlaceholder('what this rule means').fill(c.description);
  await addRoles(card, c.roles);
  for (let n = 0; n < c.terms.length; n++) {
    const raw = c.terms[n]!;
    const negate = raw.startsWith('!');
    // A new condition starts as "true" (or "TO DO" after Construct): the first term replaces it.
    if (n === 0) {
      const todo = card.getByTestId('term-box').filter({ hasText: 'TO DO' });
      if (await todo.count()) await todo.click();
      else await card.getByRole('button', { name: 'pick…' }).click();
    } else await card.getByTestId('add-term').click();
    await pick(page, negate ? raw.slice(1) : raw);
    if (negate) await card.getByTestId('not-toggle').nth(n).click();
  }
  if (c.alarm) {
    await card.getByTestId('alarm-toggle').click();
    await card.getByTestId('alarm-enabled').check();
    await card.getByTestId('alarm-severity').selectOption('alarm');
    await card.getByTestId('alarm-group').fill(c.alarm.group);
    await card.getByTestId('alarm-message').fill(c.alarm.message);
  }
}

/** Fills in a state card: description, roles, and the actions of each group from the + Add menu. */
export async function fillState(page: Page, s: (typeof STATES)[number]): Promise<void> {
  const card = page.getByTestId(`state-card-${s.name}`);
  await card.getByPlaceholder('what the machine is doing in this state').fill(s.description);
  await addRoles(card, s.roles);
  for (const key of ['onEntry', 'steps', 'onExit'] as const) {
    const group = card.getByTestId(`group-${key}`);
    for (const a of s[key] ?? []) {
      await group.getByTestId('add-action').click();
      if ('restart' in a) {
        await group.getByTestId('add-timer').click();
        await group.getByTestId('timer-op').selectOption('restart');
        await group.getByTestId('timer-role').selectOption({ label: a.restart });
      } else if ('global' in a) {
        await group.getByTestId('add-global').click();
        await group.getByTestId('action-target').selectOption({ label: `Global.${a.global}` });
        await group.getByTestId('action-value').selectOption(String(a.value));
      } else {
        await group.getByTestId('add-equipment').click();
        await group.getByTestId('action-target').selectOption({ label: a.eq });
        await group.getByTestId('action-value').selectOption(String(a.value));
      }
    }
  }
}

/**
 * The Sealer in the Machines composer: description, cycle time, devices, timers, then the
 * bindings (Auto-bind plus seven by hand). With `addUses`, it also adds the six states and
 * eight conditions the machine uses (Construct Machine already does that).
 */
export async function composeSealer(page: Page, addUses: boolean): Promise<void> {
  const card = page.getByTestId('machine-card-Sealer');
  await card
    .getByPlaceholder('what this machine does')
    .fill('Feeds a box to the stop, pushes it under the seal head, seals it, releases it.');
  await card.getByTestId('machine-cycle').fill('10');
  const INSTANCES: [string, string][] = [
    ['Conveyor', 'Motor'],
    ['BoxAtStop', 'Sensor'],
    ['Pusher', 'Cylinder'],
    ['SealHead', 'Cylinder'],
    ['Lamp', 'Indicator'],
  ];
  for (let n = 0; n < INSTANCES.length; n++) {
    const [name, type] = INSTANCES[n]!;
    await card.getByTestId('add-instance').click();
    await card.getByTestId('instance-type').nth(n).selectOption({ label: type });
    await card.getByTestId('instance-name').nth(n).fill(name);
  }
  const TIMERS: [string, number][] = [
    ['SealTime', 1500],
    ['PusherWatch', 2000],
  ];
  for (let n = 0; n < TIMERS.length; n++) {
    const [name, preset] = TIMERS[n]!;
    await card.getByTestId('add-timer').click();
    await card.getByTestId('timer-name').nth(n).fill(name);
    await card.getByTestId('timer-preset-ms').nth(n).fill(String(preset));
  }
  if (addUses) {
    for (const s of STATES) {
      await card.getByTestId('add-state-instance').selectOption({ label: s.name });
    }
    for (const c of CONDITIONS) {
      await card.getByTestId('add-condition-instance').selectOption({ label: c.name });
    }
    await expect(card.getByTestId('state-instance')).toHaveCount(6);
    await expect(card.getByTestId('condition-instance')).toHaveCount(8);
  }
  // Auto-bind takes the ones with an obvious answer (same name, or the only one of its type)...
  await card.getByTestId('auto-bind').click();
  // ...and the rest are bound by hand: two cylinders and two timers have no obvious answer.
  await expect(card.getByTestId('unbound-count')).toHaveText('7 unbound');
  const HAND: [string, string, string][] = [
    ["State 'Push'", 'Watchdog', 'PusherWatch'],
    ["State 'Seal'", 'SealTimer', 'SealTime'],
    ["Condition 'PusherOut'", 'Cylinder', 'Pusher'],
    ["Condition 'SealDone'", 'Timer', 'SealTime'],
    ["Condition 'PusherHome'", 'Cylinder', 'Pusher'],
    ["Condition 'PusherStuck'", 'Cylinder', 'Pusher'],
    ["Condition 'PusherStuck'", 'Watchdog', 'PusherWatch'],
  ];
  for (const [user, role, to] of HAND) {
    const row = card.getByTestId(`binding-${user}-${role}`);
    await expect(row).toHaveClass(/row-warn/);
    await row.getByTestId('binding-select').selectOption({ label: to });
    await expect(row.getByTestId('binding-select').locator('option:checked')).toHaveText(to);
  }
  await expect(card.getByTestId('unbound-count')).toHaveText('All roles bound');
}
