import { expect, test, type Page } from '@playwright/test';

/** Phase 2: the library editors, driven through the real UI. Each test makes its own project. */

const SHOTS = 'test-results/screens';
let counter = 0;

async function newProject(page: Page): Promise<void> {
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
