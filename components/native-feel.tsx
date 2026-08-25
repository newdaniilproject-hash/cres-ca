'use client'

import { useEffect, useRef, useTransition } from 'react'
import { useRouter } from 'next/navigation'
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
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  // Кружок жеста живёт между отрисовками: его создаёт обработчик касания,
  // а убирает эффект, когда обновление закончилось. Локальной переменной
  // внутри useEffect тут уже мало.
  const barRef = useRef<HTMLDivElement | null>(null)

  // Обновление закончилось — снимаем кружок. Отдельным эффектом, потому
  // что момент окончания знает React, а не обработчик касания.
  useEffect(() => {
    if (pending) return
    barRef.current?.remove()
    barRef.current = null
  }, [pending])

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
    //
    // ⚠️ ОБНОВЛЯЕМ ЧЕРЕЗ `router.refresh()`, А НЕ `location.reload()`.
    // Полная перезагрузка сносит документ целиком: всё, что появляется
    // анимацией `.rise`, начинается с нулевой прозрачности, и человек
    // на полсекунды видит голый фон. Владелец описал это как «экран
    // темнеет на секунду, а должно быть бесшовно» (18.08.2026) — и это
    // точное описание того, что делал код.
    //
    // `router.refresh()` перезапрашивает серверную часть и подменяет
    // содержимое НА МЕСТЕ: узлы не пересоздаются, анимации не стартуют
    // заново, прокрутка остаётся где была. Кружок крутится, пока идёт
    // переход, — его снимает эффект выше по `pending`.
    //
    // Новую СБОРКУ этот путь не подтянет: бандл остаётся прежним. Так и
    // задумано — про новую версию сообщает своё уведомление из
    // `components/pwa.tsx`, и вот у него перезагрузка полная и уместная.
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

    // ── ПОД ОТКРЫТЫМ СЛОЕМ ЖЕСТА НЕТ ─────────────────────────────────
    //
    // Отзыв владельца 25.08.2026: «если у человека открыта шторка,
    // верхняя или нижняя, то обновление страницы потянуть пальцем вниз
    // не должно срабатывать, потому что иначе срабатывают два действия».
    //
    // Так и было: шторка ловит тот же жест «вниз» как закрытие
    // (components/sheet.tsx), а этот обработчик — как обновление.
    // Одно движение пальца делало две вещи сразу, и обе наполовину.
    //
    // Проверяем НАЛИЧИЕ СЛОЯ в документе, а не свой флаг состояния:
    // слоёв уже три (шторка, стос действий, сканер), и они открываются
    // из разных мест. Флаг пришлось бы ставить в каждом, и первый же
    // забытый вернул бы ошибку молча. Разметка — общий признак, и она
    // не устаревает: новый слой попадёт под правило, если получит
    // роль диалога или один из этих классов.
    const overlayOpen = () =>
      document.querySelector('.sheet-layer, .fab-scrim, [role="dialog"]') !== null

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      if (overlayOpen()) return
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
        barRef.current = bar
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
        // Кружок возвращается наверх сам: пока он висел на пальце,
        // `transform` держал его смещение, и без сброса он остался бы
        // болтаться посреди экрана на всё время обновления.
        if (bar) { bar.style.transform = 'translateY(0)'; bar.style.opacity = '1' }
        haptic.select()
        startTransition(() => router.refresh())
        bar = null
        return
      }
      bar?.remove()
      bar = null
      barRef.current = null
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
      // Через `barRef`, а не через `bar`: после запуска обновления
      // локальная переменная обнулена, а узел ещё висит на странице.
      barRef.current?.remove()
      barRef.current = null
      bar?.remove()
    }
    // Слушатели ставятся один раз на всё время жизни приложения.
    // `router` и `startTransition` в Next стабильны между отрисовками.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return null
}
