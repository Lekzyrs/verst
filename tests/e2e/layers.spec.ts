import { expect, test } from '@playwright/test';
import { LIVE, open } from './open';

declare global {
  interface Window {
    /** Стенд: сколько настоящих кликов получила каждая ссылка и кнопка (ключ: data-click). */
    __clicks?: Record<string, number>;
    /** Тест: сколько раз сработал onLayout. */
    __layouts?: number;
  }
}

// Окна из глобальных ограничений: Chromium 1440×900, Firefox 980×1085, ширина 390.
const SIZES = [
  { width: 1440, height: 900 },
  { width: 980, height: 1085 },
  { width: 390, height: 844 },
];
const sizeName = (s: { width: number; height: number }): string => `${s.width}×${s.height}`;

for (const size of SIZES) {
  test(`холст над крупным текстом и под подписями, ${sizeName(size)}`, async ({ page }) => {
    await page.setViewportSize(size);
    await open(page);
    const r = await page.evaluate(() => {
      const describe = (el: Element | undefined): string =>
        el ? el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '') + [...el.classList].map((c) => `.${c}`).join('') : 'ничего';
      const centre = (el: Element): [number, number] => {
        const b = el.getBoundingClientRect();
        return [b.left + b.width / 2, b.top + b.height / 2];
      };
      const canvas = document.getElementById('vs-canvas');
      const poster = document.querySelector('.vs-poster');
      if (!canvas || !poster) return null;
      // Холст не ловит события, и elementsFromPoint его не видит: события включены только на время проверки.
      canvas.style.pointerEvents = 'auto';
      try {
        const labels = [...document.querySelectorAll('.vs-label')].map((label) => {
          const top = document.elementsFromPoint(...centre(label))[0];
          return { label: (label.textContent ?? '').trim(), top: top && label.contains(top) ? 'подпись' : describe(top) };
        });
        return { atPoster: describe(document.elementsFromPoint(...centre(poster))[0]), labels };
      } finally {
        canvas.style.pointerEvents = '';
      }
    });
    expect(r, 'на странице есть #vs-canvas и .vs-poster').not.toBeNull();
    expect(r!.atPoster, 'сверху в центре крупного текста').toBe('canvas#vs-canvas');
    expect(r!.labels.length).toBeGreaterThan(0);
    for (const l of r!.labels) expect(l.top, `сверху в центре подписи «${l.label}»`).toBe('подпись');
  });
}

test('слои света лежат под холстом и над крупным текстом', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  const r = await page.evaluate(() => {
    const poster = document.querySelector('.vs-poster')!;
    const b = poster.getBoundingClientRect();
    const x = b.left + b.width / 2;
    const y = b.top + b.height / 2;
    // Пятно 200×200 встаёт центром в точку матрицей переноса.
    window.__verst!.layers.setPool(`matrix(1, 0, 0, 1, ${x}, ${y})`, 1);
    const found = ['vs-canvas', 'vs-pool', 'vs-falloff'].map((id) => document.getElementById(id));
    if (found.some((el) => !el)) return null;
    const layers = found as HTMLElement[];
    const [canvas, pool, falloff] = layers;
    const idle = layers.map((el) => getComputedStyle(el).pointerEvents);
    for (const el of layers) el.style.pointerEvents = 'auto';
    const stack = document.elementsFromPoint(x, y);
    for (const el of layers) el.style.pointerEvents = '';
    const p = pool.getBoundingClientRect();
    const ps = getComputedStyle(pool);
    const spot = { dx: p.left + p.width / 2 - x, dy: p.top + p.height / 2 - y, width: p.width, height: p.height, blend: ps.mixBlendMode, opacity: Number(ps.opacity) };
    window.__verst!.layers.setPool(null, 1);
    return {
      idle,
      canvas: stack.indexOf(canvas),
      pool: stack.indexOf(pool),
      falloff: stack.indexOf(falloff),
      poster: stack.findIndex((el) => poster.contains(el)),
      spot,
      hiddenOpacity: Number(getComputedStyle(pool).opacity),
    };
  });
  expect(r, 'на странице есть холст и оба слоя света').not.toBeNull();
  expect(r!.idle, 'холст, пятно и спад не ловят события').toEqual(['none', 'none', 'none']);
  expect(r!.canvas, 'холст сверху').toBe(0);
  expect(r!.poster, 'крупный текст в стопке').toBeGreaterThan(0);
  for (const layer of ['pool', 'falloff'] as const) {
    expect(r![layer], `${layer} под холстом`).toBeGreaterThan(r!.canvas);
    expect(r![layer], `${layer} над крупным текстом`).toBeLessThan(r!.poster);
  }
  expect(Math.abs(r!.spot.dx)).toBeLessThan(1);
  expect(Math.abs(r!.spot.dy)).toBeLessThan(1);
  expect(r!.spot).toMatchObject({ width: 200, height: 200, blend: 'overlay', opacity: 1 });
  expect(r!.hiddenOpacity, 'setPool(null) прячет пятно').toBe(0);
});

test('рамка сцены следует за окном и прокруткой', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  const rect = () => page.evaluate(() => window.__verst!.layers.stageRect());

  const wide = await rect();
  const box = (await page.locator('.vs-stage').boundingBox())!;
  expect(wide.left).toBeCloseTo(box.x, 0);
  expect(wide.top).toBeCloseTo(box.y, 0);
  expect(wide.width).toBeCloseTo(box.width, 0);
  expect(wide.height).toBeCloseTo(box.height, 0);

  await page.evaluate(() => {
    window.__layouts = 0;
    window.__verst!.layers.onLayout(() => { window.__layouts = (window.__layouts ?? 0) + 1; });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => window.__layouts), { message: 'onLayout после смены окна' }).toBeGreaterThan(0);
  const narrow = await rect();
  expect(narrow).not.toEqual(wide);
  expect(narrow.left).toBeGreaterThanOrEqual(0);
  expect(narrow.left + narrow.width).toBeLessThanOrEqual(390.5);

  await page.evaluate(() => {
    window.__layouts = 0;
    window.scrollTo(0, 200);
  });
  await expect.poll(() => page.evaluate(() => window.__layouts), { message: 'onLayout после прокрутки' }).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(200);
  const scrolled = await rect();
  expect(scrolled.top).toBeCloseTo(narrow.top - 200, 0);
  expect(scrolled.left).toBeCloseTo(narrow.left, 0);
});

test('setLight пишет переменные', async ({ page }) => {
  await open(page);
  const v = await page.evaluate(() => {
    window.__verst!.layers.setLight(0.5, 320, 240);
    const root = getComputedStyle(document.documentElement);
    const falloff = document.getElementById('vs-falloff');
    return {
      lit: Number(root.getPropertyValue('--vs-lit')),
      x: root.getPropertyValue('--vs-lx').trim(),
      y: root.getPropertyValue('--vs-ly').trim(),
      falloff: falloff ? Number(getComputedStyle(falloff).opacity) : null,
    };
  });
  expect(v).toEqual({ lit: 0.5, x: '320px', y: '240px', falloff: 0.5 });
});

test('dispose убирает холст, свет, стили и слушателей', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  const r = await page.evaluate(async () => {
    const layers = window.__verst!.layers;
    window.__layouts = 0;
    layers.onLayout(() => { window.__layouts = (window.__layouts ?? 0) + 1; });
    layers.setLight(0.5, 10, 10);
    layers.dispose();
    window.scrollTo(0, 100);
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    const label = document.querySelector('.vs-label')!;
    return {
      left: document.querySelectorAll('#vs-canvas, #vs-pool, #vs-falloff, style#vs-layers').length,
      lit: document.documentElement.style.getPropertyValue('--vs-lit'),
      labelZ: getComputedStyle(label).zIndex,
      layouts: window.__layouts,
    };
  });
  expect(r).toEqual({ left: 0, lit: '', labelZ: '3', layouts: 0 });
});

test('без метки сцены холста нет', async ({ page }) => {
  test.skip(LIVE, 'метку сцены убирает только стенд');
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await open(page, '?nostage=1');
  await page.waitForLoadState('load');
  await expect(page.locator('.vs-stage')).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-vs', 'none');
  await expect(page.locator('#vs-canvas, #vs-pool, #vs-falloff')).toHaveCount(0);
  expect(await page.evaluate(() => window.__verst === undefined)).toBe(true);
  expect(errors).toEqual([]);
});

for (const size of SIZES) {
  test(`каждая ссылка и кнопка получает настоящий клик, ${sizeName(size)}`, async ({ page }) => {
    await page.setViewportSize(size);
    await open(page);
    const controls = page.locator('a, button');
    const n = await controls.count();
    expect(n).toBeGreaterThan(0);
    const clicked: string[] = [];
    for (let i = 0; i < n; i += 1) {
      const c = controls.nth(i);
      if (!(await c.isVisible())) continue;
      if (LIVE) {
        // Счётчика кликов на живой странице нет: проверяется, что в центре элемента сверху лежит он сам.
        await c.scrollIntoViewIfNeeded();
        const hit = await c.evaluate((el) => {
          const b = el.getBoundingClientRect();
          const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
          return { ok: top !== null && el.contains(top), what: el.outerHTML.slice(0, 120) };
        });
        expect(hit.ok, hit.what).toBe(true);
      } else {
        const id = await c.getAttribute('data-click');
        expect(id, 'у каждой ссылки и кнопки стенда есть data-click').not.toBeNull();
        await c.click();
        expect(await page.evaluate((k) => window.__clicks?.[k] ?? 0, id!), `клик по «${id}»`).toBe(1);
        clicked.push(id!);
      }
    }
    if (!LIVE) expect(clicked.sort()).toEqual(['brand', 'pull']);
  });
}

// Лампы ещё нет: «над лампой» значит над центром метки сцены, где она будет стоять.
test('колесо мыши над лампой прокручивает страницу на 300 px', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  const r = await page.evaluate(() => window.__verst!.layers.stageRect());
  await page.mouse.move(r.left + r.width / 2, r.top + r.height / 2);
  await page.mouse.wheel(0, 300);
  await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(300);
});
