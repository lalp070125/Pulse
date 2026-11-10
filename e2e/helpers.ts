import { expect, type Page } from '@playwright/test';

/* Shared steps for the browser tests: each one is what a user does with mouse and keyboard. */

const watched = new WeakSet<Page>();
/**
 * Prints the browser's live-reload messages into the test output. A test that loses unsaved work
 * mid-way (a page reload it did not ask for) then shows the reason next to the failure.
 */
export function watchReloads(page: Page): void {
  if (watched.has(page)) return;
  watched.add(page);
  page.on('console', (m) => {
    if (m.text().includes('[vite]'))
      console.log(`[browser ${new Date().toISOString()}] ${m.text()}`);
  });
}

let counter = 0;

/** Makes a new, empty project through File > New Project and opens it. */
export async function newProject(page: Page, prefix = 'plan'): Promise<string> {
  watchReloads(page);
  const name = `${prefix}-${Date.now()}-${counter++}`;
  await page.goto('/studio');
  await expect(page.getByTestId('status-connection')).toContainText('Connected');
  await page.getByRole('menuitem', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: /New Project/ }).click();
  await page.getByTestId('dialog-input').fill(name);
  await page.getByTestId('dialog-ok').click();
  await expect(page.getByTestId('title-text')).toContainText(name);
  return name;
}

export async function openPlanner(page: Page): Promise<void> {
  await page.getByTestId('project-tree').getByText('Planner', { exact: true }).click();
  await expect(page.getByTestId('editor-planner')).toBeVisible();
}

/** Drags from one port (a test ID) to another, like a mouse user drawing a wire. */
/** Where an element is once it has stopped moving (the canvas may still be zooming or panning). */
async function settledBox(page: Page, testId: string) {
  const el = page.getByTestId(testId);
  let last = await el.boundingBox();
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(60);
    const now = await el.boundingBox();
    if (now && last && now.x === last.x && now.y === last.y && now.width === last.width) return now;
    last = now;
  }
  return last!;
}

/** Drags from one port (a test ID) to another, like a mouse user drawing a wire. */
export async function wire(page: Page, from: string, to: string): Promise<void> {
  const a = await settledBox(page, from);
  const b = await settledBox(page, to);
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();
}

export async function addMachine(page: Page, name: string): Promise<void> {
  await page.getByTestId('planner-add-machine').click();
  await page.getByTestId('dialog-input').fill(name);
  await page.getByTestId('dialog-ok').click();
  await expect(page.getByTestId(`machine-box-${name}`)).toBeVisible();
}

export async function addState(page: Page, machine: string, name: string): Promise<void> {
  await page.getByTestId(`machine-head-${machine}`).click(); // the State button adds to this machine
  await page.getByTestId('planner-add-state').click();
  await page.getByTestId('dialog-input').fill(name);
  await page.getByTestId('dialog-ok').click();
  await expect(page.getByTestId(`state-node-${name}`)).toBeVisible();
}

/** Opens the chooser by double-clicking a label or slot, then picks or types `name`. */
export async function setCondition(page: Page, testId: string, name: string): Promise<void> {
  await page.getByTestId(testId).dblclick();
  const chooser = page.getByTestId('condition-chooser');
  await expect(chooser).toBeVisible();
  await chooser.getByTestId('cond-search').fill(name);
  const existing = chooser
    .getByTestId('cond-option')
    .filter({ has: page.getByText(name, { exact: true }) });
  if (await existing.count()) await existing.first().click();
  else await chooser.getByTestId('cond-search').press('Enter');
  await expect(chooser).toBeHidden();
}
