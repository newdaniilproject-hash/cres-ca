import type { T } from '@/lib/i18n/translate'

// Переводчик ответов Supabase на человеческий язык.
//
// Вынесен из кнопки входа через провайдера (13.08.2026): текст ошибки
// нужен теперь и экранам входа, и регистрации, и восстановления, и
// мобильным двойникам. Держать словарь внутри кнопки провайдера
// значило бы, что половина проекта импортирует кнопку ради строки.
// Сама кнопка провайдера удалена 18.08.2026 вместе со входом через
// Google (правило 8); словарь остался — его читают экраны входа
// и регистрации почтой.

export function authErrorText(t: T, raw: string): string {
  const m = raw.toLowerCase()
  if (
    m.includes('provider is not enabled') ||
    m.includes('unsupported provider') ||
    m.includes('provider_disabled') ||
    m.includes('validation_failed')
  ) return t('auth.error.providerOff')
  if (m.includes('access_denied') || m.includes('cancel')) return t('auth.error.cancelled')
  if (m.includes('expired') || m.includes('otp_expired')) return t('auth.error.linkExpired')
  return t('auth.error.generic')
}

// Ошибки формы: регистрация, отправка кода, вход паролем.
//
// Порядок веток НЕ случаен: частные случаи стоят ДО общих подстрок.
// «New password should be different» содержит слово password, и общая
// ветка перевела бы его как «пароль закороткий» — то есть соврала бы.
export function humanAuthError(t: T, message: string): string {
  const m = message.toLowerCase()
  // «For security purposes, you can only request this after N seconds» —
  // самый частый ответ на быстрый повтор кода. Раньше падал в хвост
  // и приезжал человеку по-английски с каждой кнопки «надіслати ще раз».
  if (m.includes('for security purposes')) {
    const sec = lockoutSeconds(message) ?? 60
    return t('auth.error.tooSoon', { period: lockoutText(t, sec) })
  }
  if (m.includes('rate limit') || m.includes('too many'))
    return t('auth.error.rateLimit')
  if (m.includes('already registered') || m.includes('already exists'))
    return t('auth.error.exists')
  if (isBanned(message)) return t('auth.error.banned')
  if (m.includes('invalid login')) return t('auth.error.credentials')
  if (m.includes('email not confirmed')) return t('auth.error.notConfirmed')
  // Secure password change: GoTrue просит подтвердить личность заново.
  if (m.includes('reauthentication')) return t('auth.error.reauth')
  // Новый пароль совпал со старым — это не «слабый пароль».
  if (m.includes('different from the old') || m.includes('should be different'))
    return t('auth.error.samePassword')
  if (m.includes('password')) return t('auth.error.password')
  if (m.includes('email') && m.includes('invalid')) return t('auth.error.email')
  // Неузнанный отказ: общая подпись, сырой текст — только в консоль (М25).
  // Прежний `return message` отдавал человеку английскую строку GoTrue;
  // «написан для человека» — это про наши raise exception из базы,
  // но они сюда и не попадают: у форм БАЗЫ переводчик dbErrorText.
  console.warn('auth:', message)
  return t('auth.error.generic')
}

// ── Замок учётной записи (0085) ────────────────────────────────────────────
//
// Это НЕ то же самое, что `lockoutSeconds` ниже. Там — предел Supabase
// («слишком часто просите письмо»), он про частоту запросов и снимается
// секундами. Здесь — наш замок: десять неверных паролей за 15 хвилин, и
// `record_failed_login()` пишет `auth.users.banned_until`. Смешать их нельзя:
// у них разные причины, разные сроки и разный совет человеку.
//
// Две стороны, с которых замок виден форме:
//
//   1. НАШ роут вернул `lock.locked` — это тот самый десятый пароль, и мы
//      знаем и время снятия, и число попыток;
//   2. GoTrue ответил «User is banned» — замок уже стоял до этой попытки.
//      Числа попыток в таком ответе нет и быть не может, поэтому текст
//      другой: он не врёт про «десять спроб», а называет само состояние.
//
// Второй случай раньше падал в общий `return message` и приезжал человеку
// английской строкой «User is banned» — то есть ровно тем молчаливым
// отказом, из-за которого запертый вход читается как поломка продукта.

/** Ответ GoTrue про заблокированного пользователя. Подстроки английские. */
export function isBanned(message: string): boolean {
  const m = message.toLowerCase()
  return m.includes('user is banned') || m.includes('user_banned')
}

/**
 * Текст замка: что произошло, до какого времени и что делать.
 *
 * `until` — ISO-время из `record_failed_login`. Часы через `t.dateTime`,
 * а не ручной подстановкой: формат времени зависит от языка.
 * Число попыток — через `t.plural`, иначе выходит «10 спроба».
 */
export function lockedText(
  t: T, lock: { until: string | null; attempts: number } | null,
): string {
  if (!lock) return t('auth.locked.plain')

  const attempts = lock.attempts > 0
    ? t.plural('auth.locked.attempts', lock.attempts)
    : ''
  const until = lock.until
    ? t('auth.locked.until', { time: t.dateTime(lock.until, { hour: '2-digit', minute: '2-digit' }) })
    : t('auth.locked.untilUnknown')

  return [until, attempts].filter(Boolean).join(' ')
}

// Ошибки экрана кода. Отдельно от общего словаря сознательно: общий
// мапит «token expired» на «сеанс истёк, увійдіть заново», а истёк
// код, а не сеанс — и человек шёл подтверждать почту, а не входить.
export function codeErrorText(t: T, message: string): string {
  const m = message.toLowerCase()
  if (m.includes('expired')) return t('auth.code.error.expired')
  if (m.includes('already') && (m.includes('registered') || m.includes('confirmed')))
    return t('auth.code.error.confirmed')
  return t('auth.code.error.invalid')
}

// Перебор попыток входа. Supabase отвечает 429 и фразой вида
// «For security purposes, you can only request this after 55 seconds»
// либо «Too many requests». Достаём число, если оно есть: «спробуйте
// пізніше» без срока человек читает как «сломалось навсегда».
//
// Возврат null означает «это не блокировка» — тогда экран блокировки
// не показываем вовсе.
export function lockoutSeconds(message: string, status?: number): number | null {
  const m = message.toLowerCase()
  const looksLocked =
    status === 429 ||
    m.includes('too many') ||
    m.includes('rate limit') ||
    m.includes('for security purposes')
  if (!looksLocked) return null

  const sec = m.match(/(\d+)\s*second/)
  if (sec) return Number(sec[1])
  const min = m.match(/(\d+)\s*minute/)
  if (min) return Number(min[1]) * 60
  // Срока в ответе нет — берём то, что стоит в настройках Supabase
  // по умолчанию и что обещает экран: пятнадцать хвилин.
  return 15 * 60
}

/**
 * Срок ожидания словами: «45 секунд», «2 хвилини», «15 хвилин».
 *
 * Своего склонения здесь больше нет. Правило выбора формы живёт в одном
 * месте (`lib/i18n/format.ts`) и вызывается через `t.plural`: копия
 * правила, написанная руками, разъезжается с оригиналом на первой правке,
 * а с русским и английским разъехалась бы сразу — там формы другие.
 * Заодно чинится и секундная ветка: она склонения не знала вовсе
 * и обещала «21 секунд».
 */
export function lockoutText(t: T, seconds: number): string {
  if (seconds < 90) return t.plural('auth.lockout.seconds', seconds)
  return t.plural('auth.lockout.minutes', Math.ceil(seconds / 60))
}
