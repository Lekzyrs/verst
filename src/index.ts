import { mountLayers } from './page/layers';
import { mountView, type VerstDebug } from './scene/view';

declare global {
  interface Window {
    /** Отладочные крючки для тестов. Есть, только если сцена запустилась. */
    __verst?: VerstDebug;
  }
}

let booted = false;

/**
 * Запускает первый экран и ставит html[data-vs]: live (сцена идёт: контекст WebGL создан), static (WebGL нет или он потерян,
 * либо сцена упала: холст и слои света убраны, страница выглядит как без скрипта), none (метки сцены нет).
 * Вызывается сам после DOMContentLoaded, если есть document.
 */
export function boot(): void {
  if (booted) return;
  booted = true;
  const root = document.documentElement;
  // На опубликованной Tilda у html нет lang, а без ru Sofia Sans рисует болгарскую «Л». Страница ставит lang и сама, раньше.
  if (!root.lang) root.lang = 'ru';
  const layers = mountLayers(document);
  if (!layers) {
    root.dataset.vs = 'none';
    return;
  }
  const toStatic = (): void => {
    layers.dispose();
    root.dataset.vs = 'static';
  };
  const view = mountView(layers, toStatic);
  if (!view) {
    toStatic();
    return;
  }
  root.dataset.vs = 'live';
  window.__verst = view;
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
}
