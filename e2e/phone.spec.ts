import { devices, expect, test, type Page } from '@playwright/test';
import { addMachine, addState, newProject, openPlanner } from './helpers';

/* ----------------------------------------------------------------------------
 * The Planner on a phone (owner request, within SPEC 4.1: the desktop layout,
 * scaled). Screen size, touch and user agent of an iPhone 16 Pro Max, run in
 * Chromium (Safari's own engine is not installed here). Fingers are simulated
 * with the browser's touch input.
 * -------------------------------------------------------------------------- */

const { defaultBrowserType: _ignored, ...iphone } = devices['iPhone 16 Pro Max'];
void _ignored;
test.use({ ...iphone });
test.setTimeout(120_000);
const SHOTS = 'test-results/screens';

async function touchDrag(page: Page, from: string, to: string): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const a = (await page.getByTestId(from).boundingBox())!;
  const b = (await page.getByTestId(to).boundingBox())!;
  const p = (x: number, y: number) => [{ x: Math.round(x), y: Math.round(y) }];
  const ax = a.x + a.width / 2;
  const ay = a.y + a.height / 2;
  const bx = b.x + b.width / 2;
  const by = b.y + b.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: p(ax, ay) });
  for (let i = 1; i <= 10; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: p(ax + ((bx - ax) * i) / 10, ay + ((by - ay) * i) / 10),
    });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

test('Phone: full screen, two-finger zoom on the canvas, finger-sized dots, draw a wire by touch', async ({
  page,
}) => {
  await newProject(page, 'phone');
  await openPlanner(page);
  await addMachine(page, 'Line');
  await addState(page, 'Line', 'Ready');
  await addState(page, 'Line', 'Busy');

  // Full screen: the side panels and Messages go away, and come back.
  await page.getByTestId('planner-fullscreen').click();
  await expect(page.getByTestId('sidebar')).toBeHidden();
  await expect(page.getByTestId('inspector')).toBeHidden();
  await expect(page.getByTestId('messages')).toBeHidden();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/phone-fullscreen.png` });

  // Two fingers moving apart on the canvas zoom the drawing.
  const zoomText = page.getByTestId('planner-zoom');
  const before = await zoomText.textContent();
  const canvas = (await page.getByTestId('planner-canvas').boundingBox())!;
  const cx = Math.round(canvas.x + canvas.width / 2);
  const cy = Math.round(canvas.y + canvas.height / 2);
  const cdp = await page.context().newCDPSession(page);
  const fingers = (d: number) => [
    { x: cx - d, y: cy, id: 1 },
    { x: cx + d, y: cy, id: 2 },
  ];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: fingers(40) });
  for (let d = 50; d <= 160; d += 10) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: fingers(d) });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(zoomText).not.toHaveText(before!);

  // (Whether Safari's own page zoom stays off the canvas can only be checked on a real iPhone:
  // this simulator does no page zoom at all, so a check here would prove nothing.)

  // Ports are finger-sized on a touch screen (18 px at 100 % zoom).
  await page.getByTestId('planner-fit').click();
  await page.waitForTimeout(400);
  const zoom = Number((await zoomText.textContent())!.replace('%', '')) / 100;
  const port = (await page.getByTestId('out-Ready').boundingBox())!;
  expect(port.width / zoom).toBeGreaterThanOrEqual(17);

  // Draw a wire with a finger: from Ready's bottom dot to Busy's top dot.
  await touchDrag(page, 'out-Ready', 'in-Busy');
  await expect(page.getByTestId('chip-Ready-Busy')).toHaveText('(no condition)');
  await page.screenshot({ path: `${SHOTS}/phone-wire.png` });

  // Back out of full screen.
  await page.getByTestId('planner-fullscreen').click();
  await expect(page.getByTestId('sidebar')).toBeVisible();
  await expect(page.getByTestId('messages')).toBeVisible();
});
