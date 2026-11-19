import { expect, test, type Page } from '@playwright/test';
import { LIVE, open } from './open';

// Ширина «ЛУМА» в кеглях, Sofia Sans, -0.05em: 2,528 при lang="ru", 2,456 с болгарской «Л» без него, 2,397 при начертании 900.
const MIN = 2.5;
const MAX = 2.56;

/**
 * Ширина слова в кеглях. Tilda масштабирует блок CSS-свойством zoom на обёртке .t396__elem:
 * рамки (getBoundingClientRect, в том числе у Range) уже умножены на zoom, а вычисленный font-size нет.
 */
function measurePoster(page: Page) {
  return page.evaluate(async () => {
    const wrapper = document.querySelector('.vs-poster')!;
    const walker = document.createTreeWalker(wrapper, NodeFilter.SHOW_TEXT);
    let text: Text | null = null;
    for (let n = walker.nextNode(); n && !text; n = walker.nextNode()) if ((n.textContent ?? '').trim()) text = n as Text;
    const parent = text!.parentElement!;
    const style = getComputedStyle(parent);
    await document.fonts.load(`${style.fontWeight} ${style.fontSize} ${style.fontFamily}`, text!.data);
    await document.fonts.ready;
    const range = document.createRange();
    range.selectNodeContents(text!);
    const width = range.getBoundingClientRect().width;
    const fontSize = parseFloat(getComputedStyle(parent).fontSize);
    const zoom = parseFloat(getComputedStyle(wrapper).zoom) || 1;
    return { word: text!.data.trim(), ratio: width / (fontSize * zoom), zoom, lang: document.documentElement.lang };
  });
}

test('крупный текст набран Sofia Sans 1000 с русской «Л»', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  const m = await measurePoster(page);
  expect(m.word).toBe('ЛУМА');
  expect(m.ratio).toBeGreaterThan(MIN);
  expect(m.ratio).toBeLessThan(MAX);
});

test('крупный текст набран Sofia Sans 1000 с русской «Л», zoom 1.2 как у Tilda', async ({ page }) => {
  test.skip(LIVE, 'zoom ставит только стенд');
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, '?zoom=1.2');
  const m = await measurePoster(page);
  expect(m.zoom).toBeCloseTo(1.2, 5);
  expect(m.ratio).toBeGreaterThan(MIN);
  expect(m.ratio).toBeLessThan(MAX);
});

test('без lang у html boot ставит ru, и «Л» русская', async ({ page }) => {
  test.skip(LIVE, 'lang убирает только стенд');
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, '?nolang=1');
  const m = await measurePoster(page);
  expect(m.lang).toBe('ru');
  expect(m.ratio).toBeGreaterThan(MIN);
  expect(m.ratio).toBeLessThan(MAX);
});
