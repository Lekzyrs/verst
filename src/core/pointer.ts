// Указатель: мышь, палец и перо берут предмет под собой. Холст событий не ловит (под ним обычная страница),
// поэтому слушатели стоят на окне, а что лежит под указателем, решает pick.

/** Предмет, который можно взять. G описывает, за что именно взяли. */
export interface Grabbable<G> {
  pick(xPx: number, yPx: number, radiusPx: number): G | null;
  grab(grip: G, xPx: number, yPx: number): void;
  drag(xPx: number, yPx: number, dxPx: number, dyPx: number, dt: number): void;
  /** tap: указатель почти не сдвинулся и нажатие было коротким. */
  release(tap: boolean): void;
}

const CONTROLS = 'a, button, input, [role="button"]';
const MOUSE_RADIUS = 14;
const FINGER_RADIUS = 22;
const TAP_SHIFT = 6; // px
const TAP_TIME = 400; // мс
const MIN_DT = 1 / 240;

const onControl = (target: EventTarget | null): boolean => target instanceof Element && target.closest(CONTROLS) !== null;

/** Вешает слушателей на окно. Возвращает функцию, которая их снимает и отпускает предмет, если он в руке. */
export function watchPointer<G>(win: Window, item: Grabbable<G>): () => void {
  const style = win.document.documentElement.style;
  let held: { id: number; x: number; y: number; t: number; x0: number; y0: number; t0: number } | null = null;
  let shown = '';

  const cursor = (value: '' | 'grab' | 'grabbing'): void => {
    if (value === shown) return;
    shown = value;
    style.cursor = value;
  };
  /** Курсор зовёт взять предмет, пока мышь над ним. Сам по себе кадров не рисует. */
  const hover = (e: PointerEvent): void => {
    cursor(e.pointerType === 'mouse' && !onControl(e.target) && item.pick(e.clientX, e.clientY, MOUSE_RADIUS) !== null ? 'grab' : '');
  };
  const drop = (tap: boolean): void => {
    held = null;
    item.release(tap);
  };

  const down = (e: PointerEvent): void => {
    if (held || !e.isPrimary || e.button !== 0 || onControl(e.target)) return;
    const grip = item.pick(e.clientX, e.clientY, e.pointerType === 'mouse' ? MOUSE_RADIUS : FINGER_RADIUS);
    if (grip === null) return;
    e.preventDefault(); // жест по предмету не выделяет текст страницы под ним
    const t = win.performance.now();
    held = { id: e.pointerId, x: e.clientX, y: e.clientY, t, x0: e.clientX, y0: e.clientY, t0: t };
    item.grab(grip, e.clientX, e.clientY);
    cursor('grabbing');
  };
  const move = (e: PointerEvent): void => {
    if (held && e.pointerId !== held.id) return;
    // кнопку мыши отпустили там, откуда событие не пришло: за окном или над чужим фреймом
    if (held && e.pointerType === 'mouse' && e.buttons === 0) drop(false);
    if (!held) {
      hover(e);
      return;
    }
    const t = win.performance.now();
    item.drag(e.clientX, e.clientY, e.clientX - held.x, e.clientY - held.y, Math.max((t - held.t) / 1000, MIN_DT));
    held.x = e.clientX;
    held.y = e.clientY;
    held.t = t;
  };
  const up = (e: PointerEvent): void => {
    if (!held || e.pointerId !== held.id) return;
    const still = Math.hypot(e.clientX - held.x0, e.clientY - held.y0) < TAP_SHIFT && win.performance.now() - held.t0 < TAP_TIME;
    drop(still && e.type === 'pointerup');
    hover(e);
  };
  const blur = (): void => {
    if (!held) return;
    drop(false);
    cursor('');
  };
  // Жест по предмету не прокручивает страницу, жест мимо прокручивает: touch-action тут не поможет,
  // палец касается страницы под холстом. Слушатель не passive, иначе отмена не сработает.
  const touch = (e: TouchEvent): void => {
    const finger = e.changedTouches[0];
    if (!e.cancelable || !finger) return;
    if (held || (!onControl(e.target) && item.pick(finger.clientX, finger.clientY, FINGER_RADIUS) !== null)) e.preventDefault();
  };

  win.addEventListener('pointerdown', down);
  win.addEventListener('pointermove', move);
  win.addEventListener('pointerup', up);
  win.addEventListener('pointercancel', up);
  win.addEventListener('blur', blur);
  win.addEventListener('touchstart', touch, { passive: false });

  return () => {
    win.removeEventListener('pointerdown', down);
    win.removeEventListener('pointermove', move);
    win.removeEventListener('pointerup', up);
    win.removeEventListener('pointercancel', up);
    win.removeEventListener('blur', blur);
    win.removeEventListener('touchstart', touch);
    if (held) drop(false);
    cursor('');
  };
}
