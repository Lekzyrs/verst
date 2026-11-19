import { expect, test } from 'vitest';
import { boot } from '../../src/index';
test('boot существует', () => { expect(typeof boot).toBe('function'); });
