'use client'

import { useEffect, useRef, useState } from 'react'
import { useT } from '@/lib/i18n/client'

// Поле кода из письма: шесть цифр одной группой.
//
// 13.08.2026: было восемь, разбитых 4 + 4. Шесть — решение владельца,
// и оно же снимает главный сломанный путь: веб-регистрация ждала шесть
// знаков, а Supabase слал восемь, поэтому кнопка «Підтвердити» не
// разблокировалась никогда. Разделитель посередине убран: шесть клеток
// читаются с одного взгляда и без него, а в макете их шесть подряд.
//
// Почему не шесть отдельных <input>, как делают почти все: на телефоне
// это ломается сразу в трёх местах — Backspace на пустом поле не уводит
// назад, вставка кода из буфера кладёт все шесть цифр в первую клетку,
// а автоподстановка iOS «Код із листа» вообще не срабатывает, потому что
// не понимает, куда подставлять.
//
// Поэтому здесь ОДНО настоящее поле, растянутое поверх клеток и прозрачное.
// Оно и получает автоподстановку, и правильно ведёт себя при вставке,
// и даёт один нормальный курсор. Клетки — просто картинка состояния.
export function CodeInput({
  value,
  onChange,
  length = 6,
  disabled,
  invalid,
}: {
  value: string
  onChange: (v: string) => void
  length?: number
  disabled?: boolean
  invalid?: boolean
}) {
  const t = useT()
  const ref = useRef<HTMLInputElement>(null)
  const [focused, setFocused] = useState(false)

  // Экран кода открывается сразу после отправки письма — клавиатура
  // должна подняться сама, иначе первое действие человека это лишний тап.
  // Таймер назван `id`, а не `t`: `t` — переводчик.
  useEffect(() => {
    const id = setTimeout(() => ref.current?.focus(), 60)
    return () => clearTimeout(id)
  }, [])

  const cells = Array.from({ length }, (_, i) => i)

  return (
    <div
      className="relative"
      onClick={() => ref.current?.focus()}
      style={{ cursor: 'text' }}
    >
      <div className="flex items-center justify-center gap-2">
        {cells.map((i) => {
          const ch = value[i] ?? ''
          const active = focused && !disabled && i === Math.min(value.length, length - 1)
          return (
            <span
                key={i}
                className="tabular flex items-center justify-center"
                style={{
                  // Квадратные ячейки: в макете это шесть одинаковых
                  // квадратов, а не узкие полоски. 44 — чтобы шесть
                  // штук с зазорами влезли и на 360-пиксельный экран.
                  width: 44,
                  height: 52,
                  fontSize: 22,
                  fontWeight: 700,
                  borderRadius: 'var(--radius-control)',
                  border: `1px solid ${
                    invalid
                      ? 'var(--color-danger)'
                      : active
                        ? 'var(--color-accent)'
                        : 'var(--color-border-strong)'
                  }`,
                  background: ch ? 'var(--color-surface-2)' : 'var(--color-surface)',
                  boxShadow: active ? '0 0 0 3px var(--color-accent-soft)' : undefined,
                  color: 'var(--color-text)',
                  transition: 'border-color var(--dur-fast), box-shadow var(--dur-fast)',
                }}
              >
                {ch || (active ? <Caret /> : '')}
            </span>
          )
        })}
      </div>

      <input
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, length))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        disabled={disabled}
        inputMode="numeric"
        // Ради этой строки всё и затевалось: iOS сам предложит код
        // из только что пришедшего письма над клавиатурой.
        autoComplete="one-time-code"
        maxLength={length}
        aria-label={t('m.code.aria')}
        className="absolute inset-0 w-full"
        style={{
          opacity: 0,
          // Не display:none и не visibility:hidden — невидимое поле
          // не получает ни автоподстановку, ни клавиатуру. Только
          // прозрачность. И 16px, иначе iOS зумит экран при фокусе.
          fontSize: 16,
          border: 0,
          background: 'transparent',
          caretColor: 'transparent',
        }}
      />
    </div>
  )
}

function Caret() {
  return (
    <span
      aria-hidden
      style={{
        width: 2,
        height: 22,
        borderRadius: 2,
        background: 'var(--color-accent)',
        animation: 'caret-blink 1.1s steps(1, end) infinite',
      }}
    />
  )
}
