export const PIXEL_BUDGET = 2_400_000;
export const MAX_RATIO = 1.5;

/** Плотность пикселей: кадр укладывается в бюджет, но не опускается ниже 1 и не выше min(deviceRatio, MAX_RATIO). */
export function pixelRatioFor(cssW: number, cssH: number, deviceRatio: number): number {
  const fit = Math.sqrt(PIXEL_BUDGET / (cssW * cssH));
  const ceiling = Math.min(deviceRatio, MAX_RATIO);
  return Math.max(1, Math.min(fit, ceiling));
}
