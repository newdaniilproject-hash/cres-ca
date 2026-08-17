// ── Обезличивание перед записью в журнал. Сторона приложения ──────────────
//
// Правило приёмки 14 запрещает персональным данным попадать в журнал ошибок.
// В базе это уже закрыто миграцией 0089: `mask_phone`, `mask_email`,
// `mask_name`, `mask_text_pii` и `redact_pii` навешены триггерами на
// `security_events` и `notification_outbox`. Здесь — тот же набор для той
// половины, до которой триггер не достаёт: `console.*` в серверных роутах,
// ответы наружу и будущий сборщик ошибок (шаг 2 плана).
//
// ПОЧЕМУ ОДИН ФАЙЛ, А НЕ ПО МЕСТУ. Обезличивание, размазанное по вызывающим,
// перестаёт работать на первом же новом вызывающем — ровно так дефект
// и появился в базе, и ровно поэтому 0089 сделала его триггером. Здесь
// триггера нет, значит нужна хотя бы одна функция в одном месте: добавить
// новый вид данных должно быть правкой этого файла, а не поиском по проекту.
//
// ПОЧЕМУ ПРАВИЛА ПОВТОРЯЮТ 0089 ДОСЛОВНО. Две стороны обязаны маскировать
// одинаково: иначе одна и та же строка в журнале базы и в журнале хостинга
// выглядит по-разному, и по хвосту «…33» их уже не свести. Расхождение
// здесь — это не «чуть иначе», это потерянная возможность разобрать инцидент.
//
// ПОЧЕМУ МАСКА, А НЕ ВЫРЕЗАНИЕ. Из «*********33» видно, что телефон был
// и какой у него хвост, — этого хватает, чтобы сопоставить строку журнала
// с обращением клиента. Из «***» не видно ничего. Исключение — пароли
// и токены: они вырезаются целиком, их хвост не нужен никому.

/** Телефон: остаются две последние цифры. Повторяет `public.mask_phone`. */
export function maskPhone(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const v = value.trim()
  if (v.length <= 4) return '***'
  return '*'.repeat(v.length - 2) + v.slice(-2)
}

/**
 * Почта: первая буква и домен. Повторяет `public.mask_email`.
 * Домен остаётся намеренно — по нему видно, наш ли почтовик отказал
 * и какому провайдеру писать.
 */
export function maskEmail(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const at = value.indexOf('@')
  if (at < 1) return '***'
  return `${value[0]}***@${value.slice(at + 1)}`
}

/** Имя и фамилия: инициал. Повторяет `public.mask_name`. */
export function maskName(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const v = value.trim()
  if (v.length === 0) return value
  return `${v[0]}***`
}

/**
 * Адрес подключения. В базе аналога нет: `security_events.ip` хранится
 * целиком осознанно — это журнал безопасности, и там адрес и есть событие.
 * А в журнале хостинга адрес — просто персональные данные без срока
 * хранения и без нашего контроля, поэтому сюда он едет обрезанным.
 *
 * Для IPv4 отбрасывается последний октет, для IPv6 — всё, кроме первых
 * четырёх групп. Этого хватает, чтобы отличить сеть от сети (то есть
 * увидеть перебор), и не хватает, чтобы указать на человека.
 */
export function maskIp(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null
  if (value.includes(':')) {
    const parts = value.split(':')
    return `${parts.slice(0, 4).join(':')}::/64`
  }
  const parts = value.split('.')
  if (parts.length !== 4) return '***'
  return `${parts[0]}.${parts[1]}.${parts[2]}.x`
}

// Свободный текст. Порядок образцов тот же, что в `public.mask_text_pii`:
// сначала более узкий (почта), потом более широкий (последовательность
// цифр). Обратный порядок съел бы цифры внутри адреса, и почта перестала
// бы распознаваться.
const EMAIL_RE = /([\w.%+-])[\w.%+-]*@([\w.-]+\.[a-zA-Z]{2,})/g
const PHONE_RE = /\+?\d[\d ()-]{7,}\d/g

/** Обезличивание свободного текста: ответы почтовика, сообщения Postgres. */
export function maskText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  return value
    .replace(EMAIL_RE, '$1***@$2')
    .replace(PHONE_RE, '<номер прихований>')
}

// Ключи разобраны по СМЫСЛУ, а не по списку конкретных имён — та же
// причина, что в 0089: роут может положить и `contact_phone`, и `to_phone`,
// и просто `phone`. Список имён разошёлся бы с кодом через неделю,
// образец — нет.
const SECRET_RE = /(password|passwd|pwd|secret|token|api_?key|authorization|otp|refresh)/i
const PHONE_KEY_RE = /(phone|tel$|_tel|mobile)/i
const EMAIL_KEY_RE = /(e?mail)/i
const NAME_KEY_RE = /(first_name|last_name|surname|full_name|contact_name|customer_name|patronymic)/i
const ADDR_KEY_RE = /(address|street|apartment|building|delivery_branch|delivery_address)/i
const IP_KEY_RE = /(^ip$|_ip$|ip_address|remote_addr)/i

type Json = string | number | boolean | null | Json[] | { [k: string]: Json }

/**
 * Рекурсивное обезличивание объекта перед записью в журнал.
 * Повторяет `public.redact_pii(jsonb)`.
 *
 * Глубина ограничена: объект со ссылкой на себя (а в перехваченной ошибке
 * такое бывает) иначе увёл бы это в бесконечность прямо в обработчике,
 * который писался ради надёжности.
 */
export function redact(value: unknown, depth = 0): Json {
  if (depth > 6) return '<глибоко>'
  if (value === null || value === undefined) return null
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1))
  if (value instanceof Error) {
    return { name: value.name, message: maskText(value.message) }
  }
  if (typeof value === 'object') {
    const out: { [k: string]: Json } = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_RE.test(k)) { out[k] = '<вилучено>'; continue }
      if (v !== null && typeof v === 'object') { out[k] = redact(v, depth + 1); continue }
      if (typeof v !== 'string') { out[k] = (v ?? null) as Json; continue }
      if (PHONE_KEY_RE.test(k)) { out[k] = maskPhone(v); continue }
      if (EMAIL_KEY_RE.test(k)) { out[k] = maskEmail(v); continue }
      if (NAME_KEY_RE.test(k)) { out[k] = maskName(v); continue }
      if (ADDR_KEY_RE.test(k)) { out[k] = '<адреса прихована>'; continue }
      if (IP_KEY_RE.test(k)) { out[k] = maskIp(v); continue }
      out[k] = maskText(v)
    }
    return out
  }
  if (typeof value === 'string') return maskText(value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  return String(value)
}
