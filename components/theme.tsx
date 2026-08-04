'use client'

import { useEffect, useState } from 'react'

// Выбор темы хранится в localStorage и ставится классом на <html>.
// Значений три: 'light', 'dark' и отсутствие ключа — «как есть».
// Значения по умолчанию в globals.css — тёмные, и системную тему
// файл намеренно не слушает: тёмный интерфейс здесь не «ночной
// режим», а основной вид продукта.
const KEY = 'theme'

type Choice = 'light' | 'dark' | 'system'

// Скрипт исполняется ДО отрисовки, синхронно в <head>. Иначе первый
// кадр рисуется темой по умолчанию, и пользователь видит вспышку
// чужого фона — на тёмной теме это особенно заметно.
export const themeBootScript = `(function(){try{var t=localStorage.getItem('${KEY}');if(t==='dark'||t==='light'){document.documentElement.classList.add(t)}}catch(e){}})()`

function apply(choice: Choice) {
  const root = document.documentElement
  root.classList.remove('light', 'dark')
  if (choice !== 'system') root.classList.add(choice)
  try {
    if (choice === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, choice)
  } catch {
    // Приватный режим Safari запрещает запись: тема применится,
    // но не переживёт перезагрузку. Это лучше, чем упасть.
  }
}

export function ThemeToggle({ className = '' }: { className?: string }) {
  const [choice, setChoice] = useState<Choice>('system')

  useEffect(() => {
    const saved = (() => {
      try { return localStorage.getItem(KEY) } catch { return null }
    })()
    if (saved === 'light' || saved === 'dark') setChoice(saved)
  }, [])

  function pick(next: Choice) {
    setChoice(next)
    apply(next)
  }

  const options: { value: Choice; label: string; title: string }[] = [
    { value: 'light', label: '☀', title: 'Світла' },
    { value: 'system', label: '◐', title: 'Як у системі' },
    { value: 'dark', label: '☾', title: 'Темна' },
  ]

  return (
    <div
      className={`inline-flex items-center gap-0.5 rounded-full border p-0.5 ${className}`}
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface-2)' }}
      role="group"
      aria-label="Тема оформлення"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => pick(o.value)}
          title={o.title}
          aria-label={o.title}
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
