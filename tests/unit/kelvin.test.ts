import { expect, test } from 'vitest';
import { kelvinOf, kelvinRgb } from '../../src/lamp/kelvin';

test.each([[0, 2000], [0.28, 2700], [1, 4500], [-1, 2000], [2, 4500]])('кельвины при %f', (w, k) => { expect(kelvinOf(w)).toBe(k); });
test('свеча теплее полудня', () => { expect(kelvinRgb(0)[2]).toBeLessThan(kelvinRgb(1)[2]); });
