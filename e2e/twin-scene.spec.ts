import { expect, test, type Page } from '@playwright/test';

/* The Twin 3D scene (SPEC 10), driven through its hand controls. Software 3D is slow
   in the test browser, so the waits are generous; the scene's own timing is checked by
   the unit tests in packages/studio/src/twin. */

test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(120_000);

const sensor = (page: Page, port: string) => page.locator(`[data-port="${port}"][data-value]`);
const on = (page: Page, port: string) =>
  expect(sensor(page, port)).toHaveAttribute('data-value', 'on', { timeout: 40_000 });
const off = (page: Page, port: string) =>
  expect(sensor(page, port)).toHaveAttribute('data-value', 'off', { timeout: 40_000 });
const cmd = (page: Page, port: string) => page.locator(`input[data-port="${port}"]`);
const readout = (page: Page, key: string) =>
  page.locator(`[data-testid="twin-readout"] [data-k="${key}"]`);

async function openTwin(page: Page): Promise<void> {
  await page.goto('/twin');
  await expect(page.getByTestId('twin-canvas')).toBeVisible({ timeout: 90_000 });
  // The scene has started when the actuator feedback is published: both at home.
  await on(page, 'pusher.retracted');
  await on(page, 'sealhead.upPosition');
}

test('the Twin opens with the 3D scene and the hand controls', async ({ page }) => {
  await openTwin(page);
  const box = await page.getByTestId('twin-canvas').boundingBox();
  expect(box!.width).toBeGreaterThan(300);
  expect(box!.height).toBeGreaterThan(250);
  for (const name of ['Reset view', 'Flat view', 'Add carton', 'Carton at station']) {
    await expect(page.getByRole('button', { name })).toBeVisible();
  }
  await expect(page.getByLabel('Binding table')).toHaveValue('box-closing');
});

test('a carton rides the running belt and breaks the sensor beam', async ({ page }) => {
  await openTwin(page);
  await off(page, 'sensor.present');
  await cmd(page, 'conveyor.run').check();
  await on(page, 'conveyor.running');
  await page.getByRole('button', { name: 'Add carton' }).click();
  await on(page, 'sensor.present');
});

test('a carton stands still on a stopped belt, the pusher clamps it, then the seal head seals it', async ({
  page,
}) => {
  await openTwin(page);
  await page.getByRole('button', { name: 'Carton at station' }).click();
  await on(page, 'sensor.present');
  await expect(readout(page, 'station-z')).toHaveText('0 m', { timeout: 20_000 });

  // The pusher moves it sideways against the fence: its centre goes from 0 to about -0.1 m.
  await cmd(page, 'pusher.extend').check();
  await off(page, 'pusher.retracted');
  await on(page, 'pusher.extended');
  await expect(readout(page, 'station-z')).toHaveText(/^-0\.(0[89]|1|11) m$/, {
    timeout: 20_000,
  });
  await expect(readout(page, 'sealed')).toHaveText('0');

  // The seal head comes down onto the clamped carton and seals it.
  await cmd(page, 'sealhead.down').check();
  await off(page, 'sealhead.upPosition');
  await on(page, 'sealhead.downPosition');
  await expect(readout(page, 'sealed')).toHaveText('1', { timeout: 20_000 });

  // Back home: both cylinders retract and the feedback follows.
  await cmd(page, 'sealhead.down').uncheck();
  await on(page, 'sealhead.upPosition');
  await cmd(page, 'pusher.extend').uncheck();
  await on(page, 'pusher.retracted');
});

test('while a cylinder travels, neither of its end sensors is on', async ({ page }) => {
  await openTwin(page);
  await page.getByLabel('Pusher travel time in milliseconds').fill('2000');
  await cmd(page, 'pusher.extend').check();
  await off(page, 'pusher.retracted');
  await expect(sensor(page, 'pusher.extended')).toHaveAttribute('data-value', 'off');
  await on(page, 'pusher.extended');
});

test('choosing the seed machine shows the seed addresses', async ({ page }) => {
  await openTwin(page);
  await page.getByLabel('Binding table').selectOption('sealer-seed');
  await expect(page.getByText('Sealer.Pusher.ICylinder.Extend', { exact: true })).toBeVisible();
  await expect(page.getByText('Sealer.BoxAtStop.ISensor.Present', { exact: true })).toBeVisible();
});

test('Flat view and Reset view keep the scene running', async ({ page }) => {
  await openTwin(page);
  await page.getByRole('button', { name: 'Flat view' }).click();
  await expect(page.getByRole('button', { name: 'Flat view' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Reset view' }).click();
  await cmd(page, 'pusher.extend').check();
  await on(page, 'pusher.extended');
});
