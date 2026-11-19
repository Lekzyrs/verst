import { beforeEach, expect, test } from 'vitest';
import { QUIET_FRAMES, createLoop, type Loop } from '../../src/core/loop';

type Cb = (t: number) => void;

let queue: Cb[];
let now: number;
let cancelled: number;
let nextId: number;
let draws: number;
let dts: number[];

const raf = (cb: Cb): number => {
  queue.push(cb);
  return ++nextId;
};
const caf = (): void => {
  cancelled += 1;
  queue.length = 0;
};

/** Прокручивает один запрошенный кадр, если он есть; время идёт на stepMs. */
function tick(stepMs = 16): void {
  const cb = queue.shift();
  if (!cb) return;
  now += stepMs;
  cb(now);
}

function make(step: (dt: number) => boolean): Loop {
  return createLoop(
    (dt) => {
      dts.push(dt);
      return step(dt);
    },
    () => {
      draws += 1;
    },
    raf,
    caf,
  );
}

beforeEach(() => {
  queue = [];
  now = 1000;
  cancelled = 0;
  nextId = 0;
  draws = 0;
  dts = [];
});

test('QUIET_FRAMES равен 24', () => {
  expect(QUIET_FRAMES).toBe(24);
});

test('новый цикл бодрствует и уже запросил кадр', () => {
  const loop = make(() => false);
  expect(loop.awake).toBe(true);
  expect(queue.length).toBe(1);
});

test('засыпает после 24 тихих кадров', () => {
  const loop = make(() => false);
  for (let i = 0; i < 100; i++) tick();
  expect(draws).toBe(24);
  expect(loop.frames).toBe(24);
  expect(loop.awake).toBe(false);
  expect(queue.length).toBe(0);
});

test('движение продлевает работу', () => {
  let n = 0;
  make(() => n++ < 10);
  for (let i = 0; i < 100; i++) tick();
  expect(draws).toBe(34);
});

test('wake будит спящий цикл', () => {
  const loop = make(() => false);
  for (let i = 0; i < 100; i++) tick();
  expect(loop.awake).toBe(false);
  loop.wake();
  expect(queue.length).toBe(1);
  tick();
  expect(draws).toBe(25);
  expect(loop.awake).toBe(true);
});

test('wake у бодрствующего цикла не запрашивает второй кадр', () => {
  const loop = make(() => false);
  loop.wake();
  loop.wake();
  expect(queue.length).toBe(1);
});

test('dt ограничен', () => {
  make(() => true);
  for (let i = 0; i < 5; i++) tick(500);
  expect(dts.length).toBe(5);
  expect(Math.max(...dts)).toBeLessThanOrEqual(0.05);
});

test('первый кадр идёт с dt 1/60', () => {
  make(() => false);
  tick(500);
  expect(dts[0]).toBeCloseTo(1 / 60, 6);
});

test('dispose отменяет запрошенный кадр', () => {
  const loop = make(() => true);
  loop.dispose();
  expect(cancelled).toBe(1);
  expect(loop.awake).toBe(false);
  tick();
  expect(draws).toBe(0);
});

test('после dispose wake ничего не запрашивает', () => {
  const loop = make(() => true);
  loop.dispose();
  loop.wake();
  expect(queue.length).toBe(0);
  expect(loop.awake).toBe(false);
});
