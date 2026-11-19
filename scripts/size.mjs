// Бюджет веса бандла: gzip-размер dist/verst.js не больше 200 КБ.
import { readFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const BUDGET = 200 * 1024;
const file = 'dist/verst.js';

if (!existsSync(file)) {
  console.error(`size: ${file} не найден, сначала выполните vite build`);
  process.exit(1);
}

const raw = readFileSync(file);
const gzip = gzipSync(raw, { level: 9 });
const line = `size: ${file} raw ${raw.length} B, gzip ${gzip.length} B, budget ${BUDGET} B`;

if (gzip.length > BUDGET) {
  console.error(`${line}: превышен бюджет`);
  process.exit(1);
}
console.log(line);
