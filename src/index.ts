import { CANVAS_ID } from './page/contract';
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
  // Второй экземпляр скрипта (тег вставлен дважды) ничего не делает: его модульный флаг booted свой, а холст общий.
  if (booted || document.getElementById(CANVAS_ID)) return;
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
  let view: VerstDebug | null = null;
  try {
    view = mountView(layers, toStatic);
  } catch (error) {
    // Сцена не собралась (например, контекст пропал при запуске): страница остаётся без неё, причина видна в консоли.
    console.error(`[verst] сцена не запустилась: ${error instanceof Error ? error.message : String(error)}`, error);
  }
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
