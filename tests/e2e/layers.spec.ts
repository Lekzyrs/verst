import { expect, test } from '@playwright/test';
import { LIVE, open, settled } from './open';

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
    // Выполняется в странице, поэтому самодостаточна. Холст не ловит события, и elementsFromPoint его не видит:
    // события включены только на время проверки.
    const topAtCentre = (el: Element): string => {
      const describe = (e: Element | undefined): string =>
        e ? e.tagName.toLowerCase() + (e.id ? `#${e.id}` : '') + [...e.classList].map((c) => `.${c}`).join('') : 'ничего';
      const canvas = document.getElementById('vs-canvas')!;
      canvas.style.pointerEvents = 'auto';
      try {
        const b = el.getBoundingClientRect();
        const top = document.elementsFromPoint(b.left + b.width / 2, b.top + b.height / 2)[0];
        return top && el.contains(top) ? 'подпись' : describe(top);
      } finally {
        canvas.style.pointerEvents = '';
      }
    };
    expect(await page.locator('#vs-canvas').count(), 'на странице есть #vs-canvas').toBe(1);
    const poster = page.locator('.vs-poster').first();
    expect(await poster.count(), 'на странице есть .vs-poster').toBe(1);
    await expect.poll(() => poster.evaluate(topAtCentre), { message: 'сверху в центре крупного текста', timeout: 4000 }).toBe('canvas#vs-canvas');
    const labels = page.locator('.vs-label');
    const n = await labels.count();
    expect(n).toBeGreaterThan(0);
    const scroll = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
    for (let i = 0; i < n; i += 1) {
      const label = labels.nth(i);
      const name = ((await label.textContent()) ?? '').trim();
      // Подпись ниже первого экрана не имеет точки на экране: сначала в видимую область.
      await label.scrollIntoViewIfNeeded();
      await expect.poll(() => label.evaluate(topAtCentre), { message: `сверху в центре подписи «${name}»`, timeout: 4000 }).toBe('подпись');
    }
    await page.evaluate(({ x, y }) => window.scrollTo(x, y), scroll);
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

  const wide = await settled(rect, 'рамка сцены в широком окне устоялась');
  await expect(async () => {
    const r = await rect();
    const box = (await page.locator('.vs-stage').boundingBox())!;
    expect(r.left).toBeCloseTo(box.x, 0);
    expect(r.top).toBeCloseTo(box.y, 0);
    expect(r.width).toBeCloseTo(box.width, 0);
    expect(r.height).toBeCloseTo(box.height, 0);
  }).toPass({ timeout: 4000 });

  await page.evaluate(() => {
    window.__layouts = 0;
    window.__verst!.layers.onLayout(() => { window.__layouts = (window.__layouts ?? 0) + 1; });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => window.__layouts), { message: 'onLayout после смены окна' }).toBeGreaterThan(0);
  await expect(async () => {
    const r = await rect();
    expect(r).not.toEqual(wide);
    expect(r.left).toBeGreaterThanOrEqual(0);
    expect(r.left + r.width).toBeLessThanOrEqual(390.5);
  }).toPass({ timeout: 4000 });
  const narrow = await settled(rect, 'рамка сцены в узком окне устоялась');

  await page.evaluate(() => {
    window.__layouts = 0;
    window.scrollTo(0, 200);
  });
  await expect.poll(() => page.evaluate(() => window.__layouts), { message: 'onLayout после прокрутки' }).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(200);
  await expect(async () => {
    const r = await rect();
    expect(r.top).toBeCloseTo(narrow.top - 200, 0);
    expect(r.left).toBeCloseTo(narrow.left, 0);
  }).toPass({ timeout: 4000 });
});

// Tilda расставляет элементы скриптом, записью inline-стилей: метка может сдвинуться, не меняя размеров.
for (const zoom of ['', '1.2']) {
  test(`onLayout срабатывает, когда метка сдвинулась без смены размера${zoom ? `, zoom ${zoom}` : ''}`, async ({ page }) => {
    test.skip(LIVE && zoom !== '', 'zoom ставит только стенд');
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, zoom ? `?zoom=${zoom}` : '');
    await page.waitForLoadState('load');
    const frames = (): Promise<void> =>
      page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
    await page.evaluate(() => document.fonts.ready);
    await frames(); // первые уведомления (ResizeObserver, шрифты) уже прошли
    const rect = () => page.evaluate(() => window.__verst!.layers.stageRect());
    const before = await settled(rect, 'рамка сцены до сдвига устоялась');
    const r = await page.evaluate(async () => {
      const layers = window.__verst!.layers;
      const marker = document.querySelector<HTMLElement>('.vs-stage')!;
      window.__layouts = 0;
      layers.onLayout(() => { window.__layouts = (window.__layouts ?? 0) + 1; });
      const left = parseFloat(getComputedStyle(marker).left);
      // Три записи подряд, как у скрипта Tilda; итог: left + 40px.
      for (const dx of [10, 20, 40]) marker.style.left = `${left + dx}px`;
      await new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
      return { layouts: window.__layouts, zoom: parseFloat(getComputedStyle(marker).zoom) || 1 };
    });
    if (LIVE) await expect.poll(() => page.evaluate(() => window.__layouts), { message: 'onLayout после сдвига метки' }).toBeGreaterThan(0);
    else {
      expect(r.layouts, 'onLayout после сдвига метки').toBeGreaterThan(0);
      expect(r.layouts, 'несколько записей за кадр дают один вызов').toBe(1);
    }
    if (zoom) expect(r.zoom).toBeCloseTo(Number(zoom), 5);
    await expect(async () => {
      const after = await rect();
      expect(after.left - before.left).toBeCloseTo(40 * r.zoom, 0);
      expect(after.width - before.width).toBeCloseTo(0, 1);
      expect(after.height - before.height).toBeCloseTo(0, 1);
    }).toPass({ timeout: 4000 });
  });
}

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
    document.querySelector<HTMLElement>('.vs-stage')!.style.left = '10px';
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
  const r = await settled(() => page.evaluate(() => window.__verst!.layers.stageRect()), 'рамка сцены устоялась');
  await page.mouse.move(r.left + r.width / 2, r.top + r.height / 2);
  await page.mouse.wheel(0, 300);
  await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(300);
});
