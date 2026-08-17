import type { T } from '@/lib/i18n/translate'

// Переводчик ответов Supabase на человеческий язык.
//
// Вынесен из app/(auth)/google-button.tsx (13.08.2026): текст ошибки
// нужен теперь и экранам входа, и регистрации, и восстановления, и
// мобильным двойникам. Держать словарь внутри кнопки провайдера
// значило бы, что половина проекта импортирует кнопку ради строки.
// google-button.tsx продолжает экспортировать authErrorText — там
// оставлен ре-экспорт, чтобы старые импорты не разъехались.
//
// ── ДВЕ СТОРОНЫ ЭТОГО ФАЙЛА, И ПУТАТЬ ИХ НЕЛЬЗЯ ────────────────────────────
//
// Слева — то, ПО ЧЕМУ разбирается ответ сервера: 'provider is not enabled',
// 'access_denied', 'already registered', 'for security purposes'. Это куски
// английских сообщений Supabase, то есть данные протокола, а не текст.
// Переводить их — значит перестать узнавать ответ вовсе: экран покажет
// общий отказ там, где знал точную причину. Они остаются английскими
// навсегда, как и служебные значения перечислений (CLAUDE.md → «Что
// в словарь не кладётся»).
//
// Справа — то, ЧТО читает человек. Это строки интерфейса, и с 16.08.2026
// они приходят из словаря: до этого экраны входа на любом языке отвечали
// отказом по-украински, потому что весь их текст уже переведён, а причина
// отказа — нет.
//
// Отсюда `t` первым параметром у каждой функции. Не импорт готового
// переводчика внутрь файла: язык известен только вызывающему —
// в клиентском компоненте это `useT()`, на сервере `await getT()`,
// и второго источника языка здесь заводить нельзя.

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
// Последняя строка — `message` как есть, и это осознанно: отказ, который
// мы не узнали, приходит из базы уже написанным для человека (сторож 0081),
// и переписывать его здесь значило бы завести второй источник правды.
export function humanAuthError(t: T, message: string): string {
  const m = message.toLowerCase()
  if (m.includes('rate limit') || m.includes('too many'))
    return t('auth.error.rateLimit')
  if (m.includes('already registered') || m.includes('already exists'))
    return t('auth.error.exists')
  if (m.includes('invalid login')) return t('auth.error.credentials')
  if (m.includes('email not confirmed')) return t('auth.error.notConfirmed')
  if (m.includes('password')) return t('auth.error.password')
  if (m.includes('email') && m.includes('invalid')) return t('auth.error.email')
  return message
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
