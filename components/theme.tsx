'use client'

import { useEffect, useState } from 'react'
import { useT } from '@/lib/i18n/client'

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
const KEY = 'theme'

type Choice = 'light' | 'dark'

// Скрипт исполняется ДО отрисовки, синхронно в <head>. Иначе первый кадр
// рисуется умолчанием, и человек с тёмной темой видит вспышку белого.
export const themeBootScript = `(function(){try{var t=localStorage.getItem('${KEY}');if(t==='dark'){document.documentElement.classList.add('dark')}}catch(e){}})()`

// Цвет шапки браузера на телефоне обязан идти за темой. Он задан в разметке
// одним значением (умолчание), и без этой правки человек, переключившийся
// в тёмную, видит светлую полосу над чёрной страницей — ровно тот стык,
// из-за которого страница выглядит сломанной.
const BAR = { light: '#f6f7f9', dark: '#0a0d14' } as const

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
    // Читаем не localStorage, а КЛАСС: его уже поставил загрузочный скрипт,
    // и это единственное место, где состояние точно совпадает с картинкой.
    setChoice(document.documentElement.classList.contains('dark') ? 'dark' : 'light')
  }, [])

  function pick(next: Choice) {
    setChoice(next)
    apply(next)
  }

  // `value` — служебное значение (оно же ключ в localStorage), оно не
  // переводится. Значок — символ, а не текст. Переводится только подпись.
  const options = [
    { value: 'light', label: '☀', title: 'theme.light' },
    { value: 'dark', label: '☾', title: 'theme.dark' },
  ] as const satisfies readonly { value: Choice; label: string; title: string }[]

  return (
    <div
      className={`inline-flex items-center gap-0.5 rounded-full border p-0.5 ${className}`}
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface-2)' }}
      role="group"
      aria-label={t('theme.aria')}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => pick(o.value)}
          title={t(o.title)}
          aria-label={t(o.title)}
          aria-pressed={choice === o.value}
          className="btn-icon t-md rounded-full leading-none transition-colors"
          style={
            choice === o.value
              ? { background: 'var(--color-accent)', color: 'var(--color-accent-text)' }
              : { color: 'var(--color-muted)' }
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
