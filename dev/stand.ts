// Голова страницы на стенде: те же скрипт и стили, что вставляются в head Tilda (tilda/head.template.html).
// Единственное отличие: адрес шрифта ведёт на локальный файл. Модуль стоит в разметке перед бандлом и выполняется до него.
import template from '../tilda/head.template.html?raw';

const FONT_URL = '/assets/fonts/SofiaSans-VF.woff2';

const head = new DOMParser().parseFromString(
  template.replace('{{FONT_URL}}', FONT_URL).replace('{{BUNDLE_TAG}}', ''),
  'text/html',
);
const script = head.querySelector('script');
const style = head.querySelector('style');
if (!script || !style) throw new Error('в tilda/head.template.html нет script или style');

// Скрипт ставит lang="ru" и viewport-fit=cover: выполняется при добавлении, до стилей и до бандла.
const run = document.createElement('script');
run.textContent = script.textContent;
document.head.append(run);
const css = document.createElement('style');
css.id = 'vs-stand-head';
css.textContent = style.textContent;
document.head.append(css);
// ?nolang=1: страница без lang, как до скрипта головы. Так проверяется, что бандл ставит ru сам.
if (new URLSearchParams(location.search).get('nolang') === '1') document.documentElement.removeAttribute('lang');
