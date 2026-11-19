// Готовит выкладку бандла: копия с хэшем в имени, SRI-хэш и строка тега в dist/tag.txt.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const BASE_URL = 'https://lekzyrs.com/verst/assets/';
const src = 'dist/verst.js';

if (!existsSync(src)) {
  console.error(`tag: ${src} не найден, сначала выполните vite build`);
  process.exit(1);
}

const bytes = readFileSync(src);
const sha256Hex = createHash('sha256').update(bytes).digest('hex');
const sha384Base64 = createHash('sha384').update(bytes).digest('base64');
const name = `verst-${sha256Hex.slice(0, 10)}.js`;

mkdirSync('dist/assets', { recursive: true });
copyFileSync(src, `dist/assets/${name}`);

const tag = `<script src="${BASE_URL}${name}" integrity="sha384-${sha384Base64}" crossorigin="anonymous" defer></script>`;
writeFileSync('dist/tag.txt', `${tag}\n`);
console.log(tag);
