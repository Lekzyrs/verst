const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);

/** Цветовая температура в кельвинах: 2000…4500, шаг 50. warmth зажимается в 0..1. */
export function kelvinOf(warmth: number): number {
  return Math.round((2000 + clamp01(warmth) * 2500) / 50) * 50;
}

// Опорные цвета sRGB: #ff8a12 (0), #ffb46a (0.28), #ffe9d2 (1).
const STOPS: Array<[number, [number, number, number]]> = [
  [0, [0xff, 0x8a, 0x12]],
  [0.28, [0xff, 0xb4, 0x6a]],
  [1, [0xff, 0xe9, 0xd2]],
];

/** Цвет лампы по warmth 0..1 как sRGB-каналы 0..1, линейно между опорными цветами. */
export function kelvinRgb(warmth: number): [number, number, number] {
  const w = clamp01(warmth);
  const [a, b] = w < STOPS[1][0] ? [STOPS[0], STOPS[1]] : [STOPS[1], STOPS[2]];
  const t = (w - a[0]) / (b[0] - a[0]);
  return a[1].map((ca, i) => (ca + (b[1][i] - ca) * t) / 255) as [number, number, number];
}
