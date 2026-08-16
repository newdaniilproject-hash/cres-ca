// Срок годности одним правилом на весь склад.
//
// До этого «скоро закінчується» считалось в трёх местах по-своему:
// на списке ёмкостей — 14 дней, в наклейках — никак, в предупреждениях —
// 14 и 7 по базе. Порог обязан быть один и тот же, иначе экран и письмо
// расходятся: в списке зелено, а на почту уже пришло предупреждение.
//
// Четырнадцать дней — не выдумка экрана, это первый порог рассылки
// enqueue_expiry_warnings. Второй порог, семь дней, здесь тоже нужен:
// он красит строку иначе, чтобы «через неделю» не выглядело как
// «через две».

export type ExpiryState = 'none' | 'ok' | 'soon' | 'urgent' | 'expired'

export const WARN_DAYS = 14
export const URGENT_DAYS = 7

/** Дней до конца срока. Отрицательное — срок уже вышел. */
export function daysLeft(useBy: string | null | undefined, now = new Date()): number | null {
  if (!useBy) return null
  // Считаем по календарным дням, а не по миллисекундам: «сегодня
  // последний день» обязано быть нулём, а не «-0.3 дня».
  const end = new Date(`${useBy.slice(0, 10)}T00:00:00`)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((end.getTime() - today.getTime()) / 86_400_000)
}

export function expiryState(useBy: string | null | undefined, now = new Date()): ExpiryState {
  const d = daysLeft(useBy, now)
  if (d === null) return 'none'
  if (d < 0) return 'expired'
  if (d <= URGENT_DAYS) return 'urgent'
  if (d <= WARN_DAYS) return 'soon'
  return 'ok'
}

// Подписи состояний здесь больше нет. Она была украинской строкой
// (`EXPIRY_LABEL`), и после перевода склада экраны берут её из словаря
// по `EXPIRY_KEY` — иначе рядом с переведённой карточкой стоял бы
// украинский значок. Второй список подписей не заводим: правило 8,
// «выключено — значит удалено».

/** Класс значка. Оттенки из токенов темы, свои цвета не заводим. */
export const EXPIRY_BADGE: Record<ExpiryState, string> = {
  none: 'badge',
  ok: 'badge-success',
  soon: 'badge-warn',
  urgent: 'badge-warn',
  expired: 'badge-danger',
}

// Своих `fmtDate` и `fmtShort` здесь тоже больше нет. Они звали
// `toLocaleDateString('uk-UA')` с зашитой локалью, то есть при русском
// интерфейсе давали украинский месяц, — а экраны склада уже форматируют
// даты через `t.date`, где локаль приходит из языка. Две реализации
// одного и того же не оставляем: разъедутся на первой правке.
