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

/** Подпись состояния на украинском — ровно как на макете карточки. */
export const EXPIRY_LABEL: Record<ExpiryState, string> = {
  none: 'Термін не вказано',
  ok: 'Дійсний',
  soon: 'Скоро закінчується',
  urgent: 'Закінчується',
  expired: 'Прострочений',
}

/** Класс значка. Оттенки из токенов темы, свои цвета не заводим. */
export const EXPIRY_BADGE: Record<ExpiryState, string> = {
  none: 'badge',
  ok: 'badge-success',
  soon: 'badge-warn',
  urgent: 'badge-warn',
  expired: 'badge-danger',
}

/** Дата человеку: «20.05.2026». Пусто — прочерк, а не пустое место. */
export function fmtDate(d: string | null | undefined): string {
  if (!d) return '—'
  const dt = new Date(d.length <= 10 ? `${d}T00:00:00` : d)
  return Number.isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('uk-UA')
}

/** Короткая дата для плотных списков: «20 трав.». */
export function fmtShort(d: string | null | undefined): string {
  if (!d) return '—'
  const dt = new Date(d.length <= 10 ? `${d}T00:00:00` : d)
  return Number.isNaN(dt.getTime())
    ? '—'
    : dt.toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' })
}
