'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { flush, list, drop, onQueueChange, type QueuedRecord } from '@/lib/offline/queue'
import { useOnline, useToast } from '@/components/toast'
import { useT } from '@/lib/i18n/client'

// Полоса состояния связи и очереди.
//
// Требование, ради которого это существует: непонятных состояний быть
// не должно. Мастер в любой момент видит одно из трёх:
//   • сеть есть, очередь пуста     — ничего не показываем, всё в порядке;
//   • сети нет                     — жёлтая полоса «працюємо офлайн»;
//   • есть отложенные действия     — сколько именно и кнопка «надіслати».
//
// Полоса живёт снизу и над нижней навигацией, потому что телефон мастер
// держит одной рукой, а верх экрана занят шапкой.

export function OfflineBar() {
  const t = useT()
  const online = useOnline()
  const toast = useToast()
  const [items, setItems] = useState<QueuedRecord[]>([])
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)

  const reload = useCallback(() => { void list().then(setItems) }, [])

  useEffect(() => {
    reload()
    return onQueueChange(reload)
  }, [reload])

  const sync = useCallback(async (silent: boolean) => {
    if (busy) return
    const pending = await list()
    if (pending.length === 0) return
    setBusy(true)
    const res = await flush(createClient())
    setBusy(false)
    reload()
    if (res.sent > 0) {
      toast.success(
        t.plural('offline.sent', res.sent),
        t('offline.sent.detail'),
      )
    }
    if (res.failed > 0 && !silent) {
      // Второй строкой — текст отказа базы, он показывается как есть.
      toast.error(
        t.plural('offline.failed', res.failed),
        res.errors[0],
      )
    }
  }, [busy, reload, toast, t])

  // Появилась сеть — отправляем сами и молча, если всё прошло.
  // Просить человека нажать кнопку после каждого лифта — издевательство.
  useEffect(() => {
    if (online) void sync(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online])

  // Вернулись во вкладку — тоже пробуем: браузер на телефоне часто
  // усыпляет страницу и события «online» не даёт.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible' && navigator.onLine) void sync(true) }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Предупреждаем перед закрытием вкладки, если что-то не отправлено.
  useEffect(() => {
    if (items.length === 0) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [items.length])

  if (online && items.length === 0) return null

  const tone = !online
    ? { bg: 'var(--color-warn-soft)', fg: 'var(--color-warn)', text: t('offline.status.offline') }
    : { bg: 'var(--color-accent-soft)', fg: 'var(--color-accent)', text: t('offline.status.pending') }

  return (
    <div
      className="pointer-events-auto border backdrop-blur-xl"
      style={{
        borderRadius: 'var(--radius-card)',
        borderColor: tone.fg,
        background: 'color-mix(in srgb, var(--color-surface) 92%, transparent)',
        boxShadow: 'var(--shadow-lift)',
      }}
    >
      <div className="flex items-center gap-3 p-3">
        <span aria-hidden className="grid shrink-0 place-items-center"
              style={{ width: 24, height: 24, borderRadius: 999, background: tone.bg, color: tone.fg, fontSize: 12 }}>
          {online ? '↑' : '⚡'}
        </span>
        <div className="min-w-0 flex-1">
          <p className="t-md">{tone.text}</p>
          <p className="t-sm mt-0.5 prose-muted">
            {items.length > 0
              ? t.plural('offline.waiting', items.length)
              : t('offline.hint')}
          </p>
        </div>
        {items.length > 0 && (
          <div className="flex shrink-0 gap-2">
            <button type="button" onClick={() => setOpen((v) => !v)}
                    className="btn-ghost t-sm">
              {open ? t('offline.hide') : t('offline.show')}
            </button>
            {online && (
              <button type="button" onClick={() => void sync(false)} disabled={busy}
                      className="btn-primary t-sm">
                {busy ? t('offline.sending') : t('offline.send')}
              </button>
            )}
          </div>
        )}
      </div>

      {open && items.length > 0 && (
        <div className="border-t px-3 pb-3" style={{ borderColor: 'var(--color-border)' }}>
          {items.map((r) => (
            <div key={r.id} className="row">
              <div className="min-w-0">
                <p className="t-md truncate">{r.label}</p>
                <p className="t-sm mt-0.5 prose-muted">
                  {t.dateTime(r.at, {
                    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                  })}
                  {/* `lastError` — текст отказа базы, он идёт как есть. */}
                  {r.lastError ? ` · ${t('offline.error', { message: r.lastError })}` : ''}
                </p>
              </div>
              {/* Отменить можно только то, что уже не проходит: иначе
                  мастер случайно выбросит запись, которая просто ждёт сети. */}
              {r.lastError && (
                <button type="button" className="btn-ghost shrink-0 t-sm"
                        onClick={() => { void drop(r.id) }}>
                  {t('offline.drop')}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Своей `plural` здесь больше нет: правило выбора формы живёт
// в `lib/i18n/format.ts`, и вызывается через `t.plural`. Вторая копия
// правила разъехалась бы с первой на первой же правке — а с русским
// и английским разъехалась бы сразу.
