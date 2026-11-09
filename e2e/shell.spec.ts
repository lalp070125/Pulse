import { devices, expect, test, type Page } from '@playwright/test';

/** Phase 0 acceptance: the application shell (SPEC 4.3) on the single port 4600. */

const SHOTS = 'test-results/screens';

async function height(page: Page, testId: string): Promise<number> {
  const box = await page.getByTestId(testId).boundingBox();
  return Math.round(box?.height ?? -1);
}

async function bg(page: Page, selector: string): Promise<string> {
  return page
    .locator(selector)
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);
}

test.describe('desktop 1440 × 900', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('opens the Studio shell, connected, with the spec sizes and tokens', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

    await page.goto('/');
    await expect(page).toHaveURL(/\/studio$/);
    await expect(page.getByTestId('title-text')).toContainText('Pulso Studio');
    await expect(page.getByTestId('title-text')).toContainText('[Connected]');
    await expect(page.getByTestId('status-connection')).toContainText('Connected');
    await expect(page.getByTestId('messages')).toContainText('Connected to Pulso runtime');

    // Shell bar heights from SPEC 4.3.
    expect(await height(page, 'titlebar')).toBe(28);
    expect(await height(page, 'menubar')).toBe(26);
    expect(await height(page, 'runtime-strip')).toBe(24);
    expect(await height(page, 'statusbar')).toBe(22);
    expect(await height(page, 'tabs')).toBe(28);

    // Sidebar ≈ 260 px, inspector ≈ 280 px, bottom panel ≈ 220 px (allow rounding).
    const sidebar = await page.getByTestId('sidebar').boundingBox();
    const inspector = await page.getByTestId('inspector').boundingBox();
    const bottom = await page.getByTestId('messages').boundingBox();
    expect(Math.abs((sidebar?.width ?? 0) - 260)).toBeLessThanOrEqual(3);
    expect(Math.abs((inspector?.width ?? 0) - 280)).toBeLessThanOrEqual(3);
    expect(Math.abs((bottom?.height ?? 0) - 220)).toBeLessThanOrEqual(3);

    // Exact token colours.
    expect(await bg(page, 'body')).toBe('rgb(7, 10, 18)'); // --bg-0
    expect(await bg(page, '.sidebar')).toBe('rgb(13, 18, 32)'); // --bg-1
    await expect.poll(() => bg(page, '.mode-pills button.active')).toBe('rgb(124, 92, 255)'); // --accent

    // Empty project tree skeleton (SPEC 6.1).
    const tree = page.getByTestId('project-tree');
    for (const label of [
      'Target',
      'Runtime (local)',
      'Routing',
      'Library',
      'Global Variables',
      'Interfaces',
      'Equipment',
      'Logic Blocks',
      'Conditions',
      'States',
      'Machines',
      'Planner',
    ]) {
      await expect(tree.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(tree).toContainText('127.0.0.1:4600');

    await page.screenshot({ path: `${SHOTS}/studio-plan.png` });
    expect(errors).toEqual([]);
  });

  test('mode pills, tree selection, tabs (open, reorder, close)', async ({ page }) => {
    await page.goto('/studio');
    await page.getByRole('tab', { name: 'Monitor' }).click();
    await expect(page.getByTestId('project-tree')).toContainText('Waveform Monitor');
    await page.getByRole('tab', { name: 'Test' }).click();
    await expect(page.getByTestId('project-tree')).toContainText('Test Manager');
    await page.getByRole('tab', { name: 'Plan' }).click();

    const tree = page.getByTestId('project-tree');
    await tree.getByText('Planner', { exact: true }).click();
    await tree.getByText('Twin', { exact: true }).click();
    const selected = page.locator('.tree-row.selected');
    await expect(selected).toContainText('Twin');
    await expect.poll(() => bg(page, '.tree-row.selected')).toBe('rgb(42, 33, 87)'); // --accent-soft

    const tabs = page.getByTestId('tabs').locator('.tab');
    await expect(tabs).toHaveText(['Planner', 'Twin']);
    await expect.poll(() => bg(page, '.tab.active')).toBe('rgb(59, 130, 246)'); // --focus
    await expect(page.getByTestId('document')).toContainText('built in Phase 8');

    // Drag "Twin" onto "Planner" to reorder.
    const first = await tabs.nth(0).boundingBox();
    const second = await tabs.nth(1).boundingBox();
    if (!first || !second) throw new Error('tabs not laid out');
    await page.mouse.move(second.x + second.width / 2, second.y + second.height / 2);
    await page.mouse.down();
    await page.mouse.move(first.x + 10, first.y + first.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect(tabs).toHaveText(['Twin', 'Planner']);
    await page.screenshot({ path: `${SHOTS}/studio-tabs.png` });

    await page.getByRole('button', { name: 'Close Twin' }).click();
    await expect(tabs).toHaveText(['Planner']);
  });

  test('menus, view toggles and About with the safety statement', async ({ page }) => {
    await page.goto('/studio');
    await page.getByRole('menuitem', { name: 'View' }).click();
    await expect(page.getByRole('menu')).toContainText('Ctrl+J');
    await page.getByRole('menuitem', { name: /Bottom Panel/ }).click();
    await expect(page.getByTestId('messages')).toBeHidden();
    await page.keyboard.press('Control+j');
    await expect(page.getByTestId('messages')).toBeVisible();
    await page.keyboard.press('Control+b');
    await expect(page.getByTestId('sidebar')).toBeHidden();
    await page.keyboard.press('Control+b');
    await expect(page.getByTestId('sidebar')).toBeVisible();

    await page.getByRole('menuitem', { name: 'Help' }).click();
    await page.getByRole('menuitem', { name: 'About Pulso' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('not');
    await expect(dialog).toContainText('hardwired, certified safety components');
    await page.screenshot({ path: `${SHOTS}/about.png` });
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('messages panel: level pills, pause, clear', async ({ page }) => {
    await page.goto('/studio');
    const messages = page.getByTestId('messages');
    await expect(messages).toContainText('Info: 2');
    await page.getByRole('button', { name: 'Info: 2' }).click();
    await expect(messages).toContainText('No messages');
    await page.getByRole('button', { name: 'Info: 2' }).click();
    await page.getByRole('button', { name: 'Pause' }).click();
    await expect(page.getByRole('button', { name: /Resume/ })).toBeVisible();
    await page.getByRole('button', { name: /Resume/ }).click();
    await page.getByRole('button', { name: 'Clear' }).click();
    await expect(messages).toContainText('No messages');
  });

  test('app switcher moves between Studio, Panel and Twin', async ({ page }) => {
    await page.goto('/studio');
    const switcher = page.getByRole('navigation', { name: 'Switch application' });
    await switcher.getByRole('button', { name: 'Panel' }).click();
    await expect(page).toHaveURL(/\/panel$/);
    await expect(page.getByTestId('title-text')).toContainText('Pulso Panel');
    await expect(page.getByTestId('tabs')).toContainText('Variable Mapping');
    await expect(page.getByTestId('inspector')).toContainText('No widget selected');
    await expect(page.getByTestId('statusbar')).toContainText('Runtime target: Web');
    await page.screenshot({ path: `${SHOTS}/panel.png` });

    await switcher.getByRole('button', { name: 'Twin' }).click();
    await expect(page).toHaveURL(/\/twin$/);
    await expect(page.getByTestId('tabs')).toContainText('Line Builder');
    await page.screenshot({ path: `${SHOTS}/twin.png` });

    await page.goBack();
    await expect(page.getByTestId('title-text')).toContainText('Pulso Panel');
    await page.goto('/twin');
    await expect(page.getByTestId('title-text')).toContainText('Pulso Twin');
  });
});

test.describe('phone', () => {
  const { viewport, deviceScaleFactor, isMobile, hasTouch, userAgent } = devices['iPhone 13'];
  test.use({ viewport, deviceScaleFactor, isMobile, hasTouch, userAgent });

  test('renders the full desktop layout scaled (viewport width 1440)', async ({ page }) => {
    await page.goto('/studio');
    await expect(page.getByTestId('title-text')).toContainText('[Connected]');
    const layoutWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(layoutWidth).toBe(1440);
    // The sidebar is still beside the document area (no reflow into a column).
    const sidebar = await page.getByTestId('sidebar').boundingBox();
    const doc = await page.getByTestId('document').boundingBox();
    expect((doc?.x ?? 0) > (sidebar?.x ?? 0)).toBe(true);
    expect(Math.abs((doc?.y ?? 0) - (sidebar?.y ?? 0))).toBeLessThan(80);
    await page.screenshot({ path: `${SHOTS}/phone.png` });
  });
});
