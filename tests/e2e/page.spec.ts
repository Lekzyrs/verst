import { expect, test, type Page } from '@playwright/test';
import { LIVE } from './open';
import { asleep, collectErrors, DESK, openScene } from './scene';

// Голова страницы Tilda (tilda/head.template.html): цвет текста за светом лампы (L2), viewport-fit=cover (P1),
// тег бандла с integrity и crossorigin, шрифт страницы. На стенде голова та же, на живой странице это опубликованная голова.
test.use({ viewport: DESK, reducedMotion: 'reduce' });

type Rgb = [number, number, number];

/** Разбирает вычисленный цвет: rgb(...) или color(srgb ...), как отдают разные движки для color-mix. */
function parseColor(css: string): Rgb {
  const srgb = /^color\(srgb\s+([-\d.e]+)\s+([-\d.e]+)\s+([-\d.e]+)/.exec(css);
  if (srgb) return [Number(srgb[1]) * 255, Number(srgb[2]) * 255, Number(srgb[3]) * 255];
  const rgb = /^rgba?\(\s*([-\d.e]+)[,\s]+([-\d.e]+)[,\s]+([-\d.e]+)/.exec(css);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  throw new Error(`цвет не разобран: ${css}`);
}

const channel = (c: number): number => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]: Rgb): number => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
/** Контраст по WCAG 2: (L1 + 0,05) / (L2 + 0,05), светлый цвет в числителе. */
function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}
const hex = (h: string): Rgb => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/** Ставит свет lit через слои страницы (лампа спит, цикл значение не перезапишет) и читает цвета: фон body и текст слова. */
function paint(page: Page, lit: number): Promise<{ bg: string; text: string }> {
  return page.evaluate((l) => {
    window.__verst!.layers.setLight(l, 600, 600);
    return {
      bg: getComputedStyle(document.body).backgroundColor,
      text: getComputedStyle(document.querySelector('.vs-poster .tn-atom')!).color,
    };
  }, lit);
}

const near = (got: Rgb, want: Rgb): void => {
  for (let i = 0; i < 3; i += 1) expect(Math.abs(got[i]! - want[i]!), `канал ${i}: ${got.map(Math.round)} ожидалось ${want}`).toBeLessThanOrEqual(1.5);
};

test.describe('цвета страницы следуют за светом', () => {
  test.beforeEach(async ({ page }) => {
    await openScene(page);
    await asleep(page);
  });

  test('текст читается при любом свете: контраст не ниже 3 на каждом шаге 0,01', async ({ page }) => {
    const worst: Array<{ lit: number; ratio: number }> = [];
    for (let step = 0; step <= 100; step += 1) {
      const lit = step / 100;
      const { bg, text } = await paint(page, lit);
      const ratio = contrast(parseColor(bg), parseColor(text));
      if (ratio < 3) worst.push({ lit, ratio: Math.round(ratio * 100) / 100 });
    }
    expect(worst, `шаги света с контрастом ниже 3: ${JSON.stringify(worst)}`).toEqual([]);
  });

  test('лампа погашена: фон #2b2707, текст #f4f1e4', async ({ page }) => {
    const { bg, text } = await paint(page, 0);
    near(parseColor(bg), hex('#2b2707'));
    near(parseColor(text), hex('#f4f1e4'));
  });

  test('лампа горит: фон #f2c200, текст #141200', async ({ page }) => {
    const { bg, text } = await paint(page, 1);
    near(parseColor(bg), hex('#f2c200'));
    near(parseColor(text), hex('#141200'));
  });
});

test('текст страницы набран семейством Sofia Sans VF: слово и подпись', async ({ page }) => {
  await openScene(page);
  const families = await page.evaluate(() => ({
    poster: getComputedStyle(document.querySelector('.vs-poster .tn-atom')!).fontFamily,
    label: getComputedStyle(document.querySelector('.vs-label .tn-atom')!).fontFamily,
  }));
  expect(families.poster).toMatch(/^"?Sofia Sans VF"?,/);
  expect(families.label).toMatch(/^"?Sofia Sans VF"?,/);
});

test('шрифт: грань Sofia Sans VF загружена, грани «Sofia Sans» без VF странице не нужны', async ({ page }) => {
  await openScene(page);
  await page.waitForFunction(() => document.fonts.check('1000 34px "Sofia Sans VF"'));
  const faces = await page.evaluate(() => [...document.fonts].map((f) => ({ family: f.family.replace(/["']/g, ''), status: f.status })));
  expect(faces.find((f) => f.family === 'Sofia Sans VF'), 'в document.fonts есть Sofia Sans VF').toBeDefined();
  expect(faces.filter((f) => f.family === 'Sofia Sans VF').map((f) => f.status)).toContain('loaded');
  expect(faces.filter((f) => f.family === 'Sofia Sans'), 'грани «Sofia Sans» без VF нет').toEqual([]);
});

test.describe('опубликованная голова', () => {
  test.skip(!LIVE, 'на стенде тег бандла и viewport другие: проверяется только живая страница');

  test('тег бандла с integrity sha384 и crossorigin=anonymous', async ({ page }) => {
    await openScene(page);
    const tag = await page.evaluate(() => {
      const el = document.querySelector('script[src*="/verst/assets/verst-"]');
      return el ? { integrity: el.getAttribute('integrity'), crossorigin: el.getAttribute('crossorigin') } : null;
    });
    expect(tag, 'тег бандла найден').not.toBeNull();
    expect(tag!.integrity).toMatch(/^sha384-/);
    expect(tag!.crossorigin).toBe('anonymous');
  });

  test('viewport содержит viewport-fit=cover', async ({ page }) => {
    await openScene(page);
    const content = await page.evaluate(() => [...document.querySelectorAll('meta[name="viewport"]')].map((m) => m.getAttribute('content') ?? ''));
    expect(content.length).toBeGreaterThan(0);
    for (const c of content) expect(c).toContain('viewport-fit=cover');
  });
});

test('второе подключение скрипта ничего не меняет: один холст, ошибок нет', async ({ page }) => {
  const errors = collectErrors(page);
  await openScene(page);
  await asleep(page);
  // Стенд подключает исходник заново под другим адресом (отдельный экземпляр модуля), живая страница получает копию тега бандла.
  await page.evaluate(async (live) => {
    if (live) {
      const first = document.querySelector<HTMLScriptElement>('script[src*="/verst/assets/verst-"]')!;
      const again = document.createElement('script');
      again.src = first.src;
      again.integrity = first.integrity;
      again.crossOrigin = first.crossOrigin;
      await new Promise((done) => { again.onload = again.onerror = done; document.head.append(again); });
    } else {
      const second = '/src/index.ts?second';
      await import(/* @vite-ignore */ second);
    }
  }, LIVE);
  await page.waitForTimeout(300);
  expect(await page.locator('#vs-canvas').count(), 'холст один').toBe(1);
  expect(await page.locator('#vs-falloff, #vs-pool').count(), 'слоёв света по одному').toBe(2);
  expect(await page.locator('style#vs-layers').count()).toBe(1);
  expect(errors).toEqual([]);
});
