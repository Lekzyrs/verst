// Сцена первого экрана: рендерер, камера по рамке метки, свет лампы на странице, цикл кадров и связь со страницей.
// Вызывается только в браузере.
import * as THREE from 'three';
import { createLoop } from '../core/loop';
import { pixelRatioFor } from '../core/pixelBudget';
import { watchPointer } from '../core/pointer';
import { Lamp, toPixels, type Grip, type LampState, type Spot } from '../lamp/lamp';
import { buildLamp } from '../lamp/model';
import { atom, SEL } from '../page/contract';
import type { Layers } from '../page/layers';
import { FOV, frameCamera } from './camera';
import { pageLight } from './pageLight';
import { buildStudio } from './studio';

/** Отладочные крючки для тестов: window.__verst. Координаты в CSS-пикселях окна. */
export interface VerstDebug {
  layers: Layers;
  readonly frames: number;
  state(): LampState;
  /** Число означает звено шнура. */
  point(what: Spot): { x: number; y: number };
  /** Сколько пикселей в единице сцены у лампы. */
  scale(): number;
  /** Экранная рамка лампы без шнура. */
  bounds(): { left: number; top: number; right: number; bottom: number };
  ring(): { aboveFloor: number; insidePanel: boolean };
}

const HINT_EVERY = 6000; // мс
const HINT_TIMES = 3;
const BRAND = 'Верст';
const STATE_TEXT = { on: 'включена', off: 'выключена' };

/** Контекст создаётся здесь, а не внутри three: тот при неудаче пишет ошибку в консоль, а страница без WebGL должна остаться тихой. */
function createRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer | null {
  const context = canvas.getContext('webgl2', { alpha: true, antialias: true, depth: true, stencil: false, premultipliedAlpha: true });
  if (!context) return null;
  const renderer = new THREE.WebGLRenderer({ canvas, context, antialias: true, alpha: true });
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false; // тени пересчитываются, только пока что-то движется
  return renderer;
}

/** Состояние лампы на странице: подпись, признак на html и кнопка с тем же действием, что рывок шнура. */
function bindPage(doc: Document, toggle: () => void): { show(on: boolean): void; dispose(): void } {
  const root = doc.documentElement;
  const stateEl = doc.querySelector(SEL.state);
  const label = stateEl ? atom(stateEl) : null;
  const labelBefore = label ? label.textContent : null;
  const pull = doc.querySelector<HTMLElement>(SEL.pull);
  const control = pull ? (pull.querySelector<HTMLElement>('a, button') ?? pull) : null;
  // Ссылка с адресом и кнопка получают фокус и Enter сами. Остальным узлам это даём мы.
  // Свойству tabIndex тут верить нельзя: у ссылки без адреса браузеры отдают 0, хотя фокус она не получает.
  const needsKeys = control !== null && !control.matches('a[href], button, input, [tabindex]');

  const press = (e: Event): void => {
    e.preventDefault(); // кнопка на Tilda — ссылка: перехода по ней быть не должно
    toggle();
  };
  const isActivation = (e: KeyboardEvent): boolean => e.key === 'Enter' || e.key === ' ';
  // Повтор клавиши (e.repeat) лампу не переключает и рывок шнура не перезапускает: у ссылки и кнопки повтор сам даёт клик,
  // его гасит preventDefault; у узла без адреса нажатие обрабатываем мы.
  const key = (e: KeyboardEvent): void => {
    if (!isActivation(e)) return;
    if (e.repeat) e.preventDefault();
    else if (needsKeys) press(e);
  };
  pull?.addEventListener('click', press);
  if (control) {
    control.addEventListener('keydown', key);
    if (needsKeys) {
      control.setAttribute('role', 'button');
      control.tabIndex = 0;
    }
  }
  // Подпись читается программой чтения с экрана, когда меняется состояние лампы, а не теплота света.
  label?.setAttribute('aria-live', 'polite');
  let shown: boolean | null = null;

  return {
    show(on) {
      if (on === shown) return; // ручка теплоты тоже зовёт отсюда: подпись переписывается только при смене состояния
      shown = on;
      root.dataset.vsLight = on ? 'on' : 'off';
      if (label) label.textContent = on ? STATE_TEXT.on : STATE_TEXT.off;
    },
    dispose() {
      delete root.dataset.vsLight;
      if (label) {
        label.textContent = labelBefore;
        label.removeAttribute('aria-live');
      }
      pull?.removeEventListener('click', press);
      if (control) {
        control.removeEventListener('keydown', key);
        if (needsKeys) {
          control.removeAttribute('role');
          control.removeAttribute('tabindex');
        }
      }
    },
  };
}

/**
 * Запускает сцену на холсте слоёв. null, если WebGL не создать. onStop вызывается один раз, когда сцена остановилась сама:
 * потерян контекст, кадр упал с ошибкой или холст убрали со страницы.
 */
export function mountView(layers: Layers, onStop: () => void): VerstDebug | null {
  const canvas = layers.canvas;
  const doc = canvas.ownerDocument;
  const win = doc.defaultView;
  const renderer = win ? createRenderer(canvas) : null;
  if (!win || !renderer) return null;

  const model = buildLamp();
  const studio = buildStudio(renderer, model);
  const lamp = new Lamp(model, studio);
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 200);

  let width = 0;
  let height = 0;
  let ratio = 0;
  let perUnit = 0; // пикселей в единице сцены у лампы
  let inView = false; // рамка метки не пустая, камера стоит
  let layoutStale = true;
  let shadowsStale = true;
  let stopped = false;
  let holding = false;

  const p = new THREE.Vector3();
  const sc = new THREE.Vector2();

  /** Точка сцены (меняется на месте) в пикселях окна. false, если она за камерой или вплотную к ней: там проекция уходит в бесконечность. */
  const toScreen = (point: THREE.Vector3, out: THREE.Vector2): boolean => toPixels(point, camera, width, height, out) > 1;

  /** Ставит камеру так, чтобы лампа заняла рамку метки сцены. false, если рамки или холста сейчас нет. */
  const reframe = (): boolean => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const stage = layers.stageRect();
    if (w < 1 || h < 1 || stage.width < 1 || stage.height < 1) return false;
    const r = pixelRatioFor(w, h, win.devicePixelRatio || 1);
    if (w !== width || h !== height || r !== ratio) {
      width = w;
      height = h;
      ratio = r;
      renderer.setDrawingBufferSize(w, h, r);
      lamp.setViewport(w, h);
    }
    perUnit = frameCamera(camera, w, h, stage, model);
    return true;
  };

  /**
   * Свет лампы на странице. Пятно на столе рисует HTML-слой в режиме overlay: свет должен высветлять цвет фона
   * и не делать тёмные буквы серыми, а холст так смешиваться со страницей не умеет.
   */
  const lightPage = (): void => {
    const { level, power, origin, dir } = lamp.light();
    const light = pageLight({ origin, dir, level, width, height, project: (point, out) => toPixels(point, camera, width, height, out) });
    layers.setPool(light.pool ? `matrix(${light.pool.matrix.map((v, i) => v.toFixed(i < 4 ? 4 : 1)).join(', ')})` : null, light.pool?.opacity ?? 0);
    layers.setLight(power, light.centre.x, light.centre.y);
  };

  const cleanups: Array<() => void> = [];
  const stop = (error?: unknown): void => {
    if (stopped) return;
    stopped = true;
    if (error !== undefined) console.error(`[verst] сцена остановлена: ${error instanceof Error ? error.message : String(error)}`, error);
    for (const cleanup of cleanups) cleanup();
    renderer.dispose();
    if (!renderer.getContext().isContextLost()) renderer.forceContextLoss(); // память видеокарты нужна странице, а не остановленной сцене
    onStop();
  };
  /** Ошибка в кадре не должна тихо убить сцену: она пишется в консоль, а страница возвращается к виду без сцены. */
  const guarded = <T>(run: () => T, fallback: T): T => {
    if (stopped) return fallback;
    try {
      return run();
    } catch (error) {
      stop(error);
      return fallback;
    }
  };

  const loop = createLoop(
    (dt) =>
      guarded(() => {
        if (!canvas.isConnected) {
          stop(); // слои страницы убрали снаружи
          return false;
        }
        const moving = lamp.update(dt);
        if (moving) shadowsStale = true;
        return moving;
      }, false),
    () =>
      guarded(() => {
        if (layoutStale) {
          layoutStale = false;
          inView = reframe();
        }
        if (!inView) {
          layers.setPool(null, 0);
          renderer.clear();
          return;
        }
        lightPage();
        renderer.shadowMap.needsUpdate = shadowsStale;
        shadowsStale = false;
        renderer.render(studio.scene, camera);
      }, undefined),
  );
  const wake = (): void => loop.wake();
  cleanups.push(() => loop.dispose());

  layers.onLayout(() => {
    layoutStale = true;
    wake();
  });
  const lost = (): void => stop();
  canvas.addEventListener('webglcontextlost', lost);
  cleanups.push(() => canvas.removeEventListener('webglcontextlost', lost));

  cleanups.push(watchPointer<Grip>(win, {
    pick: (x, y, radius) => (inView ? lamp.pick(x, y, radius, camera) : null),
    grab(grip, x, y) {
      holding = true;
      lamp.grab(grip, x, y, camera);
      wake();
    },
    drag(x, y, dx, dy, dt) {
      lamp.drag(x, y, dx, dy, dt, camera);
      wake();
    },
    release(tap) {
      holding = false;
      lamp.release(tap);
      wake();
    },
  }));

  // Подсказка: пока лампу ни разу не включали, шнур изредка покачивается сам. При настройке «меньше движения» её нет.
  let hints = 0;
  const hint = win.matchMedia('(prefers-reduced-motion: reduce)').matches
    ? 0
    : win.setInterval(() => {
        if (doc.hidden || holding) return;
        hints += 1;
        if (hints >= HINT_TIMES) win.clearInterval(hint);
        lamp.nudge();
        wake();
      }, HINT_EVERY);
  cleanups.push(() => win.clearInterval(hint));

  const page = bindPage(doc, () => {
    lamp.toggle();
    wake();
  });
  cleanups.push(page.dispose);
  page.show(lamp.on);
  lamp.onChange = ({ on }) => {
    page.show(on);
    if (on) win.clearInterval(hint);
    wake();
  };

  // Шильдик рисуется шрифтом страницы. Модель цикл не будит, поэтому после загрузки шрифтов он перерисовывается отсюда.
  const repaintLabel = (): void => {
    model.setBrand(BRAND);
    wake();
  };
  doc.fonts.addEventListener('loadingdone', repaintLabel);
  cleanups.push(() => doc.fonts.removeEventListener('loadingdone', repaintLabel));

  return {
    layers,
    get frames() { return loop.frames; },
    state: () => lamp.state(),
    point(what) {
      toScreen(lamp.point(what, p), sc);
      return { x: sc.x, y: sc.y };
    },
    scale: () => perUnit,
    bounds() {
      const box = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
      model.root.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh || !mesh.visible || mesh === model.halo || mesh.material === studio.contact) return;
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        const { min, max } = mesh.geometry.boundingBox!;
        for (let corner = 0; corner < 8; corner += 1) {
          toScreen(p.set(corner & 1 ? max.x : min.x, corner & 2 ? max.y : min.y, corner & 4 ? max.z : min.z).applyMatrix4(mesh.matrixWorld), sc);
          box.left = Math.min(box.left, sc.x);
          box.right = Math.max(box.right, sc.x);
          box.top = Math.min(box.top, sc.y);
          box.bottom = Math.max(box.bottom, sc.y);
        }
      });
      return box;
    },
    ring: () => lamp.ring(),
  };
}
