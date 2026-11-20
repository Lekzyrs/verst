import { expect, test, type Page } from '@playwright/test';
import { MAX_RATIO, PIXEL_BUDGET } from '../../src/core/pixelBudget';
import { settled } from './open';
import { asleep, frames, openScene, point, state } from './scene';

// Без подсказки: рамка лампы меряется в покое.
test.use({ reducedMotion: 'reduce' });

// Окна из глобальных ограничений: Chromium 1440×900, Firefox 980×1085, ширина 390.
const SIZES = [
  { width: 1440, height: 900 },
  { width: 980, height: 1085 },
  { width: 390, height: 844 },
];
const sizeName = (s: { width: number; height: number }): string => `${s.width}×${s.height}`;
const TOLERANCE = 12;

/** На сколько пикселей рамка лампы выходит за рамку метки сцены с каждой стороны (отрицательное: запас). */
function overflow(page: Page) {
  return page.evaluate(() => {
    const b = window.__verst!.bounds();
    const s = window.__verst!.layers.stageRect();
    return {
      left: s.left - b.left,
      top: s.top - b.top,
      right: b.right - (s.left + s.width),
      bottom: b.bottom - (s.top + s.height),
      width: b.right - b.left,
      height: b.bottom - b.top,
      stage: Math.min(s.width, s.height),
    };
  });
}

async function expectInsideStage(page: Page, where: string): Promise<void> {
  await expect(async () => {
    const o = await overflow(page);
    for (const side of ['left', 'top', 'right', 'bottom'] as const) expect(o[side], `выход за рамку сцены: ${side}, ${where}`).toBeLessThanOrEqual(TOLERANCE);
    expect(Math.max(o.width, o.height), `лампа не мельче трети рамки, ${where}`).toBeGreaterThan(o.stage / 3);
  }).toPass({ timeout: 4000 });
}

const buffer = (page: Page) =>
  page.evaluate(() => {
    const c = window.__verst!.layers.canvas;
    return { width: c.width, height: c.height, cssWidth: c.clientWidth, cssHeight: c.clientHeight };
  });

/** Холст занимает окно; полоса прокрутки, если она есть, отнимает у ширины не больше 20 px. */
const fills = (b: { cssWidth: number; cssHeight: number }, size: { width: number; height: number }): boolean =>
  b.cssWidth <= size.width && b.cssWidth >= size.width - 20 && b.cssHeight === size.height;

for (const size of SIZES) {
  test(`лампа целиком в рамке сцены, ${sizeName(size)}`, async ({ page }) => {
    await page.setViewportSize(size);
    await openScene(page);
    await asleep(page);
    await expectInsideStage(page, sizeName(size));
    await expect.poll(async () => fills(await buffer(page), size), { message: 'холст занимает окно' }).toBe(true);
    const b = await buffer(page);
    expect(b.width * b.height, 'кадр в бюджете пикселей').toBeLessThanOrEqual(PIXEL_BUDGET);
  });
}

test('лампа остаётся в рамке сцены при смене окна на лету', async ({ page }) => {
  await page.setViewportSize(SIZES[0]);
  await openScene(page);
  await asleep(page);
  await expectInsideStage(page, sizeName(SIZES[0]));
  for (const size of [SIZES[1], SIZES[2], SIZES[0]]) {
    await page.setViewportSize(size);
    await expect.poll(async () => fills(await buffer(page), size), { message: 'холст принял новый размер окна' }).toBe(true);
    await asleep(page);
    await expectInsideStage(page, `после смены окна на ${sizeName(size)}`);
    await expect
      .poll(async () => { const b = await buffer(page); return b.width / b.height; }, { message: 'буфер холста повторяет пропорции окна' })
      .toBeCloseTo(size.width / size.height, 1);
  }
});

test('лампа едет вместе со страницей при прокрутке', async ({ page }) => {
  await page.setViewportSize(SIZES[0]);
  await openScene(page);
  await asleep(page);
  const before = await settled(() => page.evaluate(() => window.__verst!.bounds()), 'рамка лампы устоялась');
  await page.evaluate(() => window.scrollTo(0, 200));
  await expect.poll(async () => (await page.evaluate(() => window.__verst!.bounds())).top, { message: 'лампа сдвинулась вверх на 200 px' }).toBeCloseTo(before.top - 200, 0);
  await expectInsideStage(page, 'после прокрутки');
});

test('лампа остаётся в рамке сцены при любом повороте и наклоне', async ({ page }) => {
  await page.setViewportSize(SIZES[0]);
  await openScene(page);
  await asleep(page);
  const head = await point(page, 'head');
  const spin = (await state(page)).spin;
  await page.mouse.move(head.x, head.y);
  await page.mouse.down();
  // Полный оборот по 45°: 0,006 рад на пиксель, 131 px на шаг. Рука не отпускает панель, чтобы не добавлять инерцию.
  for (let turn = 1; turn <= 8; turn += 1) {
    await page.mouse.move(head.x - turn * 131, head.y, { steps: 4 });
    await frames(page, 3);
    expect(Math.abs((await state(page)).spin - spin)).toBeCloseTo(turn * 131 * 0.006, 2);
    await expectInsideStage(page, `поворот на ${turn * 45}°`);
  }
  // вверх и вниз на 300 px от точки нажатия: курсор остаётся в окне
  for (const [dy, pitch] of [[-300, -0.45], [300, 1.3]]) {
    await page.mouse.move(head.x - 8 * 131, head.y + dy, { steps: 8 });
    await frames(page, 3);
    expect((await state(page)).pitch).toBeCloseTo(pitch, 5);
    await expectInsideStage(page, `наклон ${pitch} рад`);
  }
  await page.mouse.up();
});

test.describe('плотный экран', () => {
  test.use({ deviceScaleFactor: 2 });

  test('кадр на плотном экране не больше 2,4 млн пикселей и не плотнее 1,5', async ({ page }) => {
    await page.setViewportSize(SIZES[0]);
    await openScene(page);
    const wide = await buffer(page);
    expect(wide.width * wide.height).toBeLessThanOrEqual(PIXEL_BUDGET);
    expect(wide.width * wide.height, 'бюджет использован').toBeGreaterThan(PIXEL_BUDGET * 0.97);

    await page.setViewportSize(SIZES[2]);
    await expect.poll(async () => fills(await buffer(page), SIZES[2])).toBe(true);
    await expect
      .poll(async () => { const b = await buffer(page); return b.width / b.cssWidth; }, { message: 'плотность на узком окне упирается в предел' })
      .toBeCloseTo(MAX_RATIO, 1);
    await expectInsideStage(page, 'плотный экран, узкое окно');
  });
});
