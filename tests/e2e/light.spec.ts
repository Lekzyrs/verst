import { expect, test, type Page } from '@playwright/test';
import { asleep, DESK, frames, openScene, point, switchOn } from './scene';

// Свет лампы на странице: пятно (#vs-pool) и спад (--vs-lx, --vs-ly) должны меняться плавно, пока лампу крутят и наклоняют.
test.use({ reducedMotion: 'reduce', viewport: DESK });

const MAX_CENTRE_STEP = 60; // px за кадр: центр спада и центр пятна
const MAX_OPACITY_STEP = 0.15; // за кадр
const SAMPLE_MS = 5000; // не меньше: после отпускания лампа ещё докручивается

interface Sample { lx: number; ly: number; opacity: number; pool: { x: number; y: number } | null; spin: number; pitch: number }

/** Пока идёт action, читает свет страницы на каждом кадре браузера. */
async function record(page: Page, action: () => Promise<void>, minMs: number): Promise<Sample[]> {
  await page.evaluate(() => {
    const trace: Sample[] = [];
    const root = document.documentElement;
    const pool = document.getElementById('vs-pool')!;
    const w = window as unknown as { __light: { trace: Sample[]; stop: boolean } };
    w.__light = { trace, stop: false };
    const tick = (): void => {
      const cs = getComputedStyle(root);
      const m = /matrix\(([^)]+)\)/.exec(pool.style.transform);
      const v = m ? m[1]!.split(',').map(Number) : null;
      const s = window.__verst!.state();
      trace.push({
        lx: parseFloat(cs.getPropertyValue('--vs-lx')),
        ly: parseFloat(cs.getPropertyValue('--vs-ly')),
        opacity: parseFloat(pool.style.opacity || '0'),
        pool: v ? { x: v[4]!, y: v[5]! } : null,
        spin: s.spin,
        pitch: s.pitch,
      });
      if (!w.__light.stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const start = Date.now();
  await action();
  await page.waitForTimeout(Math.max(0, minMs - (Date.now() - start)));
  return page.evaluate(() => {
    const w = window as unknown as { __light: { trace: Sample[]; stop: boolean } };
    w.__light.stop = true;
    return w.__light.trace;
  });
}

/** Самый большой скачок между соседними кадрами. */
function worst(trace: Sample[]): { centre: number; pool: number; opacity: number; at: string } {
  const out = { centre: 0, pool: 0, opacity: 0, at: '' };
  for (let i = 1; i < trace.length; i += 1) {
    const a = trace[i - 1]!;
    const b = trace[i]!;
    const centre = Math.hypot(b.lx - a.lx, b.ly - a.ly);
    const pool = a.pool && b.pool ? Math.hypot(b.pool.x - a.pool.x, b.pool.y - a.pool.y) : 0;
    const opacity = Math.abs(b.opacity - a.opacity);
    if (centre > out.centre || opacity > out.opacity || pool > out.pool) out.at = `кадр ${i}: поворот ${b.spin.toFixed(3)}, наклон ${b.pitch.toFixed(3)} (Δ поворота ${(b.spin - a.spin).toFixed(3)}, Δ наклона ${(b.pitch - a.pitch).toFixed(4)})`;
    out.centre = Math.max(out.centre, centre);
    out.pool = Math.max(out.pool, pool);
    out.opacity = Math.max(out.opacity, opacity);
  }
  return out;
}

async function lit(page: Page): Promise<{ x: number; y: number }> {
  await openScene(page);
  await switchOn(page);
  await asleep(page);
  return point(page, 'head');
}

test('свет не прыгает, пока лампу раскручивают за панель', async ({ page }) => {
  const head = await lit(page);
  const trace = await record(page, async () => {
    await page.mouse.move(head.x, head.y);
    await page.mouse.down();
    // рука идёт по 1,5 пикселя за кадр (0,009 рад): быстрее пятно законно едет по столу больше чем на 60 px за кадр
    for (let x = 0; x <= 360; x += 1.5) {
      await page.mouse.move(head.x + x, head.y);
      await frames(page, 1);
    }
    await page.mouse.up();
  }, SAMPLE_MS);
  const spins = trace.map((s) => s.spin);
  expect(Math.max(...spins) - Math.min(...spins), 'лампа действительно повернулась').toBeGreaterThan(1.2);
  const w = worst(trace);
  expect(w.centre, `центр спада за кадр (${w.at})`).toBeLessThan(MAX_CENTRE_STEP);
  expect(w.pool, `центр пятна за кадр (${w.at})`).toBeLessThan(MAX_CENTRE_STEP);
  expect(w.opacity, `прозрачность пятна за кадр (${w.at})`).toBeLessThan(MAX_OPACITY_STEP);
});

test('свет не прыгает, пока панель наклоняют на весь ход вверх и вниз', async ({ page }) => {
  test.setTimeout(120_000);
  const head = await lit(page);
  const trace = await record(page, async () => {
    await page.mouse.move(head.x, head.y);
    await page.mouse.down();
    // рука идёт по 0,8 пикселя за кадр: быстрее пятно законно едет по столу больше чем на 60 px за кадр
    let y = head.y;
    for (const end of [head.y - 200, head.y + 330]) {
      for (; Math.abs(end - y) > 0.01; y += Math.sign(end - y) * Math.min(0.8, Math.abs(end - y))) {
        await page.mouse.move(head.x, y);
        await frames(page, 1);
      }
    }
    await page.mouse.up();
  }, 0);
  const pitches = trace.map((s) => s.pitch);
  expect(Math.min(...pitches), 'панель дошла до верхнего упора').toBeLessThan(-0.4);
  expect(Math.max(...pitches), 'панель дошла до нижнего упора').toBeGreaterThan(1.25);
  const w = worst(trace);
  expect(w.centre, `центр спада за кадр (${w.at})`).toBeLessThan(MAX_CENTRE_STEP);
  expect(w.pool, `центр пятна за кадр (${w.at})`).toBeLessThan(MAX_CENTRE_STEP);
  expect(w.opacity, `прозрачность пятна за кадр (${w.at})`).toBeLessThan(MAX_OPACITY_STEP);
});
