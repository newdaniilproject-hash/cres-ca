// Отклик на касание. То, чем нативное приложение отличается от сайта
// сильнее всего: палец получает подтверждение раньше, чем глаз.
//
// Три платформы, три разных пути — и ни одного импорта нативного пакета,
// иначе сборка Vercel потребует то, что нужно только Codemagic:
//   iOS      — window.Capacitor.Plugins.Haptics (мост есть, @capacitor/haptics
//              в зависимостях);
//   Android  — window.AndroidHaptics из MainActivity: моста Capacitor
//              при удалённом server.url НЕТ (грабли DaKi), а navigator.vibrate
//              в WebView даёт грубое «жужжание» вместо щелчка;
//   браузер  — тишина. Вибрация на сайте — это раздражение, а не отклик.
//
// Правило дозировки, нарушение которого превращает отклик в назойливость:
//   tap     — обычное нажатие: кнопка, ссылка, вкладка;
//   select  — смена выбора: переключатель, вкладка, шаг счётчика;
//   success — действие завершилось и что-то изменилось в базе;
//   warn    — предупреждение, на которое надо посмотреть;
//   error   — не получилось.
// Прокрутка, набор текста и появление экрана НЕ отзываются никогда.

type Style = 'light' | 'medium' | 'heavy'
type Notif = 'SUCCESS' | 'WARNING' | 'ERROR'

type IosHaptics = {
  impact?: (o: { style: string }) => Promise<void>
  notification?: (o: { type: string }) => Promise<void>
  selectionStart?: () => Promise<void>
  selectionChanged?: () => Promise<void>
  selectionEnd?: () => Promise<void>
}
type AndroidHaptics = {
  impact?: (style: string) => void
  notify?: (type: string) => void
  select?: () => void
}

function ios(): IosHaptics | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    Capacitor?: { isNativePlatform?: () => boolean; Plugins?: Record<string, unknown> }
  }
  if (!w.Capacitor?.isNativePlatform?.()) return null
  return (w.Capacitor.Plugins?.Haptics as IosHaptics) ?? null
}

function android(): AndroidHaptics | null {
  if (typeof window === 'undefined') return null
  return (window as unknown as { AndroidHaptics?: AndroidHaptics }).AndroidHaptics ?? null
}

// Тише, чем кажется: любой сбой моста глотаем. Отклик — украшение,
// и уронить из-за него действие человека недопустимо.
function safe(fn: () => unknown) {
  try { void fn() } catch { /* отклик не обязателен */ }
}

export function impact(style: Style = 'light') {
  const a = android()
  if (a?.impact) return safe(() => a.impact!(style))
  const i = ios()
  if (i?.impact) return safe(() => i.impact!({ style: style.toUpperCase() }))
}

export function selection() {
  const a = android()
  if (a?.select) return safe(() => a.select!())
  const i = ios()
  if (i?.selectionChanged) return safe(() => i.selectionChanged!())
}

function notify(type: Notif) {
  const a = android()
  if (a?.notify) return safe(() => a.notify!(type))
  const i = ios()
  if (i?.notification) return safe(() => i.notification!({ type }))
}

export const haptic = {
  tap: () => impact('light'),
  press: () => impact('medium'),
  select: () => selection(),
  success: () => notify('SUCCESS'),
  warn: () => notify('WARNING'),
  error: () => notify('ERROR'),
}
