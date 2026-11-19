import type { Page } from '@playwright/test';

export const LIVE: boolean = /^https:/.test(process.env.VERST_URL ?? '');

/** Открывает стенд или живую страницу (query дописывается к адресу) и ждёт атрибут html[data-vs]. */
export async function open(page: Page, query = ''): Promise<void> {
  await page.goto(query);
  await page.waitForSelector('html[data-vs]', { state: 'attached' });
}
