// Переводчик ответов Supabase на человеческий язык.
//
// Вынесен из app/(auth)/google-button.tsx (13.08.2026): текст ошибки
// нужен теперь и экранам входа, и регистрации, и восстановления, и
// мобильным двойникам. Держать словарь внутри кнопки провайдера
// значило бы, что половина проекта импортирует кнопку ради строки.
// google-button.tsx продолжает экспортировать authErrorText — там
// оставлен ре-экспорт, чтобы старые импорты не разъехались.

const PROVIDER_OFF = 'Вхід через Google ще налаштовується — скористайтеся поштою'

export function authErrorText(raw: string): string {
  const m = raw.toLowerCase()
  if (
    m.includes('provider is not enabled') ||
    m.includes('unsupported provider') ||
    m.includes('provider_disabled') ||
    m.includes('validation_failed')
  ) return PROVIDER_OFF
  if (m.includes('access_denied') || m.includes('cancel')) return 'Вхід скасовано'
  if (m.includes('expired') || m.includes('otp_expired')) return 'Посилання вже недійсне — надішліть новий лист'
  return 'Не вдалося завершити вхід. Спробуйте ще раз або увійдіть поштою'
}

// Ошибки формы: регистрация, отправка кода, вход паролем.
export function humanAuthError(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('rate limit') || m.includes('too many'))
    return 'Забагато спроб. Зачекайте хвилину й спробуйте ще раз.'
  if (m.includes('already registered') || m.includes('already exists'))
    return 'Такий акаунт уже існує. Спробуйте увійти або відновити пароль.'
  if (m.includes('invalid login')) return 'Невірна пошта або пароль'
  if (m.includes('email not confirmed')) return 'Пошта ще не підтверджена — введіть код із листа'
  // ⚠️ Здесь на любое упоминание слова «password» отвечали «пароль
  // закороткий або надто простий». Под это правило попадала и фраза
  // Supabase «New password should be different from the old password»:
  // человеку, который ставил прежний пароль, сообщали, что пароль
  // слишком простой, — утверждение, которого в ответе не было.
  // Разбираем по существу и не додумываем причину там, где её не сказали.
  if (m.includes('different from the old'))
    return 'Новий пароль має відрізнятися від старого.'
  if (m.includes('should be at least') || m.includes('too short') || m.includes('weak'))
    return 'Пароль закороткий або надто простий.'
  if (m.includes('password')) return 'Перевірте пароль.'
  if (m.includes('email') && m.includes('invalid')) return 'Перевірте адресу пошти.'
  return message
}

// Ошибки экрана кода. Отдельно от общего словаря сознательно: общий
// мапит «token expired» на «сеанс истёк, увійдіть заново», а истёк
// код, а не сеанс — и человек шёл подтверждать почту, а не входить.
//
// ⚠️ ГРАБЛИ (14.08.2026). Здесь стояло «Код застарів. Надішліть новий»
// на любое `expired`. Но GoTrue отвечает `otp_expired` И на просроченный
// код, И на просто НЕВЕРНЫЙ: различить их по ответу нельзя. Человек
// вводил опечатку в код возрастом сорок секунд и читал, что код устарел,
// — то есть система утверждала то, чего знать не может, и вдобавок
// советовала бесполезное действие (заказать новый код вместо того,
// чтобы перепроверить цифры).
//
// Правило: не утверждать причину, если ответ её не содержит. Называем
// обе возможности и оба выхода из них.
export function codeErrorText(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('expired') || m.includes('invalid') || m.includes('incorrect'))
    return 'Код невірний або застарів. Перевірте цифри або надішліть новий.'
  if (m.includes('already') && (m.includes('registered') || m.includes('confirmed')))
    return 'Ця пошта вже підтверджена. Увійдіть зі своїм паролем.'
  return 'Код невірний або застарів. Перевірте цифри або надішліть новий.'
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

export function lockoutText(seconds: number): string {
  if (seconds < 90) return `${seconds} секунд`
  const m = Math.ceil(seconds / 60)
  const last = m % 10
  const teen = m % 100 >= 11 && m % 100 <= 14
  if (!teen && last === 1) return `${m} хвилину`
  if (!teen && last >= 2 && last <= 4) return `${m} хвилини`
  return `${m} хвилин`
}
