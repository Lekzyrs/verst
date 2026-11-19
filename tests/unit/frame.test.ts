import { expect, test } from 'vitest';
import { frameToRect } from '../../src/core/frame';

const full = { left: 0, top: 0, width: 1000, height: 1000 };

test('рамка во весь экран', () => {
  const f = frameToRect(1000, 1000, 28, full, 2, 1);
  expect(f.distance).toBeCloseTo(8.0216, 3);
  expect(f.shiftX).toBeCloseTo(0);
  expect(f.shiftY).toBeCloseTo(0);
});

test('правая половина', () => {
  const f = frameToRect(1000, 1000, 28, { left: 500, top: 0, width: 500, height: 1000 }, 2, 1);
  expect(f.distance).toBeCloseTo(16.0431, 3);
  expect(f.shiftX).toBeCloseTo(0.5);
});

test('правая нижняя четверть', () => {
  const f = frameToRect(1000, 1000, 28, { left: 500, top: 500, width: 500, height: 500 }, 2, 1);
  expect(f.shiftX).toBeCloseTo(0.5);
  expect(f.shiftY).toBeCloseTo(-0.5);
});

test('fill по умолчанию 0.92', () => {
  expect(frameToRect(1000, 1000, 28, full, 2).distance).toBeCloseTo(8.0216 / 0.92, 2);
});
