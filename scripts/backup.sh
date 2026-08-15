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
# Почему GitHub Actions, а не pg_cron и не Vercel:
#   • pg_cron живёт ВНУТРИ той самой базы и не может вызвать pg_dump;
#   • у Vercel нет ни бинаря pg_dump, ни времени выполнения — там потолок
#     минута, а полный дамп идёт дольше;
#   • Actions бесплатны, pg_dump там уже есть, секреты хранит сам GitHub.
#
# ── Шифрование ────────────────────────────────────────────────────────────
#
# Архив шифруется ДО отправки, ключом `age`, и это НЕСИММЕТРИЧНЫЙ ключ.
# В секретах сборки лежит только ОТКРЫТАЯ половина: её достаточно, чтобы
# зашифровать, и недостаточно, чтобы прочитать. Если завтра утекут секреты
# GitHub — злоумышленник сможет положить новую копию и не сможет прочитать
# ни одной старой. Закрытая половина есть только у владельца и у месячной
# проверки восстановлением.
#
# ── Куда кладём ───────────────────────────────────────────────────────────
#
# В Cloudflare R2 — у поставщика, отличного от того, где живёт база.
# Вторая копия — собственные ежесуточные копии Supabase Pro; разбор
# этого размена ниже, у отправки. Два ведра в одном облаке за две копии
# не считаются: аккаунт блокируют целиком.
#
# ── Глубина хранения ──────────────────────────────────────────────────────
#
# daily/   — каждый запуск, хранится 30 дней
# weekly/  — понедельник, хранится 3 месяца
# monthly/ — первое число, хранится 12 месяцев
#
# Класс выбирается В МОМЕНТ СОЗДАНИЯ, а не пересчитывается потом: иначе
# при пропущенном запуске недельная копия не появится вовсе, и пропажу
# заметят через три месяца.

set -euo pipefail

# ── Обязательное окружение ────────────────────────────────────────────────
: "${SUPABASE_DB_URL:?нет SUPABASE_DB_URL — строка подключения к базе}"
: "${BACKUP_AGE_PUBLIC_KEY:?нет BACKUP_AGE_PUBLIC_KEY — открытый ключ шифрования}"
: "${R2_ACCOUNT_ID:?нет R2_ACCOUNT_ID}"
: "${R2_ACCESS_KEY_ID:?нет R2_ACCESS_KEY_ID}"
: "${R2_SECRET_ACCESS_KEY:?нет R2_SECRET_ACCESS_KEY}"
# Не секреты — значения по умолчанию прямо здесь, чтобы владельцу не
# приходилось заводить лишние строки в настройках. Переменной окружения
# по-прежнему перебиваются.
R2_BUCKET="${R2_BUCKET:-cresca-backups}"
SUPABASE_S3_ENDPOINT="${SUPABASE_S3_ENDPOINT:-https://jobvstdwoyifspaiwazn.storage.supabase.co/storage/v1/s3}"
SUPABASE_S3_REGION="${SUPABASE_S3_REGION:-eu-west-1}"

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

echo "▸ режим: $MODE, класс: $CLASS, метка: $STAMP"

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
age --encrypt --recipient "$BACKUP_AGE_PUBLIC_KEY" \
    --output "$WORK/$NAME" "$DUMP"
ENC_BYTES=$(stat -c%s "$WORK/$NAME")
echo "▸ зашифровано: $ENC_BYTES байт"

# ── Отправка: место первое, Cloudflare R2 ─────────────────────────────────
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

# ── Вторая копия ──────────────────────────────────────────────────────────
#
# Правило 3-2-1 требует, чтобы копия жила не только там же, где оригинал.
# Здесь оно выполняется так:
#
#   1. Собственные копии Supabase Pro — ежесуточные, внутри их инфраструктуры.
#      Они спасают от «уронил таблицу», «неудачная миграция», «сломал данные».
#   2. Этот архив в Cloudflare R2 — у ДРУГОГО поставщика, зашифрованный,
#      с ключом, которого нет ни у Supabase, ни у GitHub. Он спасает от того,
#      от чего копии Supabase не спасают в принципе: потеря доступа к аккаунту,
#      ошибочное удаление проекта, блокировка.
#
# Третьего адреса намеренно нет. Владелец отказался от Google Drive
# 15.08.2026, и это осознанный размен: меньше мест — меньше ключей,
# которые надо хранить и отзывать. Условие «одна копия вне основной
# инфраструктуры» выполнено, условие «три копии» — нет. Если однажды
# захочется третью, дописывается здесь, ниже отправки в R2.

# ── Уборка старого ────────────────────────────────────────────────────────
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

# ── Файлы обоих бакетов ───────────────────────────────────────────────────
#
# База без файлов бесполезна ровно там, где дороже всего: MSDS, сертификаты
# и заключения СЭС — это доказательства для проверки, и восстановленный
# реестр без них ничего не доказывает.
#
# Синхронизацией, а не архивом: файлы почти не меняются, и гнать их целиком
# каждые двое суток — это лишний трафик и лишние деньги. Удаления НЕ
# переносим (`--ignore-existing` вместо зеркала) намеренно: копия должна
# пережить ошибочное удаление файла в продукте, а зеркало повторило бы его.
#
# Сами файлы не шифруем повторно: приватный бакет попадает в R2, который
# доступен только по ключу, а публичный бакет и так раздаётся CDN всем.
if [ "$MODE" = "full" ]; then
  if [ -z "${SUPABASE_S3_ACCESS_KEY_ID:-}" ] || [ -z "${SUPABASE_S3_SECRET_ACCESS_KEY:-}" ]; then
    echo "!! нет ключей хранилища Supabase — файлы бакетов не выгружены" >&2
    echo "   Реестр без MSDS и сертификатов не является доказательством." >&2
    exit 1
  fi

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

echo "✔ готово: $NAME ($CLASS)"
