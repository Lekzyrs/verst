import { expect, test, type Page } from '@playwright/test';
import { asleep, cursor, DESK, frames, openScene, point, state, switchOn, type Pt, type Spot } from './scene';

// Без подсказки шнур не будит сцену посреди проверки.
test.use({ reducedMotion: 'reduce', viewport: DESK });

const TURN = 0.006; // рад на пиксель, как в прототипе

/** Открывает страницу, ждёт покоя, наводит курсор на точку и нажимает. */
async function press(page: Page, what: Spot): Promise<Pt> {
  await openScene(page);
  await asleep(page);
  const p = await point(page, what);
  await page.mouse.move(p.x, p.y);
  expect(await cursor(page), 'курсор над предметом').toBe('grab');
  await page.mouse.down();
  await frames(page);
  expect(await cursor(page), 'курсор при захвате').toBe('grabbing');
  return p;
}

test('панель: движение вниз наклоняет её и не поворачивает лампу', async ({ page }) => {
  const p = await press(page, 'head');
  const before = await state(page);
  await page.mouse.move(p.x, p.y + 120, { steps: 10 });
  await frames(page);
  const held = await state(page);
  expect(held.pitch - before.pitch).toBeGreaterThan(0.4);
  expect(held.pitch - before.pitch, 'чувствительность 0,006 рад на пиксель').toBeCloseTo(120 * TURN, 2);
  expect(held.spin).toBe(before.spin);
  await page.mouse.up();
  await asleep(page);
  const after = await state(page);
  expect(after.spin).toBe(before.spin);
  expect(after.pitch - before.pitch).toBeGreaterThan(0.4);
  expect(await cursor(page), 'после отпускания курсор не остаётся сжатым').not.toBe('grabbing');
});

test('панель упирается: вверх в −0,45 рад, вниз в 1,3 рад', async ({ page }) => {
  const p = await press(page, 'head');
  await page.mouse.move(p.x, p.y - 300, { steps: 12 });
  await frames(page);
  expect((await state(page)).pitch).toBeCloseTo(-0.45, 5);
  await page.mouse.move(p.x, p.y + 300, { steps: 20 });
  await frames(page);
  expect((await state(page)).pitch).toBeCloseTo(1.3, 5);
  await page.mouse.up();
  await asleep(page);
  expect((await state(page)).pitch).toBeCloseTo(1.3, 5);
});

test('панель: движение вбок поворачивает лампу, и она докручивается после отпускания', async ({ page }) => {
  const p = await press(page, 'head');
  const before = await state(page);
  await page.mouse.move(p.x + 150, p.y, { steps: 10 });
  await frames(page);
  const held = await state(page);
  expect(Math.abs(held.spin - before.spin)).toBeGreaterThan(0.6);
  expect(held.spin - before.spin, 'чувствительность 0,006 рад на пиксель').toBeCloseTo(150 * TURN, 2);
  expect(held.pitch).toBe(before.pitch);

  // рука ещё движется в момент отпускания: последний шаг и отпускание идут подряд
  await page.mouse.move(p.x + 170, p.y, { steps: 4 });
  await page.mouse.up();
  const released = (await state(page)).spin;
  await expect.poll(async () => (await state(page)).spin - released, { message: 'лампа докручивается по инерции' }).toBeGreaterThan(0.05);
});

test('ручка меняет теплоту, цифры на матрице видны, пока её крутят', async ({ page }) => {
  await openScene(page);
  await switchOn(page);
  await asleep(page);
  const before = await state(page);
  expect(before.digits).toBe(false);

  const p = await point(page, 'knob');
  await page.mouse.move(p.x, p.y);
  expect(await cursor(page), 'курсор над ручкой').toBe('grab');
  await page.mouse.down();
  await page.mouse.move(p.x + 80, p.y, { steps: 10 });
  await frames(page);
  const held = await state(page);
  expect(Math.abs(held.kelvin - before.kelvin)).toBeGreaterThan(300);
  expect(held.digits, 'цифры видны, пока ручку крутят').toBe(true);
  expect(held.spin).toBe(before.spin);
  expect(held.pitch).toBe(before.pitch);

  await page.mouse.up();
  await expect.poll(async () => (await state(page)).digits, { timeout: 2000, message: 'цифры гаснут через 2 с' }).toBe(false);
  expect((await state(page)).kelvin).toBe(held.kelvin);
});

test('ручка упирается в 2000 и 4500 кельвинов', async ({ page }) => {
  const p = await press(page, 'knob');
  await page.mouse.move(p.x - 500, p.y, { steps: 10 });
  await frames(page);
  expect((await state(page)).kelvin).toBe(2000);
  await page.mouse.move(p.x + 500, p.y, { steps: 20 });
  await frames(page);
  expect((await state(page)).kelvin).toBe(4500);
  await page.mouse.up();
});
