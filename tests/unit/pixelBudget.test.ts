import { expect, test } from 'vitest';
import { PIXEL_BUDGET, pixelRatioFor } from '../../src/core/pixelBudget';

test.each([
  [980, 1085, 2, 1.5],
  [390, 844, 3, 1.5],
  [1440, 900, 1, 1],
  [2560, 1440, 2, 1],
])('%ix%i при плотности %f', (w, h, dpr, want) => {
  expect(pixelRatioFor(w, h, dpr)).toBeCloseTo(want, 3);
});

test('1920x1080 на Retina', () => {
  expect(pixelRatioFor(1920, 1080, 2)).toBeCloseTo(1.0758, 3);
});

test('кадр укладывается в бюджет', () => {
  const r = pixelRatioFor(1920, 1080, 2);
  expect(1920 * 1080 * r * r).toBeLessThanOrEqual(PIXEL_BUDGET + 1);
});
