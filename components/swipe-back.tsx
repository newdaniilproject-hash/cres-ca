'use client'

import { useEffect } from 'react'
import { haptic } from '@/lib/haptic'

// Свайп назад от левого края. На iOS это жест, которым пользуются,
// не задумываясь; его отсутствие — первое, по чему человек понимает,
// что перед ним не приложение.
//
// Почему пишем руками, а не берём системный: приложение — оболочка над
// удалённым адресом, вся навигация внутри одного WebView. Системный
// жест листал бы историю самого WebView только на Android (там он
// назначен кнопке «назад» в MainActivity) и не работал бы на iOS вовсе.
//
// Правила, без которых жест мешает вместо помощи:
//  • Начинается ТОЛЬКО у самого края (24px). Иначе он крадёт
//    горизонтальную прокрутку у каруселей и таблиц.
//  • Вертикальное движение отменяет жест: человек листает список.
//  • Порог — треть ширины либо быстрый рывок. Не дотянул — страница
//    возвращается на место.
//  • Если возвращаться некуда, жест не показывается вообще: пустой
//    отклик хуже отсутствующего.
//  • Отклик пальцу в момент, когда переход стал неизбежен.
export function SwipeBack() {
  useEffect(() => {
    if (typeof document === 'undefined') return
    if (!document.documentElement.hasAttribute('data-native')) return

    const EDGE = 24
    const el = document.body
    let x0 = 0
    let y0 = 0
    let dx = 0
    let t0 = 0
    let active = false
    let armed = false   // порог пройден, отклик уже дали

    const paint = (v: number) => {
      el.style.transform = v ? `translateX(${v}px)` : ''
      el.style.transition = 'none'
    }

    const reset = (animate: boolean) => {
      el.style.transition = animate ? 'transform var(--dur-base) var(--ease-out-soft)' : 'none'
      el.style.transform = ''
      active = false
      armed = false
      dx = 0
    }

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      const t = e.touches[0]
      if (t.clientX > EDGE) return
      // Возвращаться некуда — жеста нет.
      if (window.history.length <= 1) return
      x0 = t.clientX; y0 = t.clientY; t0 = Date.now()
      active = true; armed = false; dx = 0
    }

    const onMove = (e: TouchEvent) => {
      if (!active) return
      const t = e.touches[0]
      const mx = t.clientX - x0
      const my = t.clientY - y0
      // Ушли вертикально — это прокрутка, отдаём жест списку.
      if (Math.abs(my) > Math.abs(mx) && Math.abs(my) > 12) { reset(true); return }
      if (mx <= 0) { dx = 0; paint(0); return }
      dx = mx
      const need = window.innerWidth / 3
      if (!armed && dx > need) { armed = true; haptic.tap() }
      // Сопротивление после порога: дальше страница идёт медленнее,
      // и становится понятно, что переход уже состоится.
      paint(dx > need ? need + (dx - need) * 0.4 : dx)
      // Пока тянем — не даём странице прокручиваться боком.
      if (e.cancelable) e.preventDefault()
    }

    const onEnd = () => {
      if (!active) return
      const fast = Date.now() - t0 < 300 && dx > 60
      const far = dx > window.innerWidth / 3
      if (far || fast) {
        // Страница доезжает до края и только потом уходит назад —
        // иначе видно мгновенную подмену содержимого.
        el.style.transition = 'transform var(--dur-exit) var(--ease-out-soft)'
        el.style.transform = `translateX(${window.innerWidth}px)`
        setTimeout(() => { el.style.transition = 'none'; el.style.transform = ''; window.history.back() }, 130)
        active = false; armed = false; dx = 0
        return
      }
      reset(true)
    }

    document.addEventListener('touchstart', onStart, { passive: true })
    document.addEventListener('touchmove', onMove, { passive: false })
    document.addEventListener('touchend', onEnd, { passive: true })
    document.addEventListener('touchcancel', onEnd, { passive: true })
    return () => {
      document.removeEventListener('touchstart', onStart)
      document.removeEventListener('touchmove', onMove)
      document.removeEventListener('touchend', onEnd)
      document.removeEventListener('touchcancel', onEnd)
      reset(false)
    }
  }, [])

  return null
}
