#!/usr/bin/env bash
# Проверки scripts/deploy.sh без сервера. Функции скрипта подключаются из копии без последней
# строки (main "$@"), каждый случай идёт в отдельном bash. ssh, curl и npm заменены функциями-
# заглушками, а на PATH стоят ssh/curl/scp/sftp/rsync, которые только пишут в журнал и падают:
# даже обход функций не выйдет в сеть. В конце журнал должен быть пуст.
# Фикстура: игрушечные dist/verst.js и шрифт, из которых настоящий scripts/tag.mjs собирает dist/.
# Запуск: bash scripts/deploy.test.sh   (npm run test:deploy)
set -uo pipefail
export LC_ALL=C
cd "$(dirname "$0")/.."
ROOT=$(pwd)

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# --- Библиотека: deploy.sh без вызова main.

last=$(tail -n 1 scripts/deploy.sh)
if [ "$last" != 'main "$@"' ]; then
  echo "последняя строка scripts/deploy.sh не main \"\$@\", а: $last" >&2
  exit 1
fi
sed '$d' scripts/deploy.sh > "$work/deploy-lib.sh"

# --- Запрет сети на уровне PATH.

mkdir "$work/bin"
for tool in ssh curl scp sftp rsync; do
  printf '#!/bin/sh\necho "%s $*" >> "%s/forbidden.log"\nexit 99\n' "$tool" "$work" > "$work/bin/$tool"
  chmod +x "$work/bin/$tool"
done
export PATH="$work/bin:$PATH"
# git настоящий, но без глобального и системного конфига владельца: результат не зависит от машины.
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1

# --- Фикстура.

mkdir -p "$work/fixture/dist" "$work/fixture/assets/fonts"
printf 'console.log("verst fixture");\n' > "$work/fixture/dist/verst.js"
printf 'wOF2 fixture font bytes\n' > "$work/fixture/assets/fonts/SofiaSans-VF.woff2"
if ! (cd "$work/fixture" && node "$ROOT/scripts/tag.mjs" > "$work/tag.out" 2>&1); then
  echo "scripts/tag.mjs не собрал фикстуру:" >&2
  cat "$work/tag.out" >&2
  exit 1
fi
fx_js=$(cd "$work/fixture/dist" && ls assets/verst-*.js)
fx_font=$(cd "$work/fixture/dist" && ls assets/sofia-sans-*.woff2)
fx_tag=$(cat "$work/fixture/dist/tag.txt")
fx_font_url=$(cat "$work/fixture/dist/font.txt")
# Фикстура — свой git-репозиторий с одним коммитом; dist/ в нём игнорируется, каталога tilda/ нет.
mkdir -p "$work/fixture/src"
printf 'export {};\n' > "$work/fixture/src/index.ts"
printf '{ "name": "fixture" }\n' > "$work/fixture/package.json"
printf 'fixture\n' > "$work/fixture/README.md"
printf 'dist/\n' > "$work/fixture/.gitignore"
if ! (cd "$work/fixture" && git -c init.defaultBranch=main init -q && git add -A \
  && git -c user.name=fixture -c user.email=fixture@example.invalid commit -q -m fixture) > "$work/git.out" 2>&1; then
  echo "git не создал репозиторий фикстуры:" >&2
  cat "$work/git.out" >&2
  exit 1
fi
fx_commit=$(cd "$work/fixture" && git rev-parse --short HEAD)

# --- Общее начало каждого случая (выполняется внутри bash -c).

prelude='
unset npm_config_dry_run
ssh() {
  { printf "ssh"; printf " %s" "$@"; printf "\n"; } >> "$CASE/ssh.log"
  cat > "$CASE/ssh.stdin.$(grep -c "" "$CASE/ssh.log")"
}
curl() { printf "curl %s\n" "$*" >> "$CASE/curl.log"; return 7; }
npm() { printf "npm %s\n" "$*" >> "$CASE/npm.log"; return 0; }
source "$LIB"
cd "$CASE/root"
tmp=$CASE/tmp
H1=1111111111111111111111111111111111111111111111111111111111111111
H2=2222222222222222222222222222222222222222222222222222222222222222
H3=3333333333333333333333333333333333333333333333333333333333333333
H4=4444444444444444444444444444444444444444444444444444444444444444
HX=9999999999999999999999999999999999999999999999999999999999999999
# Локальный манифест с условными хэшами: br, gz, шрифт, бандл.
fake_local_manifest() {
  printf "%s  %s\n" "$H1" "$BR" "$H2" "$GZ" "$H4" "$FONT" "$H3" "$JS" > "$tmp/local.sha256"
}
# Удалённый манифест из пар <хэш> <путь>.
fake_remote_manifest() {
  : > "$tmp/remote.sha256"
  while [ "$#" -gt 1 ]; do
    printf "%s  ./%s\n" "$1" "$2" >> "$tmp/remote.sha256"
    shift 2
  done
}
# curl-заглушка, которая отвечает как настроенный Caddy: заголовки с CRLF, тела из dist/assets
# (бандл как br или gzip по Accept-Encoding, иначе без сжатия; шрифт без сжатия), портфолио 200.
serve_dist() {
  curl() {
    local out="" hdr="" wfmt="" enc="" url="" name body ctype ce=""
    printf "curl %s\n" "$*" >> "$CASE/curl.log"
    while [ "$#" -gt 0 ]; do
      case "$1" in
        -o) out=$2; shift 2 ;;
        -D) hdr=$2; shift 2 ;;
        -w) wfmt=$2; shift 2 ;;
        --max-time) shift 2 ;;
        -H)
          case "$2" in "Accept-Encoding: "*) enc=${2#Accept-Encoding: } ;; esac
          shift 2 ;;
        -*) shift ;;
        *) url=$1; shift ;;
      esac
    done
    if [ "$url" = https://lekzyrs.com/ ]; then
      [ -z "$wfmt" ] || printf "200"
      return 0
    fi
    name=${url#https://lekzyrs.com/verst/assets/}
    [ -f "dist/assets/$name" ] || return 22
    body=dist/assets/$name
    case "$name" in
      *.js)
        ctype="text/javascript; charset=utf-8"
        case "$enc" in
          *br*) ce=br; body=$body.br ;;
          *gzip*) ce=gzip; body=$body.gz ;;
        esac ;;
      *.woff2) ctype=font/woff2 ;;
      *) return 22 ;;
    esac
    if [ -n "$hdr" ]; then
      {
        printf "HTTP/2 200\r\n"
        printf "access-control-allow-origin: *\r\n"
        printf "cache-control: public, max-age=31536000, immutable\r\n"
        [ -z "$ce" ] || printf "content-encoding: %s\r\n" "$ce"
        printf "content-type: %s\r\n" "$ctype"
        printf "vary: Accept-Encoding\r\n"
        printf "x-content-type-options: nosniff\r\n"
        printf "\r\n"
      } > "$hdr"
    fi
    if [ -n "$out" ] && [ "$out" != /dev/null ]; then
      cp "$body" "$out"
    fi
  }
}
'

# --- Запуск случаев и проверки.

n=0
passed=0
failed=0

run_case() {
  n=$((n + 1))
  CASE="$work/case-$n"
  mkdir -p "$CASE/tmp"
  cp -R "$work/fixture" "$CASE/root"
  echo "=== $n. $1"
  case_failed=0
  rc=0
  CASE=$CASE LIB="$work/deploy-lib.sh" bash -c "$prelude
$2" "$ROOT/scripts/deploy.sh" > "$CASE/out" 2>&1 < /dev/null || rc=$?
}

pass() {
  passed=$((passed + 1))
  echo "  ok    $1"
}

fail() {
  failed=$((failed + 1))
  case_failed=1
  echo "  FAIL  $1"
}

expect_rc() {
  if [ "$rc" = "$1" ]; then pass "код $1"; else fail "код $rc, ожидался $1"; fi
}

# expect_in <файл> <текст>: текст есть в файле (файл относительно каталога случая).
expect_in() {
  if [ -f "$CASE/$1" ] && grep -Fq -- "$2" "$CASE/$1"; then
    pass "$1: «$2»"
  else
    fail "$1: нет «$2»"
  fi
}

expect_not_in() {
  if [ -f "$CASE/$1" ] && grep -Fq -- "$2" "$CASE/$1"; then
    fail "$1: лишнее «$2»"
  else
    pass "$1: нет «$2»"
  fi
}

expect_lines() {
  local got=0
  if [ -f "$CASE/$1" ]; then
    got=$(grep -c "" "$CASE/$1")
  fi
  if [ "$got" = "$2" ]; then pass "$1: строк $2"; else fail "$1: строк $got, ожидалось $2"; fi
}

# expect_line <файл> <номер> <текст>: строка с этим номером равна тексту целиком.
expect_line() {
  local got=""
  if [ -f "$CASE/$1" ]; then
    got=$(sed -n "$2p" "$CASE/$1")
  fi
  if [ "$got" = "$3" ]; then pass "$1: строка $2 «$3»"; else fail "$1: строка $2 «$got», ожидалась «$3»"; fi
}

# expect_count <файл> <регулярное выражение> <число>: столько строк файла подходят.
expect_count() {
  local got=0
  if [ -f "$CASE/$1" ]; then
    got=$(grep -c -- "$2" "$CASE/$1")
  fi
  if [ "$got" = "$3" ]; then pass "$1: «$2» строк $3"; else fail "$1: «$2» строк $got, ожидалось $3"; fi
}

show_if_failed() {
  if [ "$case_failed" = 1 ]; then
    echo "  --- вывод случая:"
    sed 's/^/  | /' "$CASE/out"
  fi
}

# --- Аргументы.

run_case "пустой аргумент: usage, не выкладка" 'parse_args ""; echo "DRY=$DRY"'
expect_rc 2
expect_in out "usage:"
expect_not_in out "DRY="
show_if_failed

run_case "неизвестный аргумент: usage" 'parse_args --wat; echo "DRY=$DRY"'
expect_rc 2
expect_in out "usage:"
show_if_failed

run_case "два аргумента: usage" 'parse_args --dry-run extra; echo "DRY=$DRY"'
expect_rc 2
expect_in out "usage:"
show_if_failed

run_case "без аргументов: выкладка" 'parse_args; echo "DRY=$DRY"'
expect_rc 0
expect_in out "DRY=0"
show_if_failed

run_case "--dry-run: пробный запуск" 'parse_args --dry-run; echo "DRY=$DRY"'
expect_rc 0
expect_in out "DRY=1"
show_if_failed

run_case "npm забрал --dry-run (npm_config_dry_run=true, аргументов нет): usage" \
  'npm_config_dry_run=true; parse_args; echo "DRY=$DRY"'
expect_rc 2
expect_in out "npm забрал --dry-run"
expect_not_in out "DRY="
show_if_failed

run_case "npm_config_dry_run=true и --dry-run: пробный запуск" \
  'npm_config_dry_run=true; parse_args --dry-run; echo "DRY=$DRY"'
expect_rc 0
expect_in out "DRY=1"
show_if_failed

# --- Сопоставление со всей строкой.

run_case "matches_re: вся строка, а не одна из строк" '
  re="^verst-[0-9a-f]{10}\.js\$"
  if matches_re "verst-0123456789.js" "$re"; then echo "одна строка: да"; fi
  if matches_re "$(printf "verst-0123456789.js\nevil")" "$re"; then echo "две строки: да"; else echo "две строки: нет"; fi
  if matches_re "xverst-0123456789.js" "$re"; then echo "префикс: да"; else echo "префикс: нет"; fi'
expect_rc 0
expect_in out "одна строка: да"
expect_in out "две строки: нет"
expect_in out "префикс: нет"
show_if_failed

# --- Файлы сборки: бандл, шрифт, тег, адрес шрифта, сайдкары.

run_case "фикстура проходит все проверки сборки" '
  find_build_files; check_tag; check_font_txt; make_sidecars; check_sidecars; check_send_candidates
  echo "JS=$JS FONT=$FONT URL=$FONT_URL"'
expect_rc 0
expect_in out "FONT=assets/sofia-sans-"
expect_in out "URL=https://lekzyrs.com/verst/assets/sofia-sans-"
show_if_failed

run_case "хэш в имени шрифта не совпадает с содержимым" '
  f=$(ls dist/assets/sofia-sans-*.woff2)
  mv "$f" dist/assets/sofia-sans-0000000000.woff2
  find_build_files; echo "не должно печататься"'
expect_rc 1
expect_in out "хэш в имени sofia-sans-0000000000.woff2 не совпадает"
expect_not_in out "не должно печататься"
show_if_failed

run_case "шрифт в dist не равен исходнику (имя по его же хэшу)" '
  rm dist/assets/sofia-sans-*.woff2
  printf "other font\n" > "$tmp/other.woff2"
  h=$(sha256_of "$tmp/other.woff2" | cut -c 1-10)
  cp "$tmp/other.woff2" "dist/assets/sofia-sans-$h.woff2"
  find_build_files; echo "не должно печататься"'
expect_rc 1
expect_in out "отличается от assets/fonts/SofiaSans-VF.woff2"
show_if_failed

run_case "шрифта в dist нет" '
  rm dist/assets/sofia-sans-*.woff2
  find_build_files; echo "не должно печататься"'
expect_rc 1
expect_in out "ожидались два файла"
show_if_failed

run_case "лишний файл в dist/assets" '
  : > dist/assets/extra.css
  find_build_files; echo "не должно печататься"'
expect_rc 1
expect_in out "ожидались два файла"
show_if_failed

run_case "dist/font.txt указывает не на шрифт" '
  find_build_files
  printf "https://lekzyrs.com/verst/assets/sofia-sans-0000000000.woff2\n" > dist/font.txt
  check_font_txt; echo "не должно печататься"'
expect_rc 1
expect_in out "dist/font.txt (https://lekzyrs.com/verst/assets/sofia-sans-0000000000.woff2) не указывает"
show_if_failed

run_case "сайдкар .gz распаковывается не в бандл" '
  find_build_files; make_sidecars
  printf "something else\n" | gzip -9 -n > "dist/$GZ"
  check_sidecars; echo "не должно печататься"'
expect_rc 1
expect_in out ".gz не распаковывается в dist/"
show_if_failed

run_case "сайдкар .gz испорчен" '
  find_build_files; make_sidecars
  printf "not gzip at all\n" > "dist/$GZ"
  check_sidecars; echo "не должно печататься"'
expect_rc 1
expect_in out ".gz не распаковывается"
expect_not_in out "не распаковывается в dist/"
show_if_failed

# --- Удалённый манифест.

run_case "манифест сервера со строкой неверного вида" '
  find_build_files
  ssh() { printf "%s  ./a\n\\\\%s  ./b\n" "$H1" "$H2"; }
  fetch_remote_manifest; echo "не должно печататься"'
expect_rc 1
expect_in out "строк неверного вида: 1"
show_if_failed

run_case "на сервере нет каталога (код 3)" '
  find_build_files
  ssh() { return 3; }
  fetch_remote_manifest; echo "не должно печататься"'
expect_rc 1
expect_in out "нужна разовая настройка сервера"
show_if_failed

run_case "листинг идёт через ssh с BatchMode, ConnectTimeout и keepalive" '
  find_build_files
  fetch_remote_manifest; echo "строк: $(count_lines "$tmp/remote.sha256")"'
expect_rc 0
expect_in ssh.log "ssh -o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=4 netcup sudo -n sh -c "
expect_in out "строк: 0"
show_if_failed

# --- План отправки.

run_case "бандл на месте, br нет, gz другой, шрифта нет, старый бандл на сервере" '
  find_build_files; fake_local_manifest
  fake_remote_manifest "$H3" "$JS" "$HX" "$GZ" "$HX" "assets/verst-0123456789.js"
  plan_transfer
  cp "$tmp/send" "$CASE/send"; cp "$tmp/present" "$CASE/present"
  echo "прочих: $(count_other_remote_files)"
  publish_from_stage'
expect_rc 0
expect_lines send 3
expect_in send "$fx_font"
expect_in present "$fx_js"
expect_lines present 1
expect_in out "сайдкар $fx_js.gz на сервере отличается"
expect_in out "прочих: 1"
expect_in ssh.log "mv -f $fx_font /var/www/verst/assets/"
expect_not_in ssh.log "mv -f $fx_js /var/www/verst/assets/"
show_if_failed

run_case "на сервере бандл с тем же именем и другим содержимым" '
  find_build_files; fake_local_manifest
  fake_remote_manifest "$HX" "$JS"
  plan_transfer; echo "не должно печататься"'
expect_rc 1
expect_in out "не перезаписывается"
show_if_failed

run_case "на сервере шрифт с тем же именем и другим содержимым" '
  find_build_files; fake_local_manifest
  fake_remote_manifest "$H3" "$JS" "$HX" "$FONT"
  plan_transfer; echo "не должно печататься"'
expect_rc 1
expect_in out "уже лежит assets/sofia-sans-"
expect_in out "не перезаписывается"
show_if_failed

run_case "на сервере пусто: порядок команд при переносе" '
  find_build_files; fake_local_manifest
  fake_remote_manifest
  plan_transfer
  publish_from_stage'
expect_rc 0
expect_lines ssh.stdin.1 4
# Части серверной команды по одной на строку: текст после «sh -c» без внешних кавычек.
sed -n "s/^ssh .* sudo -n sh -c '//p" "$CASE/ssh.log" | sed "s/'\$//" \
  | awk '{ n = split($0, parts, / && /); for (i = 1; i <= n; i++) print parts[i] }' > "$CASE/steps"
expect_in steps "sha256sum -c --strict --quiet -"
show_if_failed
if [ "$rc" = 0 ]; then
  # Первые шаги: cd в STAGE, сразу сверка; последние: mv бандла, cd /, удаление STAGE.
  order=$(awk '{ printf "%s|", $1 }' "$CASE/steps")
  want_order="cd|sha256sum|chown|chmod|install|mv|mv|mv|mv|cd|rm|"
  if [ "$order" = "$want_order" ]; then pass "порядок: $order"; else fail "порядок: $order, ожидался $want_order"; fi
  last_mv=$(grep '^mv ' "$CASE/steps" | tail -n 1)
  case "$last_mv" in
    "mv -f assets/verst-"*".js /var/www/verst/assets/") pass "последний mv — бандл: $last_mv" ;;
    *) fail "последний mv не бандл: $last_mv" ;;
  esac
  if grep -q '^mv -f assets/sofia-sans-.*\.woff2 /var/www/verst/assets/$' "$CASE/steps"; then
    pass "шрифт переносится до бандла"
  else
    fail "нет mv шрифта"
  fi
  show_if_failed
fi

run_case "трасса переноса показывает ровно ту команду ssh, что выполняется" '
  find_build_files; fake_local_manifest
  fake_remote_manifest
  plan_transfer
  publish_from_stage'
expect_rc 0
expect_lines ssh.log 1
expect_in out "+ ssh -o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=4 netcup \"sudo -n sh -c '"
show_if_failed
if [ "$rc" = 0 ]; then
  # Заглушка ssh пишет аргументы через пробел; трасса — те же слова, последний в двойных кавычках.
  traced=$(sed -n 's/^+ //p' "$CASE/out" | tr -d '"')
  called=$(sed -n 1p "$CASE/ssh.log")
  if [ -n "$traced" ] && [ "$traced" = "$called" ]; then
    pass "трасса равна вызову"
  else
    fail "трасса «$traced» не равна вызову «$called»"
  fi
  show_if_failed
fi

run_case "всё уже на сервере" '
  find_build_files; fake_local_manifest
  fake_remote_manifest "$H1" "$BR" "$H2" "$GZ" "$H4" "$FONT" "$H3" "$JS"
  plan_transfer
  echo "к отправке: $(count_lines "$tmp/send"), на месте: $(count_lines "$tmp/present"), прочих: $(count_other_remote_files)"'
expect_rc 0
expect_in out "к отправке: 0, на месте: 4, прочих: 0"
show_if_failed

# --- Настоящий запуск (ssh — заглушка, проверки после выкладки подменены).

run_case "остаток STAGE удаляется, даже если отправлять нечего" '
  find_build_files; check_font_txt; fake_local_manifest
  fake_remote_manifest "$H1" "$BR" "$H2" "$GZ" "$H4" "$FONT" "$H3" "$JS"
  plan_transfer
  post_deploy_checks() { echo "проверки-заглушка"; }
  deploy_for_real'
expect_rc 0
expect_lines ssh.log 1
expect_in ssh.log "sudo -n rm -rf -- /var/www/.verst-incoming"
expect_in out "отправлять нечего"
expect_in out "выложено"
show_if_failed

run_case "есть что отправить: STAGE убирается первым, затем симлинки, tar, перенос" '
  find_build_files; check_font_txt; make_sidecars; fake_local_manifest
  fake_remote_manifest
  plan_transfer
  post_deploy_checks() { echo "проверки-заглушка"; }
  deploy_for_real
  tar -tf "$CASE/ssh.stdin.3" > "$CASE/tar.list"'
expect_rc 0
expect_lines ssh.log 4
expect_lines tar.list 4
show_if_failed
if [ "$rc" = 0 ]; then
  first=$(sed -n 1p "$CASE/ssh.log")
  second=$(sed -n 2p "$CASE/ssh.log")
  third=$(sed -n 3p "$CASE/ssh.log")
  case "$first" in *"rm -rf -- /var/www/.verst-incoming") pass "1: удаление STAGE" ;; *) fail "1: $first" ;; esac
  case "$second" in *"sudo -n find /var/www/verst -type l") pass "2: проверка симлинков" ;; *) fail "2: $second" ;; esac
  case "$third" in *"tar -xf - --no-same-owner --no-same-permissions -C /var/www/.verst-incoming'") pass "3: tar в STAGE" ;; *) fail "3: $third" ;; esac
  show_if_failed
fi

# --- Разбор заголовков и проверки после выкладки.

run_case "разбор заголовков (ответ с CRLF)" '
  printf "HTTP/2 200\r\naccess-control-allow-origin: *\r\ncache-control: public, max-age=31536000, immutable\r\ncontent-type: font/woff2\r\n\r\n" > "$tmp/h.raw"
  tr -d "\r" < "$tmp/h.raw" > "$tmp/h"
  CHECKS_FAILED=0
  check_equal "статус" "$(status_of "$tmp/h")" 200
  check_equal "content-type" "$(header_of content-type "$tmp/h")" font/woff2
  check_equal "cache-control" "$(header_of cache-control "$tmp/h")" "public, max-age=31536000, immutable"
  check_equal "acao" "$(header_of access-control-allow-origin "$tmp/h")" "*"
  check_equal "нет заголовка" "$(header_of etag "$tmp/h")" x
  echo "CHECKS_FAILED=$CHECKS_FAILED"'
expect_rc 0
expect_in out "ok    content-type: font/woff2"
expect_in out "FAIL  нет заголовка"
expect_in out "CHECKS_FAILED=1"
show_if_failed

run_case "проверки после выкладки без сети: сбой и код 1, шрифт тоже проверяется" '
  find_build_files; check_tag; check_font_txt
  post_deploy_checks; echo "не должно печататься"'
expect_rc 1
expect_in out "--- проверки шрифта: https://lekzyrs.com/verst/assets/sofia-sans-"
expect_in out "FAIL  sha256 тела gzip"
expect_in out "ABORT: проверки после выкладки не прошли"
expect_in curl.log "Origin: https://verst-07.tilda.ws https://lekzyrs.com/verst/assets/sofia-sans-"
show_if_failed

run_case "check_bundle_url: сервер отвечает как надо, сбоев нет" '
  find_build_files; check_tag; make_sidecars; serve_dist
  CHECKS_FAILED=0
  check_bundle_url
  echo "CHECKS_FAILED=$CHECKS_FAILED"'
expect_rc 0
expect_in out "CHECKS_FAILED=0"
expect_not_in out "FAIL  "
expect_count out "^  ok    " 10
expect_in out "ok    content-encoding (br,gzip): br"
expect_in out "ok    content-encoding (gzip): gzip"
expect_in out "ok    integrity тела: sha384-"
expect_in out "ok    sha256 тела br: "
expect_in out "ok    sha256 тела gzip: "
expect_lines curl.log 5
show_if_failed

run_case "check_font_url: шрифт отдаётся как надо, сбоев нет" '
  find_build_files; check_font_txt; serve_dist
  CHECKS_FAILED=0
  check_font_url
  echo "CHECKS_FAILED=$CHECKS_FAILED"'
expect_rc 0
expect_in out "CHECKS_FAILED=0"
expect_not_in out "FAIL  "
expect_count out "^  ok    " 5
expect_in out "ok    content-type: font/woff2"
expect_in out "ok    sha256 тела: "
expect_lines curl.log 2
show_if_failed

run_case "проверки после выкладки: всё в порядке, код 0" '
  find_build_files; check_tag; check_font_txt; make_sidecars; serve_dist
  post_deploy_checks; echo "проверки прошли"'
expect_rc 0
expect_in out "проверки прошли"
expect_not_in out "FAIL  "
expect_not_in out "ABORT"
expect_count out "^  ok    " 16
expect_in out "ok    https://lekzyrs.com/: 200"
show_if_failed

# --- main целиком (ssh, curl и npm — заглушки).

run_case "main --dry-run: один вызов сервера (листинг), без tar и переноса, печатает шрифт и тег" '
  main --dry-run; echo "не должно печататься"'
expect_rc 0
expect_lines ssh.log 1
expect_in ssh.log "sudo -n sh -c 'test -d /var/www/verst || exit 3; cd /var/www/verst && find . -type f -print0 | sort -z | xargs -0 -r sha256sum'"
expect_lines ssh.stdin.1 0
expect_not_in ssh.log "tar "
expect_not_in ssh.log "mv -f"
expect_not_in ssh.log "rm -rf"
expect_not_in ssh.log "sha256sum -c"
expect_not_in out "+ ssh"
expect_lines curl.log 0
expect_in out "--- к отправке в /var/www/verst/assets/: 4"
expect_in out "пробный запуск: на сервере ничего не записано"
expect_in out "$fx_font_url"
expect_in out "$fx_tag"
expect_not_in out "выложено"
expect_not_in out "не должно печататься"
expect_line out 1 "коммит: $fx_commit"
expect_not_in out "ВНИМАНИЕ"
expect_lines npm.log 2
expect_line npm.log 1 "npm test"
expect_line npm.log 2 "npm run build"
show_if_failed

# --- Происхождение: коммит, чистое дерево исходников, npm test до сборки.

run_case "npm test падает: сборки нет, сервер не тронут" '
  npm() { printf "npm %s\n" "$*" >> "$CASE/npm.log"; [ "$1" != test ]; }
  main --dry-run; echo "не должно печататься"'
expect_rc 1
expect_in out "ABORT: npm test не прошёл"
expect_lines npm.log 1
expect_line npm.log 1 "npm test"
expect_lines ssh.log 0
expect_not_in out "не должно печататься"
show_if_failed

run_case "грязное дерево: настоящая выкладка отказывает до сборки и до сервера" '
  printf "// правка\n" >> src/index.ts
  main; echo "не должно печататься"'
expect_rc 1
expect_line out 1 "коммит: $fx_commit"
expect_in out "M src/index.ts"
expect_in out "ABORT: настоящая выкладка только из закоммиченного дерева"
expect_lines npm.log 0
expect_lines ssh.log 0
expect_not_in out "не должно печататься"
show_if_failed

run_case "грязное дерево: пробный запуск предупреждает и доходит до конца" '
  printf "// правка\n" >> src/index.ts
  : > src/new.ts
  main --dry-run'
expect_rc 0
expect_line out 1 "коммит: $fx_commit"
expect_in out "M src/index.ts"
expect_in out "?? src/new.ts"
expect_in out "ВНИМАНИЕ: пробный запуск продолжается"
expect_not_in out "ABORT"
expect_in out "пробный запуск: на сервере ничего не записано"
expect_in out "$fx_tag"
expect_lines npm.log 2
expect_lines ssh.log 1
show_if_failed

run_case "грязным дерево делают только пути из списка; нет tilda/ — не ошибка" '
  [ -e tilda ] || echo "tilda нет"
  DRY=0
  check_provenance > "$CASE/clean.out" 2>&1 && echo "чисто"
  i=0
  for p in src/index.ts src/new.ts scripts/x.sh assets/new.bin tilda/head.template.html package.json \
           package-lock.json vite.config.ts tsconfig.json \
           README.md docs/a.md tests/a.test.ts srcx/a.ts vite.config.js dist/extra.txt; do
    i=$((i + 1))
    cp -R "$CASE/root" "$CASE/w$i"
    r=0
    (cd "$CASE/w$i" && mkdir -p "$(dirname "$p")" && printf "x\n" >> "$p" && check_provenance) > "$CASE/w$i.out" 2>&1 || r=$?
    if [ "$r" = 0 ]; then
      echo "пропущено: $p"
    elif grep -Fq "только из закоммиченного дерева" "$CASE/w$i.out"; then
      echo "отказ: $p"
    else
      echo "другой сбой ($r): $p"
    fi
  done'
expect_rc 0
expect_in out "tilda нет"
expect_in out "чисто"
expect_in clean.out "коммит: $fx_commit"
for p in src/index.ts src/new.ts scripts/x.sh assets/new.bin tilda/head.template.html package.json \
  package-lock.json vite.config.ts tsconfig.json; do
  expect_in out "отказ: $p"
done
for p in README.md docs/a.md tests/a.test.ts srcx/a.ts vite.config.js dist/extra.txt; do
  expect_in out "пропущено: $p"
done
show_if_failed

run_case "git status не выполнился: даже пробный запуск не начинается" '
  git() { if [ "$1" = status ]; then echo "fatal: сбой" >&2; return 128; fi; command git "$@"; }
  main --dry-run; echo "не должно печататься"'
expect_rc 1
expect_in out "ABORT: git status не выполнился"
expect_lines npm.log 0
expect_lines ssh.log 0
expect_not_in out "не должно печататься"
show_if_failed

# --- Итог.

echo "==="
if [ -s "$work/forbidden.log" ]; then
  fail "кто-то обошёл заглушки и вызвал сетевую программу:"
  sed 's/^/  | /' "$work/forbidden.log"
else
  pass "сетевые программы с PATH не вызывались"
fi
echo "проверок: $((passed + failed)), прошло $passed, упало $failed"
[ "$failed" = 0 ]
