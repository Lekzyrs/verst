import { mountLayers, type Layers } from './page/layers';

declare global {
  interface Window {
    /** Отладочные крючки для тестов. */
    __verst?: { layers: Layers };
  }
}

let booted = false;

/**
 * Ставит html[data-vs]: live (холст есть), static (WebGL нет), none (метки сцены нет). Кладёт в window.__verst поле layers. Вызывается сам после DOMContentLoaded, если есть document.
 * Пока рендера нет, бывает только live или none: static появится вместе с WebGL.
 */
export function boot(): void {
  if (booted) return;
  booted = true;
  const root = document.documentElement;
  // На опубликованной Tilda у html нет lang, а без ru Sofia Sans рисует болгарскую «Л». Страница ставит lang и сама, раньше.
  if (!root.lang) root.lang = 'ru';
  const layers = mountLayers(document);
  root.dataset.vs = layers ? 'live' : 'none';
  if (layers) window.__verst = { layers };
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
}
