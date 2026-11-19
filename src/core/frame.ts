export interface Rect { left: number; top: number; width: number; height: number }
export interface Framing { distance: number; shiftX: number; shiftY: number }

/** Расстояние камеры и сдвиг проекции (доли экрана, −1..1, вправо и вверх положительные), при которых шар радиуса radius занимает долю fill меньшей стороны рамки и стоит в её центре. */
export function frameToRect(
  viewW: number,
  viewH: number,
  fovDeg: number,
  stage: Rect,
  radius: number,
  fill = 0.92,
): Framing {
  const tanHalf = Math.tan((fovDeg * Math.PI) / 360);
  const side = Math.min(stage.width, stage.height);
  return {
    distance: (radius * viewH) / (tanHalf * side * fill),
    shiftX: ((stage.left + stage.width / 2) / viewW) * 2 - 1,
    shiftY: 1 - ((stage.top + stage.height / 2) / viewH) * 2,
  };
}
