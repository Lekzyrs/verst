import { expect, type Page } from '@playwright/test';

export const LIVE: boolean = /^https:/.test(process.env.VERST_URL ?? '');

/** Открывает стенд или живую страницу (query дописывается к адресу) и ждёт атрибут html[data-vs]. */
export async function open(page: Page, query = ''): Promise<void> {
  await page.goto(query);
  await page.waitForSelector('html[data-vs]', { state: 'attached' });
}

/**
 * Читает значение, пока две подряд прочитанные копии не совпадут, и возвращает его.
 * Нужна для «рамки до»: на живой странице Tilda перезаписывает раскладку асинхронно, и первое чтение может быть промежуточным.
 */
export async function settled<T>(read: () => Promise<T>, message = 'раскладка устоялась'): Promise<T> {
  let prev = JSON.stringify(await read());
  await expect
    .poll(async () => {
      const cur = JSON.stringify(await read());
      const same = cur === prev;
      prev = cur;
      return same;
    }, { message, timeout: 4000 })
    .toBe(true);
  return JSON.parse(prev) as T;
}
