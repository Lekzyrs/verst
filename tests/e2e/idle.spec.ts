import { expect, test, type Page } from '@playwright/test';
import { asleep, cursor, DESK, openScene, point, sleeping, state, switchOn } from './scene';

test.use({ viewport: DESK });

const drawn = (page: Page): Promise<number> => page.evaluate(() => window.__verst!.frames);

test('после включения сцена засыпает за 4 с и больше не рисует', async ({ page }) => {
  await openScene(page);
  await switchOn(page);
  // Сроки здесь и есть условие: через 4 с после включения сцена спит и за следующие 3 с не рисует ни кадра.
  await page.waitForTimeout(4000);
  const before = await drawn(page);
  await page.waitForTimeout(3000);
  expect(await drawn(page), 'кадров за 3 с покоя').toBe(before);
  expect((await state(page)).on).toBe(true);

  // курсор над лампой сцену не будит
  const head = await point(page, 'head');
  await page.mouse.move(head.x - 30, head.y - 30);
  await page.mouse.move(head.x, head.y, { steps: 10 });
  expect(await cursor(page)).toBe('grab');
  expect(await sleeping(page), 'курсор над лампой не рисует кадры').toBe(true);
  expect(await drawn(page)).toBe(before);

  // а движение лампы рукой будит
  await page.mouse.down();
  await page.mouse.move(head.x + 40, head.y, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => drawn(page), { message: 'после движения мыши над лампой кадры пошли' }).toBeGreaterThan(before);
  await asleep(page);
});

test('прокрутка страницы будит сцену, и она снова засыпает', async ({ page }) => {
  await openScene(page);
  await switchOn(page);
  await asleep(page, 4000);
  const before = await drawn(page);
  await page.mouse.move(200, 400);
  await page.mouse.wheel(0, 200);
  await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(200);
  await expect.poll(() => drawn(page)).toBeGreaterThan(before);
  await asleep(page, 4000);
  const after = await drawn(page);
  await page.waitForTimeout(1500);
  expect(await drawn(page)).toBe(after);
});

test.describe('меньше движения', () => {
  test.use({ reducedMotion: 'reduce' });

  test('нетронутая лампа не рисует: подсказки нет', async ({ page }) => {
    await openScene(page);
    await page.waitForTimeout(2000);
    const before = await drawn(page);
    expect(before).toBeGreaterThan(0);
    await page.waitForTimeout(8000);
    expect(await drawn(page), 'кадров за 8 с покоя').toBe(before);
    expect((await state(page)).on).toBe(false);
  });
});

test('подсказка: шнур качается раз в 6 с, три раза, и сцена замирает', async ({ page }) => {
  test.setTimeout(60_000);
  await openScene(page);
  await asleep(page);
  const rest = await point(page, 'ring');
  for (let n = 1; n <= 3; n += 1) {
    const before = await drawn(page);
    await expect.poll(() => drawn(page), { timeout: 7500, intervals: [100], message: `качок ${n}` }).toBeGreaterThan(before);
    // время страницы идёт от начала загрузки, сцена запускается позже: качок n приходит не раньше чем через 6n секунд
    expect(await page.evaluate(() => performance.now()), `качок ${n} не раньше чем через ${n * 6} с`).toBeGreaterThan(n * 6000);
    await expect
      .poll(async () => Math.abs((await point(page, 'ring')).x - rest.x), { timeout: 2000, intervals: [50], message: `кольцо качнулось, качок ${n}` })
      .toBeGreaterThan(1);
    await asleep(page, 5000);
    expect((await state(page)).on, 'подсказка лампу не включает').toBe(false);
  }
  const before = await drawn(page);
  await page.waitForTimeout(7500);
  expect(await drawn(page), 'четвёртого качка нет').toBe(before);
});
