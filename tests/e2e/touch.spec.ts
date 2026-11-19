import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { asleep, coverWithLink, openScene, point, scale, state, type Pt } from './scene';

// Без подсказки: кольцо ждёт палец на месте.
test.use({ hasTouch: true, reducedMotion: 'reduce', viewport: { width: 390, height: 844 } });
test.skip(({ browserName }) => browserName !== 'chromium', 'жесты пальцем подаются через CDP, он есть только в Chromium');

const scrollY = (page: Page): Promise<number> => page.evaluate(() => Math.round(window.scrollY));

/** Жест одним пальцем от точки from на (dx, dy): касание, движение шагами, отпускание. */
async function swipe(page: Page, cdp: CDPSession, from: Pt, dx: number, dy: number, hold?: () => Promise<void>): Promise<void> {
  const steps = 12;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
  for (let i = 1; i <= steps; i += 1) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (dx * i) / steps, y: from.y + (dy * i) / steps }] });
    await page.waitForTimeout(16);
  }
  if (hold) await hold();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

test('жест пальцем от кольца вниз включает лампу и не прокручивает страницу', async ({ page }) => {
  await openScene(page);
  // Страница прокручена: иначе жест вниз не смог бы её сдвинуть и проверка ничего бы не значила.
  await page.evaluate(() => window.scrollTo(0, 120));
  await expect.poll(() => scrollY(page)).toBe(120);
  await asleep(page);
  const cdp = await page.context().newCDPSession(page);
  const ring = await point(page, 'ring');
  await swipe(page, cdp, ring, 0, 0.5 * (await scale(page)), async () => {
    await expect.poll(async () => (await state(page)).on, { message: 'рывок пальцем включил лампу' }).toBe(true);
  });
  await asleep(page);
  expect(await scrollY(page), 'страница не прокрутилась').toBe(120);
  expect((await state(page)).on).toBe(true);
  expect((await state(page)).travel).toBeLessThan(0.01);
});

test('жест пальцем мимо лампы прокручивает страницу', async ({ page }) => {
  await openScene(page);
  await asleep(page);
  const cdp = await page.context().newCDPSession(page);
  // Пустое место: у левого края, выше лампы.
  const lamp = await page.evaluate(() => window.__verst!.bounds());
  await swipe(page, cdp, { x: 40, y: Math.max(220, lamp.top - 60) }, 0, -150);
  await expect.poll(() => scrollY(page), { message: 'страница прокрутилась' }).toBeGreaterThan(60);
  expect((await state(page)).on).toBe(false);
});

test('касание кольца включает лампу', async ({ page }) => {
  await openScene(page);
  await asleep(page);
  const cdp = await page.context().newCDPSession(page);
  const ring = await point(page, 'ring');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: ring.x, y: ring.y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(async () => (await state(page)).on).toBe(true);
});

test('жест пальцем, начатый на ссылке поверх кольца, прокручивает страницу, а лампу не трогает', async ({ page }) => {
  await openScene(page);
  await asleep(page);
  const cdp = await page.context().newCDPSession(page);
  const ring = await point(page, 'ring');
  const link = await coverWithLink(page, ring);

  await swipe(page, cdp, ring, 0, -150);
  await expect.poll(() => scrollY(page), { message: 'жест, начатый на ссылке, прокрутил страницу' }).toBeGreaterThan(60);
  await asleep(page);
  expect((await state(page)).on, 'лампа не включилась').toBe(false);
  expect((await state(page)).travel, 'шнур не вытянут').toBe(0);
  await link.evaluate((el) => el.remove());
});

test('касание пальцем ссылки поверх кольца даёт ей клик и лампу не включает', async ({ page }) => {
  await openScene(page);
  await asleep(page);
  const cdp = await page.context().newCDPSession(page);
  const ring = await point(page, 'ring');
  const link = await coverWithLink(page, ring);

  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: ring.x, y: ring.y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(link, 'касание ссылки дошло до неё кликом').toHaveAttribute('data-clicks', '1');
  await asleep(page);
  expect((await state(page)).on, 'касание ссылки лампу не включило').toBe(false);
  await link.evaluate((el) => el.remove());
});
