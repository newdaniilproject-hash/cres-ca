import type { Key } from '@/lib/i18n/dict'
import type { T } from '@/lib/i18n/translate'
import { maskText } from '@/lib/redact'

// ── Ответ базы человеку. Один переводчик на весь кабинет ────────────────────
//
// ЗАЧЕМ. До этого файла 47 мест в кабинете показывали человеку `error.message`
// от Postgres как есть. Postgres при нарушении уникальности печатает ЗНАЧЕНИЕ:
//
//   duplicate key value violates unique constraint "customers_tenant_phone_uidx"
//   DETAIL: Key (tenant_id, phone)=(…, +380671234567) already exists.
//
// То есть телефон клиента уходил на экран, а оттуда — в любой сборщик ошибок,
// который появится. Внутрь базы такой текст уже не попадает (0089 обезличивает
// `security_events.detail` и `notification_outbox.last_error`), а наружу
// уходил целиком. Это и есть причина, по которой сборщик ошибок нельзя было
// подключать: он превратил бы нашу неаккуратность в передачу персональных
// данных третьему лицу.
//
// ── ПРАВИЛО РАЗБОРА. Три ветки, и они не пересекаются ───────────────────────
//
//   1. `P0001` — это `raise exception` из НАШЕЙ функции. Текст писали мы,
//      по-украински, для человека: «недостатньо прав: orders.write у закладі…»,
//      «проміжки робочого дня перетинаються». Такое показываем — но через
//      `maskText`, потому что в подстановку `%` могло уехать значение поля.
//   2. Известный код Postgres — показываем СВОЮ подпись из словаря. Строка
//      «duplicate key value violates unique constraint» не объясняет мастеру
//      ничего; ему нужно «такий запис уже є».
//   3. Всё остальное — общая подпись плюс сам код в скобках. Код не является
//      персональными данными и позволяет поддержке спросить «а что было».
//      Исходный текст при этом уходит в консоль и НЕ показывается.
//
// ── ЧЕГО ЗДЕСЬ НЕТ НАМЕРЕННО ────────────────────────────────────────────────
//
// Ошибки входа и регистрации (GoTrue) сюда не идут: у них свой разбор
// в `lib/auth-errors.ts`, и их сообщения — английский текст протокола,
// по которому узнаётся причина. Смешать два разбора значит потерять оба.
//
// Экранные переводчики (`humanize` в складе) не удаляются: они дают ЛУЧШУЮ
// подпись там, где экран знает больше общего случая. Они просто перестают
// заканчиваться `return message` — теперь их запасной путь здесь.

/** То, что приходит от supabase-js: и `PostgrestError`, и обычный Error. */
export type DbErrorLike = {
  message?: string | null
  code?: string | null
  details?: string | null
  hint?: string | null
}

// Коды, у которых есть человеческая подпись. Слева — SQLSTATE, он же
// значение протокола и переводу не подлежит; справа — ключ словаря.
const BY_CODE: Record<string, Key> = {
  '23505': 'error.db.duplicate',
  '23503': 'error.db.missingRef',
  '23514': 'error.db.checkFailed',
  '23502': 'error.db.required',
  '23P01': 'error.db.overlap',
  '22P02': 'error.db.badValue',
  '22001': 'error.db.tooLong',
  '42501': 'error.db.forbidden',
  '40001': 'error.db.retry',
  '40P01': 'error.db.retry',
  '57014': 'error.db.timeout',
  // PostgREST отвечает своими кодами, и два из них человек видит чаще всего.
  PGRST301: 'error.db.forbidden',
  PGRST116: 'error.db.notFound',
}

function pick(e: unknown): DbErrorLike {
  if (e && typeof e === 'object') return e as DbErrorLike
  return { message: typeof e === 'string' ? e : undefined }
}

/**
 * Текст ошибки базы для показа человеку. Никогда не возвращает сырое
 * сообщение Postgres — кроме нашего собственного `raise exception`,
 * и тот обезличен.
 */
export function dbErrorText(t: T, e: unknown): string {
  const { message, code } = pick(e)
  const raw = (message ?? '').trim()

  // Сеть отвалилась — это не ошибка базы, и говорить о ней надо иначе:
  // человек должен понять, что делать (подождать), а не что он ошибся.
  if (/fetch failed|network|failed to fetch|load failed/i.test(raw)) {
    return t('error.db.network')
  }

  // `maskText` объявлен как `string | null` ради null на входе; здесь вход
  // заведомо непустой, и запасной путь нужен только типу.
  if (code === 'P0001' && raw) return maskText(raw) ?? raw

  const key = code ? BY_CODE[code] : undefined
  if (key) return t(key)

  // Сюда попадает незнакомое. Сырой текст — в консоль (её видит владелец
  // и разработчик), человеку — общая подпись с кодом.
  if (raw) console.error('[db]', code ?? '—', raw)
  return code
    ? t('error.db.unknownWithCode', { code })
    : t('error.db.unknown')
}
