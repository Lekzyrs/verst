import { describe, expect, test } from 'vitest';
import * as THREE from 'three';
import { toPixels } from '../../src/lamp/lamp';
import { buildLamp } from '../../src/lamp/model';
import { frameCamera } from '../../src/scene/camera';
import { pageLight } from '../../src/scene/pageLight';

// Свет лампы на странице должен быть непрерывной функцией положения лампы при неподвижной камере.
// Проверяется по сетке положений: между соседними узлами центр спада, прозрачность и центр пятна не прыгают.

interface Result { pool: { matrix: number[]; opacity: number } | null; centre: { x: number; y: number } }
type Impl = (origin: THREE.Vector3, dir: THREE.Vector3, level: number, camera: THREE.PerspectiveCamera, width: number, height: number) => Result;

/** Прежняя логика из view.ts, дословно, кроме вывода в виде чисел: опорный образец для сравнения. */
const legacy: Impl = (origin, dir, level, camera, width, height) => {
  const p = new THREE.Vector3(), centre = new THREE.Vector3(), along = new THREE.Vector3();
  const sc = new THREE.Vector2(), sa = new THREE.Vector2(), sb = new THREE.Vector2();
  const toScreen = (point: THREE.Vector3, out: THREE.Vector2): boolean => toPixels(point, camera, width, height, out) > 1;
  let pool: Result['pool'] = null;
  if (dir.y < -0.08 && level > 0.01) {
    const reach = Math.min(-origin.y / dir.y, 14);
    centre.set(origin.x + dir.x * reach, 0, origin.z + dir.z * reach);
    const across = 1.7 + reach * 0.62;
    const length = across * Math.min(1 / Math.max(-dir.y, 0.22), 2.4);
    along.set(dir.x, 0, dir.z).normalize();
    const ahead =
      toScreen(p.copy(centre).addScaledVector(along, length), sa) &&
      toScreen(p.set(centre.x - along.z * across, 0, centre.z + along.x * across), sb) &&
      toScreen(p.copy(centre), sc);
    if (ahead) {
      pool = {
        matrix: [(sa.x - sc.x) / 100, (sa.y - sc.y) / 100, (sb.x - sc.x) / 100, (sb.y - sc.y) / 100, sc.x, sc.y],
        opacity: level * THREE.MathUtils.clamp(1.35 - reach / 9, 0.3, 1),
      };
    }
  }
  if (pool === null) toScreen(p.set(origin.x, 0, origin.z), sc);
  return { pool, centre: { x: sc.x, y: sc.y } };
};

const current: Impl = (origin, dir, level, camera, width, height) =>
  pageLight({ origin, dir, level, width, height, project: (point, out) => toPixels(point, camera, width, height, out) });
const impl: Impl = current;

const model = buildLamp();
const WINDOWS = {
  '1440×900, правая половина': { w: 1440, h: 900, stage: { left: 720, top: 0, width: 720, height: 900 } },
  '980×1085, правые 55 % и нижние 66 %': { w: 980, h: 1085, stage: { left: 980 * 0.45, top: 1085 * 0.34, width: 980 * 0.55, height: 1085 * 0.66 } },
  '390×844, вся ширина и нижние 60 %': { w: 390, h: 844, stage: { left: 0, top: 844 * 0.4, width: 390, height: 844 * 0.6 } },
};

/** Начало луча и направление панели при повороте spin и наклоне pitch, как у лампы. */
function beam(spin: number, pitch: number): { origin: THREE.Vector3; dir: THREE.Vector3 } {
  model.spin.rotation.y = spin;
  model.head.rotation.x = pitch;
  model.root.updateMatrixWorld(true);
  return { origin: model.head.getWorldPosition(new THREE.Vector3()), dir: model.head.getWorldDirection(new THREE.Vector3()) };
}

const PITCH_MIN = -0.45;
const PITCH_MAX = 1.3;
const STEP_CENTRE = 40;
const STEP_OPACITY = 0.08;
const STEP_POOL_CENTRE = 60;
const FADED = 0.02;
const STEP_SHAPE = 0.9;

/** Обходит сетку и собирает нарушения непрерывности между соседними узлами. */
function violations(win: (typeof WINDOWS)[keyof typeof WINDOWS], run: Impl): string[] {
  const camera = new THREE.PerspectiveCamera();
  frameCamera(camera, win.w, win.h, win.stage, model);
  const bad: string[] = [];
  const at = (spin: number, pitch: number): Result => {
    const { origin, dir } = beam(spin, pitch);
    const r = run(origin, dir, 1, camera, win.w, win.h);
    const room = 0.3 * Math.max(win.w, win.h) + 1; // мягкий предел: центр спада недалеко от окна
    if (r.centre.x < -room || r.centre.x > win.w + room || r.centre.y < -room || r.centre.y > win.h + room) {
      bad.push(`поворот ${spin.toFixed(2)}, наклон ${pitch.toFixed(2)}: центр спада далеко за окном (${r.centre.x.toFixed(0)}, ${r.centre.y.toFixed(0)})`);
    }
    return r;
  };
  const compare = (a: Result, b: Result, label: string): void => {
    const jump = Math.hypot(a.centre.x - b.centre.x, a.centre.y - b.centre.y);
    if (jump >= STEP_CENTRE) bad.push(`${label}: центр спада прыгнул на ${jump.toFixed(0)} px`);
    const oa = a.pool?.opacity ?? 0;
    const ob = b.pool?.opacity ?? 0;
    if (Math.abs(oa - ob) >= STEP_OPACITY) bad.push(`${label}: прозрачность ${oa.toFixed(3)} → ${ob.toFixed(3)}`);
    if (a.pool && b.pool) {
      // форма пятна: ни одна из четырёх компонент не меняется за шаг больше, чем на 0,9 от самой крупной
      const big = Math.max(...a.pool.matrix.slice(0, 4).map(Math.abs), ...b.pool.matrix.slice(0, 4).map(Math.abs));
      for (let q = 0; q < 4; q += 1) {
        if (Math.abs(a.pool.matrix[q]! - b.pool.matrix[q]!) > STEP_SHAPE * big) bad.push(`${label}: матрица, компонента ${q}, ${a.pool.matrix[q]!.toFixed(1)} → ${b.pool.matrix[q]!.toFixed(1)}`);
      }
    }
    if ((a.pool === null) !== (b.pool === null)) {
      const present = a.pool ?? b.pool!;
      if (present.opacity >= FADED) bad.push(`${label}: пятно пропало при прозрачности ${present.opacity.toFixed(3)}`);
    } else if (a.pool && b.pool) {
      const move = Math.hypot(a.pool.matrix[4]! - b.pool.matrix[4]!, a.pool.matrix[5]! - b.pool.matrix[5]!);
      if (move >= STEP_POOL_CENTRE) bad.push(`${label}: центр пятна прыгнул на ${move.toFixed(0)} px`);
    }
  };
  // вокруг вертикали при разных наклонах
  for (let k = 0; PITCH_MIN + k * 0.05 <= PITCH_MAX + 1e-9; k += 1) {
    const pitch = PITCH_MIN + k * 0.05;
    let prev = at(0, pitch);
    for (let i = 1; i <= Math.round((2 * Math.PI) / 0.01); i += 1) {
      const next = at(i * 0.01, pitch);
      compare(prev, next, `поворот ${(i * 0.01).toFixed(2)}, наклон ${pitch.toFixed(2)}`);
      prev = next;
    }
  }
  // наклон при восьми поворотах
  for (let k = 0; k < 8; k += 1) {
    const spin = (k * Math.PI) / 4 - 0.55;
    let prev = at(spin, PITCH_MIN);
    for (let i = 1; PITCH_MIN + i * 0.005 <= PITCH_MAX + 1e-9; i += 1) {
      const pitch = PITCH_MIN + i * 0.005;
      const next = at(spin, pitch);
      compare(prev, next, `наклон ${pitch.toFixed(3)}, поворот ${spin.toFixed(2)}`);
      prev = next;
    }
  }
  return bad;
}

describe('свет лампы на странице непрерывен', () => {
  for (const [name, win] of Object.entries(WINDOWS)) {
    test(name, () => {
      const bad = violations(win, impl);
      expect(bad.length, `нарушений ${bad.length}, первые:\n${bad.slice(0, 8).join('\n')}`).toBe(0);
    });
  }
});

test('печатает дефолтную позу', () => {
  (globalThis as any).DBG = true;
  for (const [name, win] of Object.entries(WINDOWS)) {
    const camera = new THREE.PerspectiveCamera();
    frameCamera(camera, win.w, win.h, win.stage, model);
    const { origin, dir } = beam(-0.55, 0.5);
    console.log(name, 'dir.y', dir.y.toFixed(3), 'LEG', JSON.stringify(legacy(origin, dir, 1, camera, win.w, win.h)), 'NEW', JSON.stringify(current(origin, dir, 1, camera, win.w, win.h)));
  }
});

describe('поза по умолчанию выглядит как раньше', () => {
  for (const [name, win] of Object.entries(WINDOWS)) {
    test(name, () => {
      const camera = new THREE.PerspectiveCamera();
      frameCamera(camera, win.w, win.h, win.stage, model);
      const { origin, dir } = beam(-0.55, 0.5);
      const before = legacy(origin, dir, 1, camera, win.w, win.h);
      const after = current(origin, dir, 1, camera, win.w, win.h);
      expect(before.pool).not.toBeNull();
      expect(after.pool).not.toBeNull();
      expect(Math.hypot(after.centre.x - before.centre.x, after.centre.y - before.centre.y)).toBeLessThan(3);
      expect(Math.abs(after.pool!.opacity - before.pool!.opacity)).toBeLessThan(0.02);
      after.pool!.matrix.forEach((v, i) => expect(Math.abs(v - before.pool!.matrix[i]!), `компонента ${i}`).toBeLessThanOrEqual(0.03 * Math.abs(before.pool!.matrix[i]!)));
    });
  }
});

describe('пятно и центр спада на краях', () => {
  const win = WINDOWS['1440×900, правая половина'];
  const camera = new THREE.PerspectiveCamera();
  frameCamera(camera, win.w, win.h, win.stage, model);
  test('лампа погашена: пятна нет', () => {
    const { origin, dir } = beam(-0.55, 0.5);
    expect(current(origin, dir, 0, camera, win.w, win.h).pool).toBeNull();
  });
  test('панель смотрит вверх: пятна нет, свет спадает от подножия', () => {
    const { origin, dir } = beam(-0.55, -0.45);
    const r = current(origin, dir, 1, camera, win.w, win.h);
    expect(dir.y).toBeGreaterThan(-0.08);
    expect(r.pool).toBeNull();
  });
});
