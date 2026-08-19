'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/lib/i18n/client'
// Значения и строки загрузочных скриптов живут в модуле БЕЗ `'use client'`
// (`lib/theme-script.ts`): их читает и сервер тоже. Разбор — там же,
// в шапке файла; ошибка стоила боевого падения 19.08.2026.
import { THEME_BAR as BAR, THEME_KEY as KEY, type Choice } from '@/lib/theme-script'

// РЕЭКСПОРТА ЗДЕСЬ НЕТ НАМЕРЕННО. Реэкспорт из клиентского модуля
// проходит через ту же границу, что и собственный экспорт: серверный
// макет получил бы ссылку на клиентскую сущность, и падение вернулось бы
// один в один. Сервер импортирует напрямую из `lib/theme-script`.

// ── Выбор темы ──────────────────────────────────────────────────────────────
//
// Решение владельца 18.08.2026: обе темы полные, СВЕТЛАЯ по умолчанию,
// тёмная включается здесь. Соответственно значения по умолчанию в
// globals.css — светлые, а тёмные лежат в `html.dark`.
//
// Системную тему файл намеренно НЕ слушает: тема — выбор человека, а не
// операционной системы. Прежний третий пункт «як у системі» был враньём —
// он не читал `prefers-color-scheme` вовсе, а просто снимал класс, то есть
// возвращал тогдашнее умолчание (тёмное). Пункт убран, а не «починен»:
// владелец назвал ровно две темы (правило 8 — выключено значит удалено).
// ── Статус-бар в приложении ─────────────────────────────────────────────────
//
// Веб-вью рисуется ПОД статус-баром, поэтому фон часов и значков — это фон
// нашей страницы, и их цвет обязан идти за темой. Иначе после переключения
// в тёмную человек видит чёрные часы на чёрном.
//
// Два пути, как и у откликов (`lib/haptic.ts`), и по той же причине:
//   iOS     — мост Capacitor, `window.Capacitor.Plugins.StatusBar`;
//   Android — свой `window.AndroidStatusBar` из MainActivity: при удалённом
//             server.url моста Capacitor на Android НЕТ (грабли DaKi).
// Нативный пакет НЕ импортируется: иначе сборка Vercel потребует то, что
// нужно только Codemagic.
//
// `Style.Dark` в Capacitor означает «СВЕТЛЫЙ текст для тёмного фона» —
// имя дано по фону, а не по тексту. Перепутать легко, и ошибка видна
// только на устройстве.
function nativeBar(dark: boolean) {
  if (typeof window === 'undefined') return
  try {
    const w = window as unknown as {
      AndroidStatusBar?: { setDark?: (v: boolean) => void }
      Capacitor?: { isNativePlatform?: () => boolean; Plugins?: Record<string, unknown> }
    }
    if (w.AndroidStatusBar?.setDark) { w.AndroidStatusBar.setDark(dark); return }
    if (!w.Capacitor?.isNativePlatform?.()) return
    const p = w.Capacitor.Plugins
    const sb = p?.StatusBar as { setStyle?: (o: { style: string }) => unknown } | undefined
    sb?.setStyle?.({ style: dark ? 'DARK' : 'LIGHT' })
    // Клавиатура — по той же причине и с тем же именованием: тёмная
    // клавиатура под белой формой читается как чужой элемент.
    const kb = p?.Keyboard as { setStyle?: (o: { style: string }) => unknown } | undefined
    kb?.setStyle?.({ style: dark ? 'DARK' : 'LIGHT' })
  } catch { /* мост не обязателен: в браузере его нет вовсе */ }
}

// ── Где на самом деле живёт выбор ───────────────────────────────────────────
//
// Требование владельца 19.08.2026: «хочу чтобы смена темы синхронизировалась
// между вебом и мобом и запоминалась».
//
// `localStorage` этого не умеет и уметь не может: обёртка открывает тот же
// боевой сайт, но в своём веб-вью, а у веб-вью собственное хранилище —
// не общее с Safari или Chrome того же телефона. Кука тем же и кончается,
// банка кук у веб-вью тоже своя.
//
// Поэтому источник правды — `profiles.theme` (миграция 0109), а localStorage
// остаётся КЕШЕМ ради первого кадра: класс на <html> обязан встать
// синхронно, до отрисовки, а сходить в базу синхронно нельзя.
//
// Порядок такой:
//   1. загрузочный скрипт ставит класс из localStorage — мгновенно;
//   2. макет кабинета знает тему из базы и правит класс своим скриптом,
//      если она разошлась (`app/app/layout.tsx`) — до первого кадра
//      кабинета, без вспышки;
//   3. переключатель пишет в оба места сразу.
//
// Запись в базу — БЕЗ ожидания ответа: тема обязана переключиться в тот же
// кадр, а сеть здесь не в критическом пути. Не получилось записать (нет
// связи) — на этом устройстве всё равно применилось и запомнилось.
async function remember(choice: Choice) {
  try {
    const supabase = createClient()
    const { data } = await supabase.auth.getSession()
    const id = data.session?.user.id
    if (!id) return
    await supabase.from('profiles').update({ theme: choice }).eq('id', id)
  } catch { /* до входа профиля нет, и это нормальный случай */ }
}

function apply(choice: Choice) {
  const root = document.documentElement
  root.classList.toggle('dark', choice === 'dark')
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', BAR[choice])
  nativeBar(choice === 'dark')
  try {
    localStorage.setItem(KEY, choice)
  } catch {
    // Приватный режим Safari запрещает запись: тема применится,
    // но не переживёт перезагрузку. Это лучше, чем упасть.
  }
}

// Класс на <html> ставит загрузочный скрипт — он синхронный и успевает до
// первой отрисовки. А до нативного статус-бара скрипт дотянуться не может:
// моста в этот момент ещё нет. Поэтому один эффект в корне, при запуске.
//
// Без него человек, выбравший тёмную, видит правильную страницу и тёмные
// часы на ней — до тех пор, пока не зайдёт в профиль и не потрогает
// переключатель. Ставить это в `ThemeToggle` бессмысленно: он живёт
// на одном экране, а тема — на всех.
export function ThemeNativeSync() {
  useEffect(() => {
    nativeBar(document.documentElement.classList.contains('dark'))
  }, [])
  return null
}

export function ThemeToggle({ className = '' }: { className?: string }) {
  const t = useT()
  const [choice, setChoice] = useState<Choice>('light')

  useEffect(() => {
    // Читаем не localStorage, а КЛАСС: его уже поставил загрузочный скрипт
    // (а в кабинете мог поправить серверный), и это единственное место,
    // где состояние точно совпадает с картинкой.
    setChoice(document.documentElement.classList.contains('dark') ? 'dark' : 'light')
  }, [])

  function pick(next: Choice) {
    if (next === choice) return
    setChoice(next)
    apply(next)
    void remember(next)
  }

  // Подписи СЛОВАМИ, а не значками солнца и месяца. Значок здесь ничего
  // не экономит — места хватает, — а «☾» на половине Android рисуется
  // квадратом: это не шрифт интерфейса, а эмодзи-глиф, и его наличие
  // зависит от прошивки. Теми же квадратами в этом проекте уже приезжали
  // «◫ ◷ ⊘» на телефоне владельца (КОНСПЕКТЫ.md, М32).
  const options = [
    { value: 'light', title: 'theme.light' },
    { value: 'dark', title: 'theme.dark' },
  ] as const satisfies readonly { value: Choice; title: string }[]

  return (
    <div className={`seg ${className}`} role="group" aria-label={t('theme.aria')}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => pick(o.value)}
          aria-pressed={choice === o.value}
          data-active={choice === o.value}
          className="seg-item"
        >
          {t(o.title)}
        </button>
      ))}
    </div>
  )
}

