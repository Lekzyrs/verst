// Готовит выкладку: копии бандла и шрифта с хэшем в имени, SRI-хэш бандла,
// строка тега в dist/tag.txt и адрес шрифта в dist/font.txt.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const BASE_URL = 'https://lekzyrs.com/verst/assets/';
const src = 'dist/verst.js';
const fontSrc = 'assets/fonts/SofiaSans-VF.woff2';

if (!existsSync(src)) {
  console.error(`tag: ${src} не найден, сначала выполните vite build`);
  process.exit(1);
}
if (!existsSync(fontSrc)) {
  console.error(`tag: шрифт ${fontSrc} не найден, без него выкладку не собрать`);
  process.exit(1);
}

// Первые 10 hex sha256: имя адресует содержимое, поэтому файл можно кэшировать навсегда.
const sha256Prefix = (bytes) => createHash('sha256').update(bytes).digest('hex').slice(0, 10);

const bytes = readFileSync(src);
const sha384Base64 = createHash('sha384').update(bytes).digest('base64');
const name = `verst-${sha256Prefix(bytes)}.js`;

mkdirSync('dist/assets', { recursive: true });
copyFileSync(src, `dist/assets/${name}`);

const fontName = `sofia-sans-${sha256Prefix(readFileSync(fontSrc))}.woff2`;
copyFileSync(fontSrc, `dist/assets/${fontName}`);

const tag = `<script src="${BASE_URL}${name}" integrity="sha384-${sha384Base64}" crossorigin="anonymous" defer></script>`;
writeFileSync('dist/tag.txt', `${tag}\n`);
console.log(tag);

const fontUrl = `${BASE_URL}${fontName}`;
writeFileSync('dist/font.txt', `${fontUrl}\n`);
console.log(fontUrl);
