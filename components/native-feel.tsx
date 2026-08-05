'use client'

import { useEffect } from 'react'
import { haptic } from '@/lib/haptic'

// Повадки, которых человек не замечает, пока их нет, и замечает сразу,
// когда их нет. Собраны в одном месте, а не размазаны по экранам —
// иначе на одном экране они есть, на другом забыты, и это заметнее,
// чем полное отсутствие.
//
// Что здесь:
//   1. Тап мимо поля закрывает клавиатуру.
//   2. Потянуть список вниз — обновить (pull to refresh).
//   3. Появление экрана — коротким сдвигом, а не мгновенной подменой.
export function NativeFeel() {
  useEffect(() => {
    if (typeof document === 'undefined') return
    if (!document.documentElement.hasAttribute('data-native')) return

    // ── 1. Тап мимо поля убирает клавиатуру ──────────────────────
    // В вебе клавиатура висит, пока не нажмёшь «Готово» или другое
    // поле. В приложении так себя не ведёт ничего: тапнул по пустому
    // месту — клавиатура ушла.
    const onTouch = (e: TouchEvent) => {
      const t = e.target as HTMLElement | null
      if (!t) return
      if (t.closest('input, textarea, select, [contenteditable="true"], label, button, a')) return
      const active = document.activeElement as HTMLElement | null
      if (!active) return
      const tag = active.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || active.isContentEditable) active.blur()
    }
    document.addEventListener('touchstart', onTouch, { passive: true })

    // ── 2. Потянуть вниз — обновить ──────────────────────────────
    // Работает только когда список уже прокручен в самый верх,
    // иначе жест «вниз» — это обычная прокрутка.
    let startY = 0
    let pulling = false
    let dist = 0
    let armed = false
    let bar: HTMLDivElement | null = null

    const scroller = (el: HTMLElement | null): HTMLElement | null => {
      let n: HTMLElement | null = el
      while (n && n !== document.body) {
        const s = getComputedStyle(n)
        if (/(auto|scroll)/.test(s.overflowY)) return n
        n = n.parentElement
      }
      return document.scrollingElement as HTMLElement | null
    }

    const THRESHOLD = 72

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      const sc = scroller(e.target as HTMLElement)
      if (!sc || sc.scrollTop > 0) return
      startY = e.touches[0].clientY
      pulling = true
      dist = 0
      armed = false
    }

    const onMove = (e: TouchEvent) => {
      if (!pulling) return
      const dy = e.touches[0].clientY - startY
      if (dy <= 0) { dist = 0; if (bar) bar.style.transform = 'translateY(-100%)'; return }
      // Сопротивление: тянется вдвое медленнее пальца.
      dist = Math.min(dy * 0.5, 110)
      if (!bar) {
        bar = document.createElement('div')
        bar.className = 'pull-refresh'
        bar.innerHTML = '<span class="pull-spinner"></span>'
        document.body.appendChild(bar)
      }
      bar.style.transform = `translateY(${dist - 44}px)`
      bar.style.opacity = String(Math.min(1, dist / THRESHOLD))
      if (!armed && dist > THRESHOLD) { armed = true; haptic.tap() }
      if (armed) bar.classList.add('ready'); else bar.classList.remove('ready')
    }

    const onEnd = () => {
      if (!pulling) return
      pulling = false
      if (armed) {
        bar?.classList.add('spinning')
        haptic.select()
        setTimeout(() => window.location.reload(), 180)
        return
      }
      bar?.remove()
      bar = null
    }

    document.addEventListener('touchstart', onStart, { passive: true })
    document.addEventListener('touchmove', onMove, { passive: true })
    document.addEventListener('touchend', onEnd, { passive: true })
    document.addEventListener('touchcancel', onEnd, { passive: true })

    return () => {
      document.removeEventListener('touchstart', onTouch)
      document.removeEventListener('touchstart', onStart)
      document.removeEventListener('touchmove', onMove)
      document.removeEventListener('touchend', onEnd)
      document.removeEventListener('touchcancel', onEnd)
      bar?.remove()
    }
  }, [])

  return null
}
