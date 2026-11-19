import { describe, expect, test } from 'vitest';
import * as THREE from 'three';
import { buildLamp, type LampModel } from '../../src/lamp/model';

const boxOf = (m: LampModel) => { const b = new THREE.Box3(); m.root.updateMatrixWorld(true); m.root.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.visible && o !== m.halo) b.expandByObject(o); }); return b; };

describe('модель лампы', () => {
  test('лампа стоит на столе', () => { const b = boxOf(buildLamp()); expect(b.min.y).toBeGreaterThanOrEqual(-0.01); expect(b.max.y).toBeGreaterThan(2.6); expect(b.max.y).toBeLessThan(3.6); });
  test('лампа помещается в свой шар', () => { const m = buildLamp(); const b = boxOf(m); for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) expect(new THREE.Vector3(x, y, z).distanceTo(m.center)).toBeLessThanOrEqual(m.radius + 0.01); });
  test('матрица 24 на 14', () => { expect(buildLamp().dots.count).toBe(336); });
  test('шнур выходит из нижней кромки панели', () => { const m = buildLamp(); expect(m.anchorLocal.y).toBeLessThan(-m.halfSize.y + 0.02); });
});
