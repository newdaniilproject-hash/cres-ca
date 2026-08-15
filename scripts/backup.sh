#!/usr/bin/env bash
# Резервная копия базы и файлов. Шаг 1 плана.
#
# ── Почему это здесь, а не внутри Supabase ────────────────────────────────
#
# Копии, которые делает хостинг, лежат в том же аккаунте, что и база.
# Потерян доступ к аккаунту, проект удалён по ошибке, аккаунт заблокирован —
# и копии исчезают вместе с оригиналом. Правило, которое это закрывает,
# известно как 3-2-1: три копии данных, два разных носителя, одна копия
# вне основной инфраструктуры. Здесь реализована именно она.
#
# Собственные копии Supabase Pro при этом ЕСТЬ и проверены: ежесуточные,
# глубина семь дней, физические. Они спасают от «уронил таблицу» и
# «неудачная миграция». Они НЕ спасают от потери доступа к аккаунту —
# и они, по прямому предупреждению самого Supabase, НЕ СОДЕРЖАТ ФАЙЛОВ
# хранилища. MSDS, сертификаты и заключения СЭС в них не входят, а без
# них восстановленный реестр ничего не доказывает на проверке.
#
# Почему GitHub Actions, а не pg_cron и не Vercel:
#   • pg_cron живёт ВНУТРИ той самой базы и не может вызвать pg_dump;
#   • у Vercel нет ни бинаря pg_dump, ни времени выполнения — там потолок
#     минута, а полный дамп идёт дольше;
#   • Actions бесплатны, pg_dump там уже есть, секреты хранит сам GitHub.
#
# ── Шифрование. Открытый ключ ЛЕЖИТ В РЕПОЗИТОРИИ, и это не оплошность ───
#
# Ключ `age` несимметричный. Открытой половиной можно только зашифровать;
# прочитать ею нельзя. Поэтому она не секрет по своей природе и хранится
# файлом `backup-recipient.age.pub` рядом с кодом.
#
# Это сделано СОЗНАТЕЛЬНО, ради одной цели: чтобы копии начали сниматься,
# а не ждали, пока владелец заведёт девять секретов. Секрет, который никто
# не завёл, — это отсутствующая копия, и разницы с «мы не написали код»
# для данных нет никакой.
#
# Закрытая половина не существует нигде в этом репозитории и не проходит
# ни через чьи руки: её выдаёт разовый запуск `backup-keygen.yml` файлом
# сборки, владелец забирает и кладёт в менеджер паролей.
#
# ── Куда кладём ───────────────────────────────────────────────────────────
#
# Основное место — Cloudflare R2: другой поставщик, другой аккаунт.
# Пока ключи R2 не заведены, архив остаётся ФАЙЛОМ СБОРКИ GitHub. Это
# осознанная временная мера, и она названа временной вслух в отчёте
# каждого запуска: файлы сборки живут ограниченный срок и считаются
# в квоту. Но зашифрованная копия вне Supabase, которая есть сегодня,
# лучше безупречной схемы, которая заработает неизвестно когда.
#
# ── Глубина хранения (в R2) ───────────────────────────────────────────────
#
# daily/   — каждый запуск, хранится 30 дней
# weekly/  — понедельник, хранится 3 месяца
# monthly/ — первое число, хранится 12 месяцев
#
# Класс выбирается В МОМЕНТ СОЗДАНИЯ, а не пересчитывается потом: иначе
# при пропущенном запуске недельная копия не появится вовсе, и пропажу
# заметят через три месяца.

set -euo pipefail

# ── Обязательное ──────────────────────────────────────────────────────────
: "${SUPABASE_DB_URL:?нет SUPABASE_DB_URL — строка подключения к базе}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RECIPIENT_FILE="${BACKUP_RECIPIENT_FILE:-$REPO_ROOT/backup-recipient.age.pub}"

# Получатель шифрования: переменная окружения перебивает файл. Файл —
# основной путь, переменная оставлена для чужой среды и для проверки.
AGE_ARGS=()
if [ -n "${BACKUP_AGE_PUBLIC_KEY:-}" ]; then
  AGE_ARGS=(--recipient "$BACKUP_AGE_PUBLIC_KEY")
elif [ -s "$RECIPIENT_FILE" ] && grep -q '^age1' "$RECIPIENT_FILE"; then
  AGE_ARGS=(--recipients-file "$RECIPIENT_FILE")
else
  echo "!! нет получателя шифрования." >&2
  echo "   Ожидался файл $RECIPIENT_FILE со строкой age1…" >&2
  echo "   Его создаёт разовый запуск задания «Ключ шифрування копій»." >&2
  echo "   Шифровать нечем — копию не снимаю: незашифрованный дамп с" >&2
  echo "   персональными данными в хранилище класть нельзя." >&2
  exit 1
fi

# ── Место назначения ──────────────────────────────────────────────────────
R2_BUCKET="${R2_BUCKET:-cresca-backups}"
SUPABASE_S3_ENDPOINT="${SUPABASE_S3_ENDPOINT:-https://jobvstdwoyifspaiwazn.storage.supabase.co/storage/v1/s3}"
SUPABASE_S3_REGION="${SUPABASE_S3_REGION:-eu-west-1}"

if [ -n "${R2_ACCOUNT_ID:-}" ] && [ -n "${R2_ACCESS_KEY_ID:-}" ] && [ -n "${R2_SECRET_ACCESS_KEY:-}" ]; then
  DEST=r2
else
  DEST=artifact
fi

OUT_DIR="${BACKUP_OUT_DIR:-$REPO_ROOT/backup-out}"

MODE="${1:-full}"            # full | hot
STAMP="$(date -u +%Y%m%d-%H%M)"
DAY_OF_WEEK="$(date -u +%u)" # 1 = понедельник
DAY_OF_MONTH="$(date -u +%d)"

# Класс хранения — по календарю, и только для полного дампа. Ежедневный
# срез горячих таблиц недельным и месячным быть не может: он неполный.
if [ "$MODE" = "full" ] && [ "$DAY_OF_MONTH" = "01" ]; then
  CLASS="monthly"
elif [ "$MODE" = "full" ] && [ "$DAY_OF_WEEK" = "1" ]; then
  CLASS="weekly"
else
  CLASS="daily"
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "▸ режим: $MODE, класс: $CLASS, метка: $STAMP, місце: $DEST"

# ── Дамп ──────────────────────────────────────────────────────────────────
#
# Горячий срез — это таблицы, которые меняются каждый день и стоят дороже
# всего: журнал движений, санитарные журналы, заказы и записи. Их потеря
# невосполнима, а полный дамп идёт раз в двое суток — за это время можно
# потерять два дня работы салона.
#
# Схема `auth` в дамп НЕ ВКЛЮЧАЕТСЯ: она принадлежит Supabase, при
# восстановлении конфликтует со свежесозданной и ломает вход. Пользователи
# восстанавливаются средствами самого Supabase.
HOT_TABLES=(
  public.stock_movements
  public.stock_receipts public.stock_receipt_lines
  public.stock_counts public.stock_count_lines
  public.material_containers public.material_batches
  public.cleaning_entries public.sterilization_cycles public.sanitation_solutions
  public.orders public.order_items
  public.bookings
  public.finance_records
  public.audit_log
  public.notification_outbox
)

DUMP="$WORK/dump.sql"

if [ "$MODE" = "full" ]; then
  pg_dump "$SUPABASE_DB_URL" \
    --schema=public --schema=storage \
    --no-owner --no-privileges \
    --format=plain --file="$DUMP"
else
  ARGS=()
  for t in "${HOT_TABLES[@]}"; do ARGS+=(--table="$t"); done
  pg_dump "$SUPABASE_DB_URL" \
    "${ARGS[@]}" --data-only \
    --no-owner --no-privileges \
    --format=plain --file="$DUMP"
fi

RAW_BYTES=$(stat -c%s "$DUMP")
echo "▸ дамп готов: $RAW_BYTES байт"

# Пустой дамп — это отказ, а не «мало данных». Файл в сто байт спокойно
# уедет в хранилище, вытеснит собой прошлую копию по сроку хранения,
# и обнаружится это в день, когда копия понадобится.
if [ "$RAW_BYTES" -lt 4096 ]; then
  echo "!! дамп подозрительно мал ($RAW_BYTES байт) — прерываю" >&2
  exit 1
fi

# ── Проверка целостности до отправки ──────────────────────────────────────
# Дешёвая, но ловит главное: обрыв соединения посреди выгрузки. pg_dump
# в этом случае завершается с ошибкой не всегда, а хвостовая строка
# в корректном дампе есть всегда.
if ! tail -c 4096 "$DUMP" | grep -q "PostgreSQL database dump complete"; then
  echo "!! дамп оборван: нет завершающей строки" >&2
  exit 1
fi

# ── Контрольная сумма в имени ─────────────────────────────────────────────
# Имя обязано содержать дату и контрольную сумму: по ней видно, что архив
# доехал целым, не скачивая его целиком.
SHA="$(sha256sum "$DUMP" | cut -c1-16)"
NAME="${MODE}-${STAMP}-${SHA}.sql.age"

# ── Шифрование ────────────────────────────────────────────────────────────
age --encrypt "${AGE_ARGS[@]}" --output "$WORK/$NAME" "$DUMP"
ENC_BYTES=$(stat -c%s "$WORK/$NAME")
echo "▸ зашифровано: $ENC_BYTES байт"

# Шифрование обязано БЫТЬ ПРОВЕРЕНО, а не предположено. Заголовок файла
# age начинается с известной строки; если её нет — на диске лежит что
# угодно, только не шифртекст, и отправлять это наружу нельзя.
if ! head -c 32 "$WORK/$NAME" | grep -q 'age-encryption.org'; then
  echo "!! на выходе не шифртекст age — прерываю" >&2
  exit 1
fi

# ── Отправка ──────────────────────────────────────────────────────────────

if [ "$DEST" = "r2" ]; then
  export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
  export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
  export AWS_DEFAULT_REGION=auto
  R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

  KEY="${CLASS}/${NAME}"
  aws s3 cp "$WORK/$NAME" "s3://${R2_BUCKET}/${KEY}" \
    --endpoint-url "$R2_ENDPOINT" --only-show-errors
  echo "▸ R2: ${KEY}"

  # Проверяем, что объект ДЕЙСТВИТЕЛЬНО лежит и нужного размера. `aws s3 cp`
  # возвращает ноль и в случаях, когда запись прошла частично.
  REMOTE_BYTES=$(aws s3api head-object \
    --bucket "$R2_BUCKET" --key "$KEY" \
    --endpoint-url "$R2_ENDPOINT" --query ContentLength --output text)
  if [ "$REMOTE_BYTES" != "$ENC_BYTES" ]; then
    echo "!! R2: размер не сошёлся ($REMOTE_BYTES против $ENC_BYTES)" >&2
    exit 1
  fi

  # ── Уборка старого ──────────────────────────────────────────────────────
  prune() {
    local class="$1" days="$2"
    local cutoff
    cutoff="$(date -u -d "-${days} days" +%Y%m%d)"

    aws s3api list-objects-v2 --bucket "$R2_BUCKET" --prefix "${class}/" \
      --endpoint-url "$R2_ENDPOINT" --query 'Contents[].Key' --output text 2>/dev/null \
    | tr '\t' '\n' | grep -v '^None$' | while read -r key; do
        [ -n "$key" ] || continue
        # Дата берётся ИЗ ИМЕНИ, а не из времени изменения объекта:
        # перезалив архива обновил бы дату и продлил ему жизнь навсегда.
        local d
        d="$(printf '%s' "$key" | sed -n 's/.*-\([0-9]\{8\}\)-[0-9]\{4\}-.*/\1/p')"
        [ -n "$d" ] || continue
        if [ "$d" -lt "$cutoff" ]; then
          aws s3 rm "s3://${R2_BUCKET}/${key}" --endpoint-url "$R2_ENDPOINT" --only-show-errors
          echo "  удалено: $key"
        fi
      done
  }

  echo "▸ уборка старого"
  prune daily 30
  prune weekly 92
  prune monthly 366
else
  mkdir -p "$OUT_DIR"
  cp "$WORK/$NAME" "$OUT_DIR/$NAME"
  echo "▸ архив оставлен файлом сборки: $OUT_DIR/$NAME"
  echo "!! ВРЕМЕННОЕ МЕСТО. Ключей R2 нет, поэтому копия живёт как файл" >&2
  echo "   сборки GitHub: ограниченный срок хранения и общая квота." >&2
  echo "   Как только появятся R2_ACCOUNT_ID, R2_ACCESS_KEY_ID и" >&2
  echo "   R2_SECRET_ACCESS_KEY, этот же скрипт начнёт класть в R2 сам," >&2
  echo "   без единой правки." >&2
fi

# ── Файлы обоих бакетов ───────────────────────────────────────────────────
#
# База без файлов бесполезна ровно там, где дороже всего: MSDS, сертификаты
# и заключения СЭС — это доказательства для проверки, и восстановленный
# реестр без них ничего не доказывает. Собственные копии Supabase файлов
# НЕ СОДЕРЖАТ вовсе — это их прямое предупреждение, а не наша догадка.
#
# Синхронизацией, а не архивом: файлы почти не меняются, и гнать их целиком
# каждые двое суток — это лишний трафик и лишние деньги. Удаления НЕ
# переносим (`--ignore-existing` вместо зеркала) намеренно: копия должна
# пережить ошибочное удаление файла в продукте, а зеркало повторило бы его.
#
# ── Почему отсутствие ключей хранилища больше НЕ роняет копию ─────────────
#
# Прежняя редакция здесь падала с ошибкой. Расчёт был верный по существу —
# реестр без документов не доказательство — и вредный по последствиям:
# пока ключей хранилища нет, не создавалось НИ ОДНОЙ копии базы. Отказ от
# неполной копии оставлял ноль копий, а не полную.
#
# Теперь копия базы доводится до конца, а отсутствие файлов объявляется
# громко и попадает в отчёт запуска отдельной строкой «НЕПОВНА КОПІЯ».
if [ "$MODE" = "full" ]; then
  if [ -z "${SUPABASE_S3_ACCESS_KEY_ID:-}" ] || [ -z "${SUPABASE_S3_SECRET_ACCESS_KEY:-}" ]; then
    echo "::warning::НЕПОВНА КОПІЯ: файли сховища не вивантажені — немає ключів S3 Supabase"
    echo "!! файлы бакетов НЕ выгружены: нет ключей хранилища Supabase." >&2
    echo "   Копия базы снята и цела, но MSDS, сертификаты и заключения" >&2
    echo "   СЭС в неё не входят, и в копиях самого Supabase их тоже нет." >&2
  elif [ "$DEST" != "r2" ]; then
    echo "::warning::НЕПОВНА КОПІЯ: файли сховища не вивантажені — немає куди, ключів R2 немає"
    echo "!! файлы бакетов НЕ выгружены: без R2 их некуда положить." >&2
  else
    export RCLONE_CONFIG_SB_TYPE=s3
    export RCLONE_CONFIG_SB_PROVIDER=Other
    export RCLONE_CONFIG_SB_ACCESS_KEY_ID="$SUPABASE_S3_ACCESS_KEY_ID"
    export RCLONE_CONFIG_SB_SECRET_ACCESS_KEY="$SUPABASE_S3_SECRET_ACCESS_KEY"
    export RCLONE_CONFIG_SB_ENDPOINT="$SUPABASE_S3_ENDPOINT"
    export RCLONE_CONFIG_SB_REGION="$SUPABASE_S3_REGION"

    export RCLONE_CONFIG_R2_TYPE=s3
    export RCLONE_CONFIG_R2_PROVIDER=Cloudflare
    export RCLONE_CONFIG_R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
    export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
    export RCLONE_CONFIG_R2_ENDPOINT="$R2_ENDPOINT"
    export RCLONE_CONFIG_R2_REGION=auto

    for bucket in documents media; do
      echo "▸ файлы: $bucket"
      rclone copy "sb:${bucket}" "r2:${R2_BUCKET}/files/${bucket}" \
        --ignore-existing --transfers 8 --quiet
    done
  fi
fi

echo "✔ готово: $NAME ($CLASS, $DEST)"
