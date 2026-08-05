'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// Уведомление, пришедшее, пока приложение открыто.
//
// Система такие не показывает: пуш, доставленный в приложение на
// переднем плане, по умолчанию проглатывается. Именно поэтому Instagram
// и Telegram рисуют свою полоску сверху — иначе человек, сидящий
// в приложении, узнаёт о новом заказе последним.
//
// Откуда прилетает:
//   iOS     — @capacitor/push-notifications, событие pushNotificationReceived
//             (мост есть);
//   Android — MainActivity перехватывает OneSignal в foreground и шлёт
//             в веб событие 'cres:notify' (моста Capacitor при удалённом
//             server.url нет — grabли DaKi);
//   веб     — то же событие может послать любой код приложения.
// Все три пути сходятся в одном обработчике.
//
// Поведение полоски: выезжает сверху под вырез, живёт 5 секунд, уходит
// свайпом вверх или по тапу (тап ведёт туда, куда указывает уведомление).
// Отклик — один короткий щелчок: уведомление сообщает, а не требует.

type Note = {
  id: number
  title: string
  body?: string
  href?: string
}

type PushPayload = {
  title?: string
  body?: string
  data?: { url?: string; href?: string }
  additionalData?: { url?: string; href?: string }
}

const LIFE_MS = 5000

export function NotifyBanner() {
  const [notes, setNotes] = useState<Note[]>([])
  const seq = useRef(0)
  const dragY = useRef(0)
  const startY = useRef<number | null>(null)
  const [offset, setOffset] = useState(0)

  const drop = useCallback((id: number) => {
    setNotes((v) => v.filter((n) => n.id !== id))
    setOffset(0)
  }, [])

  const push = useCallback((title: string, body?: string, href?: string) => {
    if (!title) return
    const id = ++seq.current
    // Одна полоска за раз: стопка уведомлений поверх содержимого —
    // это уже не сообщение, а помеха.
    setNotes([{ id, title, body, href }])
    setTimeout(() => drop(id), LIFE_MS)
  }, [drop])

  useEffect(() => {
    // Общий вход: любое место приложения может показать полоску,
    // послав событие. Через него же приходит Android.
    const onEvent = (e: Event) => {
      const d = (e as CustomEvent).detail as Note | string | undefined
      if (!d) return
      if (typeof d === 'string') { push(d); return }
      push(d.title, d.body, d.href)
    }
    window.addEventListener('cres:notify', onEvent)

    // iOS. Пуши там идут через onesignal-cordova-plugin (v5), а не через
    // @capacitor/push-notifications, поэтому слушаем его событие
    // foregroundWillDisplay. preventDefault гасит системную шторку:
    // своя полоска уже показана, две подряд — шум.
    //
    // На Android этого кода нет и быть не может — моста Capacitor при
    // удалённом server.url нет. Там перехват делает MainActivity
    // и присылает то же самое событие 'cres:notify'.
    const w = window as unknown as {
      Capacitor?: { isNativePlatform?: () => boolean }
      plugins?: {
        OneSignal?: {
          Notifications?: {
            addEventListener?: (
              name: string,
              cb: (e: { preventDefault?: () => void; notification?: PushPayload }) => void,
            ) => void
            removeEventListener?: (name: string, cb: unknown) => void
          }
        }
      }
    }

    const onForeground = (e: { preventDefault?: () => void; notification?: PushPayload }) => {
      const n = e.notification ?? {}
      const extra = n.additionalData ?? n.data
      try { e.preventDefault?.() } catch { /* необязательно */ }
      push(n.title ?? 'Маркет', n.body, extra?.url ?? extra?.href)
    }

    // Тап по уведомлению из системной шторки. Без этого пуш открывает
    // просто приложение — на том экране, где его закрыли, — и человек
    // сам ищет, о каком заказе речь. На Android то же самое делает
    // addClickListener в MainActivity.
    const onClick = (e: { notification?: PushPayload }) => {
      const extra = e.notification?.additionalData ?? e.notification?.data
      const href = extra?.url ?? extra?.href
      if (href && href.startsWith('/')) window.location.assign(href)
    }

    const os = w.Capacitor?.isNativePlatform?.() ? w.plugins?.OneSignal : undefined
    try { os?.Notifications?.addEventListener?.('foregroundWillDisplay', onForeground) }
    catch { /* пуш не должен ронять экран */ }
    try { os?.Notifications?.addEventListener?.('click', onClick) }
    catch { /* ignore */ }

    return () => {
      window.removeEventListener('cres:notify', onEvent)
      try { os?.Notifications?.removeEventListener?.('foregroundWillDisplay', onForeground) }
      catch { /* ignore */ }
      try { os?.Notifications?.removeEventListener?.('click', onClick) }
      catch { /* ignore */ }
    }
  }, [push])

  if (notes.length === 0) return null
  const n = notes[0]

  return (
    <div className="notify-layer">
      <div
        className="notify"
        style={{ transform: offset ? `translateY(${offset}px)` : undefined,
                 transition: startY.current !== null ? 'none' : undefined }}
        onTouchStart={(e) => { startY.current = e.touches[0].clientY; dragY.current = 0 }}
        onTouchMove={(e) => {
          if (startY.current === null) return
          const dy = e.touches[0].clientY - startY.current
          dragY.current = dy
          setOffset(dy < 0 ? dy : dy * 0.25)
        }}
        onTouchEnd={() => {
          const dy = dragY.current
          startY.current = null
          if (dy < -30) drop(n.id); else setOffset(0)
        }}
        onClick={() => {
          if (n.href) window.location.href = n.href
          drop(n.id)
        }}
        role={n.href ? 'link' : 'status'}
      >
        <span className="notify-dot" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="t-md block truncate">{n.title}</span>
          {n.body && (
            <span className="t-sm mt-0.5 block" style={{ color: 'var(--color-muted)' }}>
              {n.body}
            </span>
          )}
        </span>
      </div>
    </div>
  )
}

// Показать полоску из любого места приложения, не таща сюда импорт
// провайдера. Пример: после ответа сервера о новой записи.
export function notifyInApp(title: string, body?: string, href?: string) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('cres:notify', { detail: { title, body, href } }))
}
