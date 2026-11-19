import { beforeEach, expect, test } from 'vitest';
import { Chain, LAMP_CHAIN, type KeepOut } from '../../src/lamp/chain';

const A = { x: 0, y: 2, z: 0 }, OUT = { x: 0, y: -1, z: 0 };
let c: Chain;
beforeEach(() => { c = new Chain(LAMP_CHAIN); c.reset(A); });
const run = (s: number, a = A, keep?: KeepOut) => { let n = 0; for (let i = 0; i < Math.round(s * 60); i++) if (c.step(1 / 60, a, OUT, keep)) n++; return n; };
const end = () => ({ x: c.pos[39], y: c.pos[40], z: c.pos[41] });
const pullTo = (y: number, d: number, s = 0.4) => { c.moveHeld({ x: 0, y: y - d, z: 0 }); return run(s); };

test('висит отвесно, провисая меньше 5 см', () => { run(2); expect(end().y).toBeGreaterThan(1.25); expect(end().y).toBeLessThan(1.31); expect(Math.abs(end().x)).toBeLessThan(0.01); });
test('захват кольца ничего не сдвигает', () => { run(2); const y0 = end().y; c.grab(13); expect(run(0.5)).toBe(0); expect(Math.abs(end().y - y0)).toBeLessThan(0.005); });
test('захват середины ничего не сдвигает', () => { run(2); const y0 = c.pos[22]; c.grab(7); run(0.5); expect(Math.abs(c.pos[22] - y0)).toBeLessThan(0.005); });
test('короткий рывок не щёлкает', () => { run(2); c.grab(13); expect(pullTo(end().y, 0.25, 0.5)).toBe(0); });
test('полный ход щёлкает один раз и упирается', () => { run(2); c.grab(13); expect(pullTo(end().y, 0.55, 1)).toBe(1); expect(c.travel).toBeGreaterThan(0.4); expect(c.travel).toBeLessThan(0.5); });
test('второй щелчок только после возврата ниже 35 % хода', () => { run(2); const y = end().y; c.grab(13); expect(pullTo(y, 0.55) + pullTo(y, 0.3) + pullTo(y, 0.55)).toBe(1); expect(pullTo(y, 0.1) + pullTo(y, 0.55)).toBe(1); });
test('рывок вверх не щёлкает и не вытягивает', () => { run(2); c.grab(13); c.moveHeld({ x: 0.2, y: 3.2, z: 0 }); expect(run(1)).toBe(0); expect(c.travel).toBe(0); });
test('кольцо не уходит под стол', () => { const low = { x: 0, y: 0.9, z: 0 }; c.reset(low); run(2, low); c.grab(13); c.moveHeld({ x: 0, y: -1, z: 0 }); run(1, low); expect(end().y).toBeGreaterThanOrEqual(0.27 - 1e-6); });
test('после отпускания шнур уходит в корпус', () => { run(2); c.grab(13); pullTo(end().y, 0.55, 1); c.release(); run(0.5); expect(c.travel).toBeLessThan(0.01); });
test('tug щёлкает один раз и возвращается', () => { run(2); c.tug(); expect(run(0.6)).toBe(1); expect(c.travel).toBeLessThan(0.01); });
test('после качка засыпает за 10 секунд', () => { run(2); c.grab(13); c.moveHeld({ x: 0.6, y: end().y, z: 0 }); run(0.3); c.release(); run(10); expect(c.maxSpeed()).toBeLessThan(5e-6); });
test('keepOut получает запас 0.11 для кольца и 0.03 для звеньев', () => { const seen = new Set<number>(); run(0.2, A, (_p, m) => { seen.add(m); }); expect([...seen].sort()).toEqual([0.03, 0.11]); });
