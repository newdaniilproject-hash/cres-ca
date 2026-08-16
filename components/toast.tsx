'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { RootLangProvider, useT } from '@/lib/i18n/client'

// Уведомления вместо alert().
//
// alert() блокирует страницу, выглядит как системная ошибка браузера,
// не переводится и на телефоне выбрасывает человека из контекста.
// Главное же — он не различает «получилось» и «не получилось»:
// мастер видит одинаковое серое окно и в том, и в другом случае.
//
// Правило, ради которого это написано: у любого действия есть видимый
// исход. Получилось — зелёная строка с тем, что именно произошло.
// Не получилось — красная, с причиной человеческим языком и, если есть,
// с кнопкой «Повторити». Молчание запрещено: непонятное состояние хуже
// честной ошибки.

export type ToastKind = 'success' | 'error' | 'warn' | 'info'

export type ToastInput = {
  kind?: ToastKind
  text: string
  /** Подпись мелким шрифтом: причина, номер, подсказка. */
  detail?: string
  /** Кнопка действия — обычно «Повторити» или «Скасувати». */
  action?: { label: string; run: () => void }
  /** Мс. 0 — не исчезает сам (для ошибок, требующих решения). */
  timeout?: number
}

type Toast = ToastInput & { id: number; kind: ToastKind }

type Api = {
  push: (t: ToastInput) => void
  success: (text: string, detail?: string) => void
  error: (text: string, detail?: string) => void
  warn: (text: string, detail?: string) => void
  info: (text: string, detail?: string) => void
}

const Ctx = createContext<Api | null>(null)

export function useToast(): Api {
  const api = useContext(Ctx)
  if (!api) {
    // Провайдер стоит в корневом layout, поэтому сюда попасть можно
    // только по ошибке сборки. Падать не будем — вернём заглушку,
    // чтобы не убить весь экран из-за уведомления.
    return {
      push: () => {}, success: () => {}, error: () => {}, warn: () => {}, info: () => {},
    }
  }
  return api
}

const DEFAULT_TIMEOUT: Record<ToastKind, number> = {
  success: 3500,
  info: 4000,
  warn: 6000,
  // Ошибку не прячем по таймеру: её надо прочитать и решить, что делать.
  error: 0,
}

let seq = 0

export function ToastProvider({ children, overlay }: {
  children: React.ReactNode
  /** Полосы, которые живут в том же нижнем стеке: офлайн и установка.
      Рендерятся ВНУТРИ провайдера, поэтому им доступен useToast(). */
  overlay?: React.ReactNode
}) {
  const [items, setItems] = useState<Toast[]>([])

  const remove = useCallback((id: number) => {
    setItems((list) => list.filter((t) => t.id !== id))
  }, [])

  const push = useCallback((input: ToastInput) => {
    const kind = input.kind ?? 'info'
    const id = ++seq
    setItems((list) => [...list.slice(-3), { ...input, kind, id }])
    const timeout = input.timeout ?? DEFAULT_TIMEOUT[kind]
    if (timeout > 0) setTimeout(() => remove(id), timeout)
  }, [remove])

  const api = useMemo<Api>(() => ({
    push,
    success: (text, detail) => push({ kind: 'success', text, detail }),
    error: (text, detail) => push({ kind: 'error', text, detail }),
    warn: (text, detail) => push({ kind: 'warn', text, detail }),
    info: (text, detail) => push({ kind: 'info', text, detail }),
  }), [push])

  return (
    <Ctx.Provider value={api}>
      {children}
      {/* Один стек на всё, что всплывает снизу. Раньше каждая полоса
          позиционировалась сама, и они наезжали друг на друга — та же
          ошибка, что в первой крес-ке с нижней навигацией (урок №8).
          Отступ снизу считает место под плавающую панель: 12px её
          отступ + ~64px высота + запас. */}
      {/* ЯЗЫК НИЖНЕГО СТЕКА (16.08.2026). Провайдер языка стоял только
          в макете кабинета, и всё здешнее — полоса связи, предложение
          установки, биометрия, подпись кнопки «закрити» — говорило
          по-украински даже при русском интерфейсе. Обернуть провайдером
          `{children}` было нельзя: витрина закреплена на украинском
          до переезда на сегмент адреса (`components/shell.tsx`), и её
          клиентские части поехали бы за кукой в обход этого решения.
          Стек — не страница, он один на всё приложение, поэтому язык
          берётся здесь и только для него. Внутри закрытых разделов
          свои макеты ставят провайдер с языком, прочитанным на сервере,
          — тот перекрывает этот для СВОЕГО поддерева, а не для стека. */}
      <RootLangProvider>
        <div
          className="pointer-events-none fixed inset-x-3 z-[60] flex flex-col gap-2 sm:inset-x-auto sm:right-6 sm:w-96"
          style={{ bottom: 'calc(88px + env(safe-area-inset-bottom))' }}
        >
          {overlay}
          <ToastStack items={items} onClose={remove} />
        </div>
      </RootLangProvider>
    </Ctx.Provider>
  )
}

const TONE: Record<ToastKind, { border: string; fg: string; mark: string }> = {
  success: { border: 'var(--color-success)', fg: 'var(--color-success)', mark: '✓' },
  error:   { border: 'var(--color-danger)',  fg: 'var(--color-danger)',  mark: '!' },
  warn:    { border: 'var(--color-warn)',    fg: 'var(--color-warn)',    mark: '!' },
  info:    { border: 'var(--color-accent)',  fg: 'var(--color-accent)',  mark: 'i' },
}

function ToastStack({ items, onClose }: { items: Toast[]; onClose: (id: number) => void }) {
  // Хук зовётся ДО раннего возврата: правила хуков не разрешают иначе.
  const closeLabel = useT()('common.close.aria')
  if (items.length === 0) return null
  return (
    // Снизу и с запасом: на телефоне там плавающая нижняя навигация,
    // и уведомление не должно её закрывать. aria-live — чтобы
    // голосовой доступ прочитал исход, а не промолчал.
    <div role="status" aria-live="polite" className="flex flex-col gap-2">
      {items.map((item) => {
        const tone = TONE[item.kind]
        return (
          <div
            key={item.id}
            className="pointer-events-auto flex items-start gap-3 border p-3.5 rise"
            style={{
              borderRadius: 'var(--radius-card)',
              borderColor: tone.border,
              background: 'var(--color-surface)',
              boxShadow: 'var(--shadow-lift)',
            }}
          >
            <span aria-hidden className="grid shrink-0 place-items-center"
                  style={{
                    width: 22, height: 22, borderRadius: 999, fontSize: 12, fontWeight: 700,
                    color: tone.fg, background: 'color-mix(in srgb, currentColor 16%, transparent)',
                  }}>
              {tone.mark}
            </span>
            <div className="min-w-0 flex-1">
              <p className="t-md">{item.text}</p>
              {item.detail && <p className="t-sm mt-1 break-words prose-muted">{item.detail}</p>}
              {item.action && (
                <button
                  type="button"
                  onClick={() => { item.action!.run(); onClose(item.id) }}
                  className="t-sm mt-2 underline underline-offset-2"
                  style={{ color: tone.fg }}
                >
                  {item.action.label}
                </button>
              )}
            </div>
            <button type="button" onClick={() => onClose(item.id)} aria-label={closeLabel}
                    className="btn-icon shrink-0">
              ✕
            </button>
          </div>
        )
      })}
    </div>
  )
}

/** Хук «есть ли сеть». Отдельно от очереди: им пользуются и формы. */
export function useOnline(): boolean {
  // На сервере считаем, что сеть есть: иначе первый кадр нарисует
  // предупреждение об офлайне всем подряд.
  const [online, setOnline] = useState(true)
  useEffect(() => {
    const set = () => setOnline(navigator.onLine)
    set()
    window.addEventListener('online', set)
    window.addEventListener('offline', set)
    return () => {
      window.removeEventListener('online', set)
      window.removeEventListener('offline', set)
    }
  }, [])
  return online
}
