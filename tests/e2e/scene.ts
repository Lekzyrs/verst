import { expect, type Locator, type Page } from '@playwright/test';
import { open } from './open';

export type Spot = 'ring' | 'knob' | 'head' | number;
export interface Pt { x: number; y: number }

/** Окно, в котором проверяется рука: в нём лампа стоит так же крупно, как в прототипе. */
export const DESK = { width: 1440, height: 900 };

/** Открывает страницу и ждёт: загрузку, шрифты и первый нарисованный кадр. */
export async function openScene(page: Page, query = ''): Promise<void> {
  await open(page, query);
  await page.waitForLoadState('load');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => (window.__verst?.frames ?? 0) > 0);
}

/** true, если за пять кадров браузера сцена не нарисовала ни одного своего: цикл спит. */
export function sleeping(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    const before = window.__verst!.frames;
    for (let i = 0; i < 5; i += 1) await new Promise((done) => requestAnimationFrame(done));
    return window.__verst!.frames === before;
  });
}

/** Ждёт, пока сцена уснёт. */
export async function asleep(page: Page, timeout = 15_000): Promise<void> {
  await expect.poll(() => sleeping(page), { timeout, message: 'сцена уснула' }).toBe(true);
}

/** Пропускает n кадров браузера. */
export function frames(page: Page, n = 4): Promise<void> {
  return page.evaluate(async (count) => {
    for (let i = 0; i < count; i += 1) await new Promise((done) => requestAnimationFrame(done));
  }, n);
}

export const state = (page: Page) => page.evaluate(() => window.__verst!.state());
export const point = (page: Page, what: Spot): Promise<Pt> => page.evaluate((w) => window.__verst!.point(w), what);
export const scale = (page: Page): Promise<number> => page.evaluate(() => window.__verst!.scale());
export const cursor = (page: Page): Promise<string> => page.evaluate(() => getComputedStyle(document.documentElement).cursor);
export const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Включает лампу кнопкой страницы и ждёт, пока она загорится. */
export async function switchOn(page: Page): Promise<void> {
  await page.locator('.vs-pull').click();
  await expect.poll(async () => (await state(page)).on, { message: 'лампа включилась' }).toBe(true);
}

/** Собирает ошибки консоли и страницы. */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

/**
 * Кладёт поверх точки окна ссылку 80×80, как подпись Tilda поверх лампы: в теле страницы, выше холста, ловит события.
 * Клики считает в data-clicks и никуда не ведёт. Живёт только в открытой вкладке теста.
 */
export async function coverWithLink(page: Page, at: Pt): Promise<Locator> {
  await page.evaluate(({ x, y }) => {
    const link = document.createElement('a');
    link.id = 'vs-test-cover';
    link.href = '#';
    link.textContent = 'ссылка';
    link.dataset.clicks = '0';
    link.style.cssText = `position:absolute;left:${x + window.scrollX - 40}px;top:${y + window.scrollY - 40}px;width:80px;height:80px;z-index:10`;
    link.addEventListener('click', (e) => {
      e.preventDefault();
      link.dataset.clicks = String(Number(link.dataset.clicks) + 1);
    });
    document.body.append(link);
  }, at);
  const link = page.locator('#vs-test-cover');
  const onTop = await link.evaluate((el, { x, y }) => document.elementFromPoint(x, y) === el, at);
  expect(onTop, 'ссылка лежит под указателем поверх всего').toBe(true);
  return link;
}
