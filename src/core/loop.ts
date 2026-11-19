export const QUIET_FRAMES = 24;
const MAX_DT = 0.05;
const FIRST_DT = 1 / 60;

export interface Loop { wake(): void; readonly frames: number; readonly awake: boolean; dispose(): void }

/** step возвращает true, пока что-то движется; draw вызывается после каждого step. После QUIET_FRAMES тихих кадров цикл перестаёт запрашивать кадры. Новый цикл бодрствует. dt не больше 0.05 с. */
export function createLoop(
  step: (dt: number) => boolean,
  draw: () => void,
  raf: (cb: (t: number) => void) => number = (cb) => requestAnimationFrame(cb),
  caf: (id: number) => void = (id) => cancelAnimationFrame(id),
): Loop {
  let pending: number | null = null;
  let quiet = QUIET_FRAMES;
  let last: number | null = null;
  let frames = 0;
  let disposed = false;

  const request = (): void => {
    if (pending === null && !disposed) pending = raf(tick);
  };

  function tick(t: number): void {
    pending = null;
    const dt = last === null ? FIRST_DT : Math.min((t - last) / 1000, MAX_DT);
    last = t;
    const moving = step(dt);
    draw();
    frames += 1;
    quiet = moving ? QUIET_FRAMES : quiet - 1;
    if (quiet > 0) request();
  }

  request();

  return {
    wake() {
      quiet = QUIET_FRAMES;
      if (pending === null) last = null;
      request();
    },
    get frames() { return frames; },
    get awake() { return pending !== null; },
    dispose() {
      disposed = true;
      if (pending !== null) {
        caf(pending);
        pending = null;
      }
    },
  };
}
