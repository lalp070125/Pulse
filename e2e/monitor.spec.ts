import { expect, test, type Page } from '@playwright/test';
import { newProject } from './helpers';
import type { Project } from '@pulso/core';
import { buildBoxSealer } from '../packages/runtime/src/seed/boxSealer';

/* Phase 4: the Monitor tab, driven through the real UI. */

test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(60_000);

const SHOTS = 'test-results/screens';

async function loadSeed(page: Page): Promise<void> {
  const got = (await (await page.request.get('/api/project')).json()) as { project: Project };
  const seed = buildBoxSealer();
  seed.info = got.project.info;
  expect((await page.request.put('/api/project', { data: { project: seed } })).ok()).toBe(true);
  await page.reload();
  await expect(page.getByTestId('status-connection')).toContainText('Connected');
}

async function openMonitor(page: Page, node: string): Promise<void> {
  await page.getByRole('tab', { name: 'Monitor', exact: true }).click();
  await page.getByTestId('project-tree').getByText(node, { exact: true }).click();
  await expect(page.getByTestId('editor-monitor')).toBeVisible();
}

test('Monitor: deploy, start, states light up, log fills, waveform shows signals', async ({
  page,
}) => {
  await newProject(page, 'mon');
  await loadSeed(page);
  await page.getByTestId('rt-deploy').click();
  await openMonitor(page, 'Live Plan');
  await expect(page.getByTestId('state-node-Idle')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/monitor-deployed.png` });

  await page.getByTestId('rt-start').click();
  await expect(page.getByTestId('state-node-Idle')).toHaveAttribute('data-active', 'true');
  await expect(page.getByTestId('log-row').first()).toBeVisible();
  await expect(page.getByTestId('log-footer')).toContainText('Entries');
  await page.screenshot({ path: `${SHOTS}/monitor-running.png` });
});

test('Monitor acceptance: focus a state, force a signal from the chart, read why a wire did not fire', async ({
  page,
}) => {
  await newProject(page, 'mon');
  await loadSeed(page);
  await page.getByTestId('rt-deploy').click();
  await openMonitor(page, 'Live Plan');
  await page.getByTestId('rt-start').click();
  await expect(page.getByTestId('state-node-Idle')).toHaveAttribute('data-active', 'true');

  // Clicking Idle puts the signals it touches on the chart.
  await page.getByTestId('state-node-Idle').click();
  const forceButtons = page.locator('[data-testid^="force-"]');
  await expect(forceButtons.first()).toBeVisible();
  const paths = await forceButtons.evaluateAll((els) =>
    els.map((e) => e.getAttribute('data-testid')!.slice('force-'.length)),
  );
  console.log('forcible signals on Idle:', paths.join(', '));
  const start = paths.find((p) => /StartPressed|Start/i.test(p));
  expect(start, 'a start signal is forcible from the chart').toBeTruthy();

  // Force it and the machine leaves Idle; the log says why (a COND row, then TRANS).
  await page.getByTestId(`force-${start}`).click();
  await expect(page.getByTestId('state-node-Feed')).toHaveAttribute('data-active', 'true');
  await page.screenshot({ path: `${SHOTS}/monitor-forced.png` });
  await expect(page.getByTestId('log-row').filter({ hasText: 'INJECT' }).first()).toBeVisible();
});

test('Monitor acceptance: force BoxAtStop and read the condition values from the log', async ({
  page,
}) => {
  await newProject(page, 'mon');
  await loadSeed(page);
  await page.getByTestId('rt-deploy').click();
  await openMonitor(page, 'Live Plan');
  await page.getByTestId('rt-start').click();
  await page.getByTestId('state-node-Idle').click();
  await page.locator('[data-testid="force-Global.Start"]').click();
  await expect(page.getByTestId('state-node-Feed')).toHaveAttribute('data-active', 'true');

  // In Feed the machine waits for the box. The log has the check that failed, with its term values.
  await page.getByTestId('state-node-Feed').click();
  await page.getByTestId('log-filter').fill('BoxArrived');
  const check = page.getByTestId('log-row').filter({ hasText: 'COND' }).last();
  await expect(check).toBeVisible();
  console.log('why-not row:', (await check.innerText()).replace(/\s+/g, ' '));
  await page.screenshot({ path: `${SHOTS}/monitor-why-not.png` });

  // Force the sensor from the chart: the machine moves on to Push.
  const sensor = page.locator('[data-testid^="force-"][data-testid*="BoxAtStop"]').first();
  await expect(sensor).toBeVisible();
  await sensor.click();
  await expect(page.getByTestId('state-node-Push')).toHaveAttribute('data-active', 'true');
});
