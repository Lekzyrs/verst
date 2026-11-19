import { expect, test, type Page } from '@playwright/test';
import { LIVE } from './open';
import { asleep, coverWithLink, cursor, DESK, dist, frames, openScene, point, scale, state, type Pt, type Spot } from './scene';

// Без подсказки шнур висит неподвижно: иначе она качнула бы его посреди проверки.
test.use({ reducedMotion: 'reduce', viewport: DESK });

const ringInfo = (page: Page) => page.evaluate(() => window.__verst!.ring());

/** Открывает страницу, ждёт покоя и нажимает на точку шнура. Возвращает точку нажатия. */
async function press(page: Page, what: Spot): Promise<Pt> {
  await openScene(page);
  await asleep(page);
  const p = await point(page, what);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await frames(page);
  return p;
}

const GRIPS: Spot[] = ['ring', 13, 9, 7, 4, 1];
for (const grip of GRIPS) {
  const name = grip === 'ring' ? 'кольцо' : `звено ${grip}`;
  test(`шнур за ${name}: ничего не прыгает, рывок включает, шнур уходит в корпус`, async ({ page }) => {
    await openScene(page);
    await asleep(page);
    const pull = 0.5 * (await scale(page));
    const p = await point(page, grip);
    const ring = await point(page, 'ring');

    await page.mouse.move(p.x, p.y);
    expect(await cursor(page), 'курсор над точкой захвата').toBe('grab');
    await page.mouse.down();
    await frames(page, 8);
    expect(await cursor(page), 'курсор при захвате').toBe('grabbing');
    expect(dist(await point(page, 'ring'), ring), 'сдвиг кольца при нажатии, px').toBeLessThanOrEqual(5);
    // первое же движение руки на пиксель не должно дёрнуть шнур к курсору
    await page.mouse.move(p.x + 1, p.y);
    await frames(page, 8);
    expect(dist(await point(page, 'ring'), ring), 'сдвиг кольца при первом движении руки, px').toBeLessThanOrEqual(5);
    expect((await state(page)).on).toBe(false);

    await page.mouse.move(p.x, p.y + pull, { steps: 12 });
    await expect.poll(async () => (await state(page)).on, { message: 'рывок включил лампу' }).toBe(true);
    await page.mouse.up();
    await expect.poll(async () => (await state(page)).travel, { timeout: 1000, message: 'шнур ушёл в корпус за секунду' }).toBeLessThan(0.01);
    expect((await state(page)).on, 'после отпускания лампа горит').toBe(true);
  });
}

test('короткая протяжка не включает', async ({ page }) => {
  const p = await press(page, 'ring');
  await page.mouse.move(p.x, p.y + 0.2 * (await scale(page)), { steps: 8 });
  await frames(page, 8);
  expect((await state(page)).travel, 'шнур вытянут из корпуса').toBeGreaterThan(0.05);
  await page.mouse.up();
  await asleep(page);
  expect((await state(page)).on).toBe(false);
  expect((await state(page)).travel).toBeLessThan(0.01);
});

test('клик по кольцу без движения включает', async ({ page }) => {
  await press(page, 'ring');
  await page.mouse.up();
  await expect.poll(async () => (await state(page)).on).toBe(true);
  await asleep(page);
  expect((await state(page)).travel).toBeLessThan(0.01);
});

test('кольцо в руке остаётся под курсором', async ({ page }) => {
  const p = await press(page, 'ring');
  expect(await scale(page), 'расстояния ниже заданы в пикселях для лампы такого размера').toBeGreaterThan(100);
  // подъём на 30 и 55 px, увод вбок на 50 px
  for (const [dx, dy] of [[0, -30], [0, -55], [50, -55], [50, 0], [-50, 0]]) {
    const hand = { x: p.x + dx, y: p.y + dy };
    await page.mouse.move(hand.x, hand.y, { steps: 6 });
    await expect
      .poll(async () => dist(await point(page, 'ring'), hand), { timeout: 2000, message: `отрыв кольца от курсора при сдвиге ${dx}, ${dy}` })
      .toBeLessThanOrEqual(8);
    await frames(page, 6);
    expect(dist(await point(page, 'ring'), hand), `кольцо держится под курсором при сдвиге ${dx}, ${dy}`).toBeLessThanOrEqual(8);
  }
  expect((await state(page)).on, 'лампа не переключилась').toBe(false);
});

test('кольцо не уходит под стол', async ({ page }) => {
  const p = await press(page, 'ring');
  for (const dy of [80, 160, 240, 320]) {
    await page.mouse.move(p.x, p.y + dy, { steps: 6 });
    await frames(page, 6);
    expect((await ringInfo(page)).aboveFloor, `высота кольца над столом при протяжке на ${dy} px`).toBeGreaterThanOrEqual(0);
  }
  await page.mouse.up();
  await asleep(page);
  expect((await ringInfo(page)).aboveFloor).toBeGreaterThanOrEqual(0);
});

test('кольцо не входит в панель и не включает лампу при движении вверх', async ({ page }) => {
  const p = await press(page, 'ring');
  // 240 и 420 px: кольцо уже над нижней кромкой панели; на пути туда оно проходит саму кромку, там его и выталкивает из корпуса
  for (const dy of [90, 110, 130, 150, 170, 240, 420]) {
    await page.mouse.move(p.x, p.y - dy, { steps: 10 });
    await frames(page, 8);
    expect((await ringInfo(page)).insidePanel, `кольцо внутри панели при подъёме на ${dy} px`).toBe(false);
    expect((await state(page)).on, `лампа при подъёме на ${dy} px`).toBe(false);
  }
  await page.mouse.up();
  await asleep(page);
  expect((await ringInfo(page)).insidePanel).toBe(false);
  expect((await state(page)).on).toBe(false);
});

test('жест по шнуру не выделяет текст страницы', async ({ page }) => {
  const p = await press(page, 'ring');
  await page.mouse.move(p.x - 300, p.y - 40, { steps: 10 });
  await page.mouse.up();
  expect(await page.evaluate(() => String(window.getSelection()))).toBe('');
});

test('кнопка страницы: Enter включает лампу, подпись состояния меняется', async ({ page }) => {
  await openScene(page);
  const label = page.locator('.vs-state');
  await expect(label).toHaveText('выключена');
  await expect(page.locator('html')).toHaveAttribute('data-vs-light', 'off');

  const url = page.url();
  await page.locator('.vs-pull').evaluate((wrapper) => {
    const control = [wrapper, ...wrapper.querySelectorAll<HTMLElement>('*')].find((el) => (el as HTMLElement).tabIndex >= 0) as HTMLElement | undefined;
    if (!control) throw new Error('в .vs-pull нет узла, который получает фокус');
    control.focus();
  });
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await state(page)).on).toBe(true);
  await expect(label).toHaveText('включена');
  await expect(page.locator('html')).toHaveAttribute('data-vs-light', 'on');
  expect(page.url(), 'кнопка не уводит со страницы').toBe(url);

  await page.keyboard.press('Enter');
  await expect.poll(async () => (await state(page)).on).toBe(false);
  await expect(label).toHaveText('выключена');
  await expect(page.locator('html')).toHaveAttribute('data-vs-light', 'off');
});

test('ссылка страницы поверх кольца получает клик, а лампа под ней не берётся', async ({ page }) => {
  await openScene(page);
  await asleep(page);
  const ring = await point(page, 'ring');
  await page.mouse.move(ring.x, ring.y);
  expect(await cursor(page), 'без ссылки кольцо под курсором берётся').toBe('grab');

  const link = await coverWithLink(page, ring);
  await page.mouse.move(ring.x + 1, ring.y);
  expect(await cursor(page), 'курсор над ссылкой не зовёт взять лампу').not.toBe('grab');

  // нажатие и протяжка, которой хватило бы на рывок
  await page.mouse.down();
  await frames(page);
  expect(await cursor(page), 'нажатие на ссылку лампу не берёт').not.toBe('grabbing');
  await page.mouse.move(ring.x + 1, ring.y + 0.5 * (await scale(page)), { steps: 10 });
  await frames(page, 8);
  expect(dist(await point(page, 'ring'), ring), 'кольцо осталось на месте, px').toBeLessThanOrEqual(1);
  expect((await state(page)).travel, 'шнур не вытянут').toBe(0);
  expect((await state(page)).on, 'лампа не включилась').toBe(false);
  await page.mouse.up();

  // настоящий клик доходит до ссылки и не считается касанием кольца
  await link.click();
  await expect(link).toHaveAttribute('data-clicks', '1');
  await asleep(page);
  expect((await state(page)).on, 'клик по ссылке лампу не включил').toBe(false);

  await link.evaluate((el) => el.remove());
  await page.mouse.move(ring.x, ring.y);
  expect(await cursor(page), 'без ссылки кольцо снова берётся').toBe('grab');
});

test('кнопка без адреса получает роль, фокус и клавиши Enter и пробел', async ({ page }) => {
  test.skip(LIVE, 'адрес у кнопки убирает только стенд');
  await openScene(page, '?nohref=1');
  const control = page.locator('.vs-pull a');
  await expect(control).not.toHaveAttribute('href', /.*/);
  await expect(control).toHaveAttribute('role', 'button');
  await expect(control).toHaveAttribute('tabindex', '0');
  await control.focus();
  const scrollY = await page.evaluate(() => window.scrollY);
  await page.keyboard.press('Space');
  await expect.poll(async () => (await state(page)).on, { message: 'пробел включил лампу' }).toBe(true);
  expect(await page.evaluate(() => window.scrollY), 'пробел не прокрутил страницу').toBe(scrollY);
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await state(page)).on, { message: 'Enter выключил лампу' }).toBe(false);
});
