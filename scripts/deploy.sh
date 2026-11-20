#!/usr/bin/env bash
# Выкладка «Верст» на netcup. Отправляются только файлы с хэшем в имени из dist/assets:
# бандл verst-<хэш>.js с сайдкарами .br и .gz и шрифт sofia-sans-<хэш>.woff2, в /var/www/verst/assets/.
# Страница на Tilda подключает бандл тегом из dist/tag.txt (integrity + crossorigin), шрифт
# через свой @font-face по адресу из dist/font.txt. dist/verst.js, .map, tag.txt и font.txt на сервер не уходят.
#
# Под /var/www/verst скрипт ничего не удаляет: старые файлы остаются, и страница со старым
# тегом продолжает работать. Удаляется только свой промежуточный каталог /var/www/.verst-incoming.
#
# Запуск: bash scripts/deploy.sh [--dry-run]
#         npm run deploy -- --dry-run      (без «--» npm заберёт флаг себе)
# Совместим с /bin/bash 3.2 (macOS): без mapfile, ассоциативных массивов и пустых массивов.
# Проверки без сервера: bash scripts/deploy.test.sh (подключает этот файл без последней строки).
set -euo pipefail
export LC_ALL=C
cd "$(dirname "$0")/.."

readonly HOST=netcup
readonly DEST=/var/www/verst
readonly STAGE=/var/www/.verst-incoming
readonly BASE=https://lekzyrs.com/verst

die() {
  echo "ABORT: $*" >&2
  exit 1
}

usage() {
  echo "usage: bash scripts/deploy.sh [--dry-run]   (через npm: npm run deploy -- --dry-run)" >&2
  exit 2
}

# --- Мелкие помощники. Каждый из них один конвейер: так его код возврата виден снаружи $(...).

sha256_of() { shasum -a 256 "$1" | awk '{ print $1 }'; }
sha384_b64() { openssl dgst -sha384 -binary "$1" | openssl base64 -A; }
file_size() { wc -c < "$1" | tr -d ' '; }
count_lines() { wc -l < "$1" | tr -d ' '; }
count_assets() { find dist/assets -mindepth 1 -maxdepth 1 -type f -name "$1" | wc -l | tr -d ' '; }
asset_name() { find dist/assets -mindepth 1 -maxdepth 1 -type f -name "$1" | sed 's|^dist/assets/||'; }

# Сопоставление со всей строкой: ^ и $ в [[ =~ ]] значат начало и конец строки, а не строки
# текста, так что многострочное значение не пройдёт по одной подходящей строке.
matches_re() {
  local re=$2
  [[ $1 =~ $re ]]
}

# Все вызовы ssh идут через эту функцию: без запросов пароля и с ограничением на соединение.
on_server() { ssh -o BatchMode=yes -o ConnectTimeout=15 "$HOST" "$@"; }

# --- Шаг 1. Аргументы, константы, инструменты.

parse_args() {
  case "$#" in
    0) DRY=0 ;;
    1)
      if [ "$1" = --dry-run ]; then
        DRY=1
      else
        usage
      fi
      ;;
    *) usage ;;
  esac
  # «npm run deploy --dry-run» без «--» не передаёт скрипту аргументов и выставляет
  # npm_config_dry_run=true. Без этой проверки такой запуск выложил бы по-настоящему.
  if [ "$DRY" = 0 ] && [ "${npm_config_dry_run:-}" = true ]; then
    echo "npm забрал --dry-run себе; пробный запуск: npm run deploy -- --dry-run" >&2
    usage
  fi
}

check_constants() {
  [ "$HOST" = netcup ] || die "HOST не совпадает с литералом"
  [ "$DEST" = /var/www/verst ] || die "DEST не совпадает с литералом"
  [ "$STAGE" = /var/www/.verst-incoming ] || die "STAGE не совпадает с литералом"
  [ "$BASE" = https://lekzyrs.com/verst ] || die "BASE не совпадает с литералом"
}

require_tools() {
  local tool
  command -v brotli > /dev/null 2>&1 || die "нет brotli: без него не собрать сайдкар .br (brew install brotli)"
  for tool in npm node gzip shasum openssl curl ssh tar awk cmp; do
    command -v "$tool" > /dev/null 2>&1 || die "нет $tool"
  done
}

# --- Шаг 2. Сборка и защита: бандл и шрифт с хэшем в имени, тег и адрес шрифта указывают на них.

build_bundle() {
  npm run build
  node --check dist/verst.js
}

# Имя адресует содержимое: <префикс>-<первые 10 hex sha256>.<расширение>.
check_content_name() {
  local name=$1 prefix=$2 ext=$3 head
  matches_re "$name" "^$prefix-[0-9a-f]{10}\\.$ext\$" || die "имя $name не похоже на $prefix-<10 hex>.$ext"
  head=$(sha256_of "dist/assets/$name" | cut -c 1-10)
  [ "$name" = "$prefix-$head.$ext" ] || die "хэш в имени $name не совпадает с sha256 файла ($head…)"
}

find_build_files() {
  local entries links
  if [ ! -d dist/assets ] || [ -L dist/assets ]; then
    die "нет каталога dist/assets"
  fi
  links=$(find dist/assets -type l)
  [ -z "$links" ] || die "в dist/assets есть симлинки: $links"
  # Скрипт знает ровно два файла: бандл и шрифт. Лишний файл значит, что сборка стала
  # выпускать что-то ещё, и молча его не отправить хуже, чем остановиться.
  entries=$(find dist/assets -mindepth 1 | wc -l | tr -d ' ')
  [ "$entries" = 2 ] || die "в dist/assets ожидались два файла (бандл и шрифт), найдено $entries"
  [ "$(count_assets 'verst-*.js')" = 1 ] || die "в dist/assets нет ровно одного verst-*.js"
  [ "$(count_assets 'sofia-sans-*.woff2')" = 1 ] || die "в dist/assets нет ровно одного sofia-sans-*.woff2"
  JS_NAME=$(asset_name 'verst-*.js')
  FONT_NAME=$(asset_name 'sofia-sans-*.woff2')
  check_content_name "$JS_NAME" verst js
  check_content_name "$FONT_NAME" sofia-sans woff2
  # Бандл равен dist/verst.js, который проверил node --check; шрифт равен исходнику из репозитория.
  cmp -s dist/verst.js "dist/assets/$JS_NAME" || die "dist/assets/$JS_NAME отличается от dist/verst.js"
  cmp -s assets/fonts/SofiaSans-VF.woff2 "dist/assets/$FONT_NAME" \
    || die "dist/assets/$FONT_NAME отличается от assets/fonts/SofiaSans-VF.woff2"
  JS="assets/$JS_NAME"
  BR="$JS.br"
  GZ="$JS.gz"
  FONT="assets/$FONT_NAME"
}

check_tag() {
  local tag_re tag src want
  [ "$(count_lines dist/tag.txt)" = 1 ] || die "в dist/tag.txt ожидалась одна строка"
  tag=$(cat dist/tag.txt)
  tag_re='^<script src="https://[^"]+" integrity="sha384-[A-Za-z0-9+/]{64}" crossorigin="anonymous" defer></script>$'
  matches_re "$tag" "$tag_re" || die "dist/tag.txt не похож на ожидаемый тег: $tag"
  src=$(printf '%s\n' "$tag" | sed -E 's/^<script src="([^"]+)".*$/\1/')
  TAG_INTEGRITY=$(printf '%s\n' "$tag" | sed -E 's/^.* integrity="([^"]+)".*$/\1/')
  [ "$src" = "$BASE/assets/$JS_NAME" ] || die "src в теге ($src) не указывает на $BASE/assets/$JS_NAME"
  want="sha384-$(sha384_b64 "dist/$JS")"
  [ "$TAG_INTEGRITY" = "$want" ] || die "integrity в теге ($TAG_INTEGRITY) не равен sha384 файла ($want)"
}

check_font_txt() {
  [ -f dist/font.txt ] || die "нет dist/font.txt"
  [ "$(count_lines dist/font.txt)" = 1 ] || die "в dist/font.txt ожидалась одна строка"
  FONT_URL=$(cat dist/font.txt)
  [ "$FONT_URL" = "$BASE/assets/$FONT_NAME" ] || die "dist/font.txt ($FONT_URL) не указывает на $BASE/assets/$FONT_NAME"
}

# --- Шаг 3. Сайдкары только для бандла: woff2 уже сжат. gzip -n убирает имя и время, байты повторяемы.

make_sidecars() {
  brotli -q 11 -k -f "dist/$JS"
  gzip -9 -n -k -f "dist/$JS"
}

# Сайдкар распаковывается ровно в бандл: иначе браузер получил бы чужие байты под тем же URL.
check_sidecars() {
  local want br gz
  want=$(sha256_of "dist/$JS")
  br=$(brotli -dc "dist/$BR" | shasum -a 256 | awk '{ print $1 }') || die "dist/$BR не распаковывается"
  gz=$(gzip -dc "dist/$GZ" | shasum -a 256 | awk '{ print $1 }') || die "dist/$GZ не распаковывается"
  [ "$br" = "$want" ] || die "dist/$BR не распаковывается в dist/$JS"
  [ "$gz" = "$want" ] || die "dist/$GZ не распаковывается в dist/$JS"
}

check_send_candidates() {
  local p
  for p in "$BR" "$GZ" "$FONT" "$JS"; do
    matches_re "$p" '^assets/[A-Za-z0-9._-]+$' || die "путь $p не проходит проверку"
    case "$p" in
      assets/. | assets/..) die "путь $p не проходит проверку" ;;
    esac
    if [ ! -f "dist/$p" ] || [ -L "dist/$p" ]; then
      die "dist/$p не обычный файл"
    fi
  done
}

# --- Шаг 4. Манифесты: локальный по четырём файлам и удалённый (только чтение).

make_local_manifest() {
  local p hash
  : > "$tmp/local.sha256"
  for p in "$BR" "$GZ" "$FONT" "$JS"; do
    hash=$(sha256_of "dist/$p")
    printf '%s  %s\n' "$hash" "$p" >> "$tmp/local.sha256"
  done
}

fetch_remote_manifest() {
  local rc=0 bad
  on_server "sudo -n sh -c 'test -d $DEST || exit 3; cd $DEST && find . -type f -print0 | sort -z | xargs -0 -r sha256sum'" \
    > "$tmp/remote.sha256" || rc=$?
  if [ "$rc" = 3 ]; then
    die "на сервере нет $DEST: нужна разовая настройка сервера (docs/deploy-notes.md, «Применение»)"
  fi
  [ "$rc" = 0 ] || die "не удалось снять манифест с сервера (код $rc)"
  # Строка манифеста: "<sha256>  ./<путь>", без обратных слешей и управляющих символов.
  bad=$(grep -Evc '^[0-9a-f]{64}  \./[^\\[:cntrl:]]+$' "$tmp/remote.sha256" || true)
  [ "$bad" = 0 ] || die "в манифесте сервера строк неверного вида: $bad"
}

remote_hash_of() {
  awk -v want="./$1" 'substr($0, 67) == want { print substr($0, 1, 64) }' "$tmp/remote.sha256"
}

count_other_remote_files() {
  awk -v a="./$JS" -v b="./$BR" -v c="./$GZ" -v d="./$FONT" \
    '{ p = substr($0, 67) } p != a && p != b && p != c && p != d { n++ } END { print n + 0 }' "$tmp/remote.sha256"
}

add_to_send() {
  printf '%s\n' "$2" >> "$tmp/send"
  printf '%s  %s\n' "$1" "$2" >> "$tmp/send.sha256"
}

# Отправляется то, чего на сервере нет или что отличается. Бандл или шрифт с тем же именем и
# другим содержимым — ошибка: имя адресует содержимое, его нельзя перезаписать. Сайдкар можно.
plan_transfer() {
  local hash path remote
  : > "$tmp/send"
  : > "$tmp/send.sha256"
  : > "$tmp/present"
  while read -r hash path; do
    remote=$(remote_hash_of "$path")
    if [ -z "$remote" ]; then
      add_to_send "$hash" "$path"
    elif [ "$remote" = "$hash" ]; then
      printf '%s\n' "$path" >> "$tmp/present"
    elif [ "$path" = "$JS" ] || [ "$path" = "$FONT" ]; then
      die "на сервере уже лежит $path с другим содержимым (sha256 $remote, локально $hash). Файл с хэшем в имени не перезаписывается: разберитесь вручную"
    else
      echo "сайдкар $path на сервере отличается (sha256 $remote), будет отправлен заново"
      add_to_send "$hash" "$path"
    fi
  done < "$tmp/local.sha256"
}

# --- Шаг 5. План: что уйдёт, что уже есть, удалений нет.

print_plan() {
  local p size bytes=0
  echo "--- к отправке в $DEST/assets/: $(count_lines "$tmp/send")"
  while read -r p; do
    size=$(file_size "dist/$p")
    bytes=$((bytes + size))
    printf '  %-34s %9s байт\n' "$p" "$size"
  done < "$tmp/send"
  echo "  всего $bytes байт"
  echo "--- уже на сервере, не отправляются: $(count_lines "$tmp/present")"
  while read -r p; do
    printf '  %s\n' "$p"
  done < "$tmp/present"
  echo "--- удалений нет: под $DEST скрипт ничего не удаляет (прочих файлов на сервере: $(count_other_remote_files))"
  echo "URL бандла: $BASE/assets/$JS_NAME"
}

print_links() {
  echo "шрифт для @font-face (dist/font.txt):"
  cat dist/font.txt
  echo "тег для Tilda (dist/tag.txt):"
  cat dist/tag.txt
}

# --- Шаг 6. Выкладка: остаток STAGE, проверка симлинков, промежуточный каталог, атомарный mv.

remove_leftover_stage() {
  # Удаление только по литералу пути: эта команда не может задеть другой каталог.
  on_server "sudo -n rm -rf -- /var/www/.verst-incoming" || die "не удалось убрать старый $STAGE"
}

refuse_remote_symlinks() {
  local links
  links=$(on_server "sudo -n find $DEST -type l") || die "не удалось проверить симлинки под $DEST"
  [ -z "$links" ] || die "под $DEST есть симлинки, выкладка отменена: $links"
}

upload_to_stage() {
  (cd dist && COPYFILE_DISABLE=1 tar --format ustar --no-xattrs --no-mac-metadata -cf - -T "$tmp/send") \
    | on_server "sudo -n sh -c 'install -d -m 700 $STAGE && tar -xf - --no-same-owner --no-same-permissions -C $STAGE'" \
    || die "передача в $STAGE не удалась; каталог удалится при следующем настоящем запуске"
}

# Одним sudo sh -c: сверка sha256 сразу после cd в STAGE, затем владелец и режимы, mv в
# DEST/assets (шрифт и сайдкары сначала, бандл последним) и удаление STAGE по литералу.
# На stdin идёт манифест отправленных файлов: ничего не тронется, если байты не совпали.
publish_from_stage() {
  local files="" before_js="" js="" p cmd
  while read -r p; do
    if [ -z "$files" ]; then
      files=$p
    else
      files="$files $p"
    fi
    if [ "$p" = "$JS" ]; then
      js=$p
    else
      before_js="$before_js $p"
    fi
  done < "$tmp/send"
  cmd="cd $STAGE"
  cmd="$cmd && sha256sum -c --strict --quiet -"
  cmd="$cmd && chown root:root $files"
  cmd="$cmd && chmod 644 $files"
  cmd="$cmd && install -d -o root -g root -m 755 $DEST/assets"
  for p in $before_js; do
    cmd="$cmd && mv -f $p $DEST/assets/"
  done
  if [ -n "$js" ]; then
    cmd="$cmd && mv -f $js $DEST/assets/"
  fi
  cmd="$cmd && cd / && rm -rf -- /var/www/.verst-incoming"
  echo "+ ssh $HOST \"sudo -n sh -c '$cmd'\""
  on_server "sudo -n sh -c '$cmd'" < "$tmp/send.sha256" \
    || die "перенос из $STAGE в $DEST/assets не завершён; проверьте сервер, STAGE удалится при следующем настоящем запуске"
}

# --- Шаг 7. Проверки после выкладки. Любой сбой даёт код 1, автоотката нет.

check_equal() {
  if [ "$2" = "$3" ]; then
    echo "  ok    $1: $2"
  else
    echo "  FAIL  $1: получено '$2', ожидалось '$3'"
    CHECKS_FAILED=1
  fi
}

fetch_headers() {
  local out="$1"
  shift
  if ! curl -sS --max-time 30 -o /dev/null -D "$out.raw" "$@"; then
    echo "  FAIL  нет ответа: curl $*"
    CHECKS_FAILED=1
  fi
  touch "$out.raw"
  tr -d '\r' < "$out.raw" > "$out"
}

fetch_body() {
  local out="$1"
  shift
  if ! curl -sS -f --max-time 60 -o "$out" "$@"; then
    echo "  FAIL  тело не получено: curl $*"
    CHECKS_FAILED=1
    : > "$out"
  fi
}

# sha256 распакованного тела; если распаковать нельзя, вместо хэша печатается причина.
decoded_sha256() {
  local tool=$1 body=$2
  if "$tool" -dc "$body" > "$body.decoded" 2> /dev/null; then
    sha256_of "$body.decoded"
  else
    echo "не распаковывается $tool"
  fi
}

status_of() { awk 'NR == 1 { print $2 }' "$1"; }

header_of() {
  awk -v want="$1" '
    { i = index($0, ":") }
    i > 0 && tolower(substr($0, 1, i - 1)) == want {
      v = substr($0, i + 1)
      sub(/^[ \t]+/, "", v)
      print v
      exit
    }' "$2"
}

check_bundle_url() {
  local url="$BASE/assets/$JS_NAME" want
  want=$(sha256_of "dist/$JS")
  echo "--- проверки бандла: $url"

  # 7а. Ответ на br,gzip с Origin страницы Tilda: статус и заголовки.
  fetch_headers "$tmp/h.br" -H 'Accept-Encoding: br,gzip' -H 'Origin: https://verst-07.tilda.ws' "$url"
  check_equal "статус" "$(status_of "$tmp/h.br")" 200
  check_equal "content-type" "$(header_of content-type "$tmp/h.br")" "text/javascript; charset=utf-8"
  check_equal "content-encoding (br,gzip)" "$(header_of content-encoding "$tmp/h.br")" br
  check_equal "cache-control" "$(header_of cache-control "$tmp/h.br")" "public, max-age=31536000, immutable"
  check_equal "access-control-allow-origin" "$(header_of access-control-allow-origin "$tmp/h.br")" "*"
  check_equal "x-content-type-options" "$(header_of x-content-type-options "$tmp/h.br")" nosniff

  # 7б. Клиент без br получает gzip.
  fetch_headers "$tmp/h.gz" -H 'Accept-Encoding: gzip' "$url"
  check_equal "content-encoding (gzip)" "$(header_of content-encoding "$tmp/h.gz")" gzip

  # 7в. Тело без сжатия: sha384 равен integrity из тега.
  fetch_body "$tmp/body.identity" -H 'Accept-Encoding: identity' "$url"
  check_equal "integrity тела" "sha384-$(sha384_b64 "$tmp/body.identity")" "$TAG_INTEGRITY"

  # 7г. Тела br и gzip после распаковки совпадают с локальным файлом (локальный curl без brotli).
  fetch_body "$tmp/body.br" -H 'Accept-Encoding: br' "$url"
  check_equal "sha256 тела br" "$(decoded_sha256 brotli "$tmp/body.br")" "$want"
  fetch_body "$tmp/body.gz" -H 'Accept-Encoding: gzip' "$url"
  check_equal "sha256 тела gzip" "$(decoded_sha256 gzip "$tmp/body.gz")" "$want"
}

check_font_url() {
  echo "--- проверки шрифта: $FONT_URL"
  # 7д. Шрифт: запрос как из браузера на странице Tilda, тело без сжатия равно файлу.
  fetch_headers "$tmp/h.font" -H 'Accept-Encoding: br,gzip' -H 'Origin: https://verst-07.tilda.ws' "$FONT_URL"
  check_equal "статус" "$(status_of "$tmp/h.font")" 200
  check_equal "content-type" "$(header_of content-type "$tmp/h.font")" font/woff2
  check_equal "cache-control" "$(header_of cache-control "$tmp/h.font")" "public, max-age=31536000, immutable"
  check_equal "access-control-allow-origin" "$(header_of access-control-allow-origin "$tmp/h.font")" "*"
  fetch_body "$tmp/body.font" -H 'Accept-Encoding: identity' "$FONT_URL"
  check_equal "sha256 тела" "$(sha256_of "$tmp/body.font")" "$(sha256_of "dist/$FONT")"
}

post_deploy_checks() {
  local code
  CHECKS_FAILED=0
  check_bundle_url
  check_font_url

  # 7е. Портфолио на месте.
  code=$(curl -s -o /dev/null --max-time 30 -w '%{http_code}' https://lekzyrs.com/ || true)
  check_equal "https://lekzyrs.com/" "$code" 200

  if [ "$CHECKS_FAILED" != 0 ]; then
    echo "ABORT: проверки после выкладки не прошли. Автоотката нет: файлы остались в $DEST/assets" >&2
    exit 1
  fi
}

deploy_for_real() {
  remove_leftover_stage
  if [ -s "$tmp/send" ]; then
    refuse_remote_symlinks
    upload_to_stage
    publish_from_stage
  else
    echo "отправлять нечего: все файлы уже на сервере"
  fi
  post_deploy_checks
  echo "выложено"
  print_links
}

main() {
  parse_args "$@"
  check_constants
  require_tools
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT

  build_bundle
  find_build_files
  check_tag
  check_font_txt
  make_sidecars
  check_sidecars
  check_send_candidates
  make_local_manifest
  fetch_remote_manifest
  plan_transfer
  print_plan

  if [ "$DRY" = 1 ]; then
    echo "пробный запуск: на сервере ничего не записано, проверки после выкладки пропущены"
    print_links
    exit 0
  fi
  deploy_for_real
}

main "$@"
