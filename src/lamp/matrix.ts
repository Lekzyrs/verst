export const COLS = 24;
export const ROWS = 14;

// Шрифт 5×7 для цифр; строка — ряд глифа, '1' — включённая точка.
const FONT: Record<string, string[]> = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
};

/** Маска точек COLS × ROWS: цифры 5×7 с шагом 6 колонок, блок по центру. Прочие знаки пропускаются. */
export function digitMask(text: string): Uint8Array {
  const mask = new Uint8Array(COLS * ROWS);
  const width = text.length * 5 + (text.length - 1);
  const c0 = Math.floor((COLS - width) / 2);
  const r0 = Math.floor((ROWS - 7) / 2);
  [...text].forEach((ch, n) => {
    const glyph = FONT[ch];
    if (!glyph) return;
    for (let r = 0; r < 7; r++)
      for (let c = 0; c < 5; c++) if (glyph[r][c] === '1') mask[(r0 + r) * COLS + c0 + n * 6 + c] = 1;
  });
  return mask;
}

const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);

/** Яркость каждой точки 0..1. fill: доля включения, волна слева направо шириной 5 колонок. digits: 0..1, насколько видны цифры; они учитываются только при fill > 0.6. Возвращает среднюю яркость. */
export function fillLevels(fill: number, mask: Uint8Array | null, digits: number, out: Float32Array): number {
  let sum = 0;
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const i = row * COLS + col;
      let b = clamp01((fill * (COLS + 5) - col) / 5);
      if (mask && digits > 0 && fill > 0.6 && !mask[i]) b *= 1 - 0.9 * digits;
      out[i] = b;
      sum += b;
    }
  }
  return sum / (COLS * ROWS);
}
