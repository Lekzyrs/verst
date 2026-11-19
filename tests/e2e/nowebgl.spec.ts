import { expect, test, type Page } from '@playwright/test';
import { open } from './open';
import { collectErrors, openScene, state } from './scene';

test.use({ viewport: { width: 1440, height: 900 } });

const drawn = (page: Page): Promise<number> => page.evaluate(() => window.__verst!.frames);

/** Страница выглядит как без скрипта: ни холста, ни слоёв света, подписи на месте, кнопка остаётся ссылкой. */
async function expectPlainPage(page: Page): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('data-vs', 'static');
  await expect(page.locator('#vs-canvas, #vs-pool, #vs-falloff')).toHaveCount(0);
  await expect(page.locator('.vs-poster')).toBeVisible();
  await expect(page.locator('.vs-state')).toHaveText('выключена');
  await expect(page.locator('html')).not.toHaveAttribute('data-vs-light', /.*/);
  expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--vs-lit'))).toBe('');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).cursor)).toBe('auto');
}

test('без WebGL страница остаётся как без скрипта', async ({ page }) => {
  const errors = collectErrors(page);
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (type === 'webgl2' || type === 'webgl' || type === 'experimental-webgl') return null;
      return (original as (...args: unknown[]) => unknown).call(this, type, ...rest);
    } as typeof original;
  });
  await open(page);
  await page.waitForLoadState('load');
  await expectPlainPage(page);
  expect(await page.evaluate(() => window.__verst === undefined)).toBe(true);
  expect(errors).toEqual([]);
});

test('потеря контекста WebGL останавливает сцену и возвращает страницу', async ({ page }) => {
  const errors = collectErrors(page);
  await openScene(page);
  await expect(page.locator('html')).toHaveAttribute('data-vs', 'live');
  await page.locator('.vs-pull').click();
  await expect.poll(async () => (await state(page)).on).toBe(true);
  await expect(page.locator('.vs-state')).toHaveText('включена');

  await page.evaluate(() => {
    const gl = document.querySelector<HTMLCanvasElement>('#vs-canvas')!.getContext('webgl2')!;
    gl.getExtension('WEBGL_lose_context')!.loseContext();
  });
  await expectPlainPage(page);
  const before = await drawn(page);
  await page.mouse.move(700, 400);
  await page.mouse.move(900, 500, { steps: 5 });
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await page.waitForTimeout(500);
  expect(await drawn(page), 'цикл остановлен').toBe(before);
  expect(errors).toEqual([]);
});

test('ошибка в кадре останавливает сцену и пишется в консоль один раз', async ({ page }) => {
  const errors = collectErrors(page);
  await openScene(page);
  await page.evaluate(() => {
    window.__verst!.layers.setLight = () => { throw new Error('проверка: кадр упал'); };
    window.dispatchEvent(new Event('resize'));
  });
  await expectPlainPage(page);
  const before = await drawn(page);
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await page.waitForTimeout(500);
  expect(await drawn(page), 'цикл остановлен').toBe(before);
  expect(errors.length, `ошибка в консоли одна: ${errors.join(' | ')}`).toBe(1);
  expect(errors[0]).toContain('проверка: кадр упал');
});
