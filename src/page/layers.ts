// Слои страницы: холст и свет лампы между крупным текстом Zero Block и мелкими подписями.
// Вызывается только в браузере.
//
// Вердикт raise: Tilda даёт каждой .tn-elem z-index 3 правилом
// #rec<id> .tn-elem[data-elem-id="..."], а артборд контекста наложения не создаёт. Поэтому холст (5) и свет (4)
// лежат в body над всеми элементами блока, а подписи поднимаются на 10; !important нужен, потому что
// специфичность правила Tilda выше. Весь CSS приходит отсюда одним тегом style: странице хватает тега script.
import type { Rect } from '../core/frame';
import { CANVAS_ID, SEL, VARS } from './contract';

export interface Layers {
  readonly canvas: HTMLCanvasElement;
  /** Рамка метки сцены в координатах окна. zoom, которым Tilda масштабирует блок, в ней уже учтён. */
  stageRect(): Rect;
  /** lit 0..1: яркость света на странице; x, y: точка, вокруг которой спадает свет, в пикселях окна. */
  setLight(lit: number, xPx: number, yPx: number): void;
  /** Пятно света 200×200 с центром в начале координат окна; cssMatrix: значение transform, например matrix(a, b, c, d, x, y). null прячет пятно. */
  setPool(cssMatrix: string | null, opacity: number): void;
  /** cb вызывается при смене размера окна, прокрутке, смене раскладки блока (размеры, inline-стиль и класс метки и артборда), загрузке страницы и шрифтов. */
  onLayout(cb: () => void): void;
  dispose(): void;
}

const STYLE_ID = 'vs-layers';
const FALLOFF_ID = 'vs-falloff';
const POOL_ID = 'vs-pool';

const CSS = [
  `#${CANVAS_ID}{position:fixed;inset:0;width:100%;height:100%;display:block;pointer-events:none;z-index:5}`,
  // Спад: вдали от точки света страница темнеет, сила растёт с яркостью.
  `#${FALLOFF_ID}{position:fixed;inset:0;pointer-events:none;z-index:4;opacity:var(${VARS.lit},0);` +
    `background:radial-gradient(ellipse 72% 82% at var(${VARS.lightX},60%) var(${VARS.lightY},75%),rgba(34,26,0,0) 30%,rgba(34,26,0,.34) 100%)}`,
  // Пятно: overlay высветляет цвет фона и оставляет тёмные буквы тёмными.
  `#${POOL_ID}{position:fixed;left:0;top:0;width:200px;height:200px;margin:-100px 0 0 -100px;pointer-events:none;z-index:4;opacity:0;` +
    `background:radial-gradient(closest-side,rgba(255,255,255,.98),rgba(255,255,255,.5) 42%,rgba(255,255,255,0) 100%);` +
    `mix-blend-mode:overlay;will-change:transform,opacity}`,
  `.t396__elem${SEL.label}{z-index:10 !important}`,
].join('\n');

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const round = (v: number, digits: number): number => Number(v.toFixed(digits));

/** null, если на странице нет метки сцены. Холст и оба слоя света встают в конец body, свет перед холстом. */
export function mountLayers(doc: Document): Layers | null {
  const stage = doc.querySelector<HTMLElement>(SEL.stage);
  const win = doc.defaultView;
  if (!stage || !win) return null;

  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  doc.head.append(style);

  const layer = (id: string): HTMLDivElement => {
    const el = doc.createElement('div');
    el.id = id;
    el.setAttribute('aria-hidden', 'true');
    return el;
  };
  const falloff = layer(FALLOFF_ID);
  const pool = layer(POOL_ID);
  const canvas = doc.createElement('canvas');
  canvas.id = CANVAS_ID;
  doc.body.append(falloff, pool, canvas);

  const root = doc.documentElement;
  const written = new Map<string, string>();
  const writeVar = (name: string, value: string): void => {
    if (written.get(name) === value) return;
    written.set(name, value);
    root.style.setProperty(name, value);
  };

  const callbacks = new Set<() => void>();
  let disposed = false;
  const emit = (): void => {
    for (const cb of callbacks) cb();
  };
  // Tilda расставляет элементы своим скриптом уже после загрузки: размеры метки и артборда следит ResizeObserver,
  // а сдвиг без смены размера виден только по записи inline-стиля или класса. Такие записи идут пачками,
  // поэтому вызов по ним один на кадр.
  const artboard = stage.closest('.t396__artboard');
  const observer = new ResizeObserver(emit);
  observer.observe(stage);
  if (artboard) observer.observe(artboard);
  let frame = 0;
  const mutations = new MutationObserver(() => {
    if (frame === 0) frame = win.requestAnimationFrame(() => { frame = 0; emit(); });
  });
  const watched: MutationObserverInit = { attributes: true, attributeFilter: ['style', 'class'] };
  mutations.observe(stage, watched);
  if (artboard) mutations.observe(artboard, watched);
  win.addEventListener('resize', emit);
  win.addEventListener('scroll', emit, { passive: true });
  win.addEventListener('load', emit);
  void doc.fonts.ready.then(() => { if (!disposed) emit(); });

  return {
    canvas,
    stageRect() {
      const r = stage.getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    },
    setLight(lit, xPx, yPx) {
      writeVar(VARS.lit, String(round(clamp01(lit), 3)));
      writeVar(VARS.lightX, `${round(xPx, 1)}px`);
      writeVar(VARS.lightY, `${round(yPx, 1)}px`);
    },
    setPool(cssMatrix, opacity) {
      if (cssMatrix === null) {
        pool.style.opacity = '0';
        return;
      }
      pool.style.transform = cssMatrix;
      pool.style.opacity = String(round(clamp01(opacity), 3));
    },
    onLayout(cb) {
      callbacks.add(cb);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      callbacks.clear();
      observer.disconnect();
      mutations.disconnect();
      if (frame !== 0) win.cancelAnimationFrame(frame);
      win.removeEventListener('resize', emit);
      win.removeEventListener('scroll', emit);
      win.removeEventListener('load', emit);
      canvas.remove();
      falloff.remove();
      pool.remove();
      style.remove();
      for (const name of Object.values(VARS)) root.style.removeProperty(name);
    },
  };
}
