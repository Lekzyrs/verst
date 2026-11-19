import { expect, test } from 'vitest';
import { COLS, ROWS, digitMask, fillLevels } from '../../src/lamp/matrix';

const out = new Float32Array(COLS * ROWS);
const sum = (m: Uint8Array) => m.reduce((a, b) => a + b, 0);
test('маска 2700', () => { const m = digitMask('2700'); expect(m.length).toBe(336); expect(sum(m)).toBe(63); });
test('буквы пропускаются', () => { expect(sum(digitMask('K'))).toBe(0); });
test('выключено', () => { expect(fillLevels(0, null, 0, out)).toBe(0); });
test('включено целиком', () => { expect(fillLevels(1, null, 0, out)).toBeCloseTo(1); });
test('волна идёт слева', () => { fillLevels(0.5, null, 0, out); expect(out[0]).toBe(1); expect(out[23]).toBe(0); });
test('цифры гасят остальное до 0.1', () => { const m = digitMask('2700'); fillLevels(1, m, 1, out); expect(out[m.indexOf(0)]).toBeCloseTo(0.1); expect(out[m.indexOf(1)]).toBe(1); });
test('при неполном включении цифр нет', () => { const m = digitMask('2700'); fillLevels(0.5, m, 1, out); expect(out[0]).toBe(1); });
