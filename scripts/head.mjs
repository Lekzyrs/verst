// Собирает голову страницы для вставки в Tilda: tilda/head.template.html с адресом шрифта (dist/font.txt)
// и тегом бандла (dist/tag.txt) из scripts/tag.mjs. Пишет dist/head.html и печатает путь к нему.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const TEMPLATE = 'tilda/head.template.html';
const FONT = 'dist/font.txt';
const TAG = 'dist/tag.txt';
const OUT = 'dist/head.html';

const fail = (message) => {
  console.error(`head: ${message}`);
  process.exit(1);
};
const read = (file, hint) => {
  if (!existsSync(file)) fail(`${file} не найден${hint ? `, ${hint}` : ''}`);
  return readFileSync(file, 'utf8');
};

const template = read(TEMPLATE);
const fontUrl = read(FONT, 'сначала выполните node scripts/tag.mjs').trim();
const tag = read(TAG, 'сначала выполните node scripts/tag.mjs').trim();
if (!fontUrl) fail(`${FONT} пуст`);
if (!tag) fail(`${TAG} пуст`);

for (const token of ['{{FONT_URL}}', '{{BUNDLE_TAG}}']) {
  if (template.split(token).length !== 2) fail(`в ${TEMPLATE} метка ${token} должна встречаться ровно один раз`);
}
// split/join, а не replace: в значениях могут быть знаки «$», которые replace читает как шаблон подстановки.
const head = template.split('{{FONT_URL}}').join(fontUrl).split('{{BUNDLE_TAG}}').join(tag);
writeFileSync(OUT, head);
console.log(OUT);
