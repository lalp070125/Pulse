import { expect, test, type Page } from '@playwright/test';
import { newProject } from './helpers';
import type { Project } from '@pulso/core';
import { buildBoxSealer } from '../packages/runtime/src/seed/boxSealer';

/* Phase 4: the Routing (bus manager) editor, driven through the real UI. */

test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(60_000);

async function loadSeed(page: Page): Promise<void> {
  const got = (await (await page.request.get('/api/project')).json()) as { project: Project };
  const seed = buildBoxSealer();
  seed.info = got.project.info;
  expect((await page.request.put('/api/project', { data: { project: seed } })).ok()).toBe(true);
  await page.reload();
  await expect(page.getByTestId('status-connection')).toContainText('Connected');
}

test('Routing: defaults, move a sensor from Sim to Twin, filters, save, reset', async ({
  page,
}) => {
  await newProject(page, 'route');
  await loadSeed(page);
  await page.getByTestId('project-tree').getByText('Routing', { exact: true }).click();
  await expect(page.getByTestId('editor-routing')).toBeVisible();

  const sensor = 'Sealer.BoxAtStop.ISensor.Present';
  const motor = 'Sealer.Conveyor.IMotor.Run';
  // Defaults: a sensor is read from Sim, a command is written to Sim.
  await expect(page.getByTestId(`route-on-${sensor}-sim`)).toBeChecked();
  await expect(page.getByTestId(`route-dir-${sensor}-sim`)).toHaveValue('read');
  await expect(page.getByTestId(`route-on-${sensor}-twin`)).not.toBeChecked();
  await expect(page.getByTestId(`route-dir-${motor}-sim`)).toHaveValue('write');
  await expect(page.getByTestId(`route-reset-${sensor}`)).toHaveCount(0);

  // Read the sensor from Twin: Sim stops reading it (one reader per variable).
  await page.getByTestId(`route-on-${sensor}-twin`).check();
  await expect(page.getByTestId(`route-dir-${sensor}-twin`)).toHaveValue('read');
  await expect(page.getByTestId(`route-on-${sensor}-sim`)).not.toBeChecked();
  await expect(page.getByTestId('route-problems')).toHaveCount(0);

  // A command cannot be read: its Read option is disabled.
  await expect(
    page.getByTestId(`route-dir-${motor}-twin`).locator('option[value="read"]'),
  ).toBeDisabled();

  // Filter by transport: only Twin variables remain.
  await page.getByTestId('route-transport').selectOption('twin');
  await expect(page.getByTestId('route-count')).toHaveText('1 variables');
  await page.getByTestId('route-transport').selectOption('all');

  // Save writes routing.json.
  await page.getByRole('menuitem', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: /^Save/ }).first().click();
  await expect
    .poll(async () => {
      const got = (await (await page.request.get('/api/project')).json()) as { project: Project };
      return got.project.routing.routes.map((r) => `${r.sim}/${r.twin}/${r.panel}`);
    })
    .toEqual(['off/read/off']);

  // Reset returns to the default.
  await page.getByTestId(`route-reset-${sensor}`).click();
  await expect(page.getByTestId(`route-on-${sensor}-sim`)).toBeChecked();
  await expect(page.getByTestId(`route-reset-${sensor}`)).toHaveCount(0);
  await page.screenshot({ path: 'test-results/screens/routing.png' });
});
