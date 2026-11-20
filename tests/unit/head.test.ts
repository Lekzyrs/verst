import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';

// Голова страницы Tilda живёт в tilda/head.template.html с двумя метками. Тест подставляет значения, записанные при последней выкладке
// (tests/unit/fixtures), и требует голову посимвольно, как она записана. Запись совпадает с опубликованной 20.11.2026 кроме одного числа:
// переход цвета текста сужен с 0,05 до 0,01 света (множитель 20 заменён на 100), иначе при свете 0,56–0,59 контраст падал до 1,3 (tests/e2e/page.spec.ts).
const ROOT = resolve(import.meta.dirname, '../..');
const fixture = (name: string): string => readFileSync(join(ROOT, 'tests/unit/fixtures', name), 'utf8');
const template = readFileSync(join(ROOT, 'tilda/head.template.html'), 'utf8');

const scratch = mkdtempSync(join(tmpdir(), 'verst-head-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** Запускает scripts/head.mjs в пустой папке с шаблоном и двумя файлами сборки. */
function run(font: string, tag: string, tpl = join(ROOT, 'tilda/head.template.html')): { head: string; out: string } {
  const dir = mkdtempSync(join(scratch, 'run-'));
  mkdirSync(join(dir, 'tilda'));
  mkdirSync(join(dir, 'dist'));
  copyFileSync(tpl, join(dir, 'tilda/head.template.html'));
  writeFileSync(join(dir, 'dist/font.txt'), font);
  writeFileSync(join(dir, 'dist/tag.txt'), tag);
  const out = execFileSync('node', [join(ROOT, 'scripts/head.mjs')], { cwd: dir, encoding: 'utf8' });
  return { head: readFileSync(join(dir, 'dist/head.html'), 'utf8'), out };
}

describe('голова страницы', () => {
  test('с записанными значениями шаблон даёт голову посимвольно, как она опубликована', () => {
    const { head, out } = run(fixture('published-font.txt'), fixture('published-tag.txt'));
    expect(head).toBe(fixture('published-head.html'));
    expect(out).toContain('dist/head.html');
  });

  test('в шаблоне по одной метке каждого вида', () => {
    expect(template.split('{{FONT_URL}}')).toHaveLength(2);
    expect(template.split('{{BUNDLE_TAG}}')).toHaveLength(2);
  });

  test('в голове есть три требования владельца: цвет текста от света, viewport-fit=cover, тег бандла с integrity и crossorigin', () => {
    const { head } = run(fixture('published-font.txt'), fixture('published-tag.txt'));
    expect(head).toContain('--vs-fg:color-mix(');
    expect(head).toContain('var(--vs-lit,0)');
    expect(head).toContain('viewport-fit=cover');
    expect(head).toMatch(/<script src="[^"]*\/verst-[0-9a-f]+\.js" integrity="sha384-[^"]+" crossorigin="anonymous" defer><\/script>/);
    expect(head).not.toContain('{{');
  });

  test('пустой файл тега или шрифта останавливает сборку головы', () => {
    expect(() => run('\n', fixture('published-tag.txt'))).toThrow();
    expect(() => run(fixture('published-font.txt'), '')).toThrow();
  });
});
