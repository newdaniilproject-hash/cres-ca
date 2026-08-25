'use client'

import { useRef, useState } from 'react'

// ── Строка со скрытыми действиями ───────────────────────────────────────────
//
// Заведена 20.08.2026: действие над позицией не должно стоить перехода
// в карточку и возврата обратно. Мастер держит банку в руке — «списати»
// обязано быть одним движением по строке, а не тремя экранами.
//
// ЧТО ЗДЕСЬ ОБЯЗАТЕЛЬНО И ПОЧЕМУ:
//
//  • `touch-action: pan-y` на обёртке (globals.css, `.swipe-row`), а НЕ
//    `preventDefault` в обработчике. React вешает `touchmove` пассивным
//    слушателем, и `preventDefault` там молча не работает — жест бы
//    конкурировал с прокруткой списка. Правило CSS решает это до
//    JavaScript: браузер сам не даёт горизонтальной прокрутки и
//    сохраняет вертикальную.
//  • Ось выбирается ОДИН раз за жест. Пока `axis` не решена, палец
//    может уйти и вбок, и вниз; после решения строка либо едет, либо
//    не мешает списку прокручиваться. Без этого список «залипает»
//    на каждом наклонном движении.
//  • Открывается только ВЛЕВО. Жест «назад» в оболочке идёт вправо
//    от края (`components/swipe-back.tsx`), и ловить оба направления
//    значило бы отнять у человека выход с экрана.
//  • Ширина полосы действий МЕРЯЕТСЯ, а не считается по числу кнопок:
//    иначе ширина кнопки живёт и в CSS, и здесь, и расходится молча.
//  • Пока строка открыта, нажатие по её лицевой части ЗАКРЫВАЕТ её,
//    а не открывает карточку: иначе человек, сдвинувший строку и
//    передумавший, проваливается в переход, которого не просил.
export type SwipeAction = {
  key: string
  label: string
  icon: React.ComponentType<{ size?: number }>
  tone?: 'blue' | 'emerald' | 'amber' | 'violet' | 'rose'
  onSelect: () => void
}

export function SwipeRow({
  actions, children,
}: {
  actions: SwipeAction[]
  children: React.ReactNode
}) {
  const [dx, setDx] = useState(0)
  const [open, setOpen] = useState(false)
  const shelf = useRef<HTMLDivElement>(null)
  const start = useRef<{ x: number; y: number; base: number } | null>(null)
  const axis = useRef<'none' | 'x' | 'y'>('none')
  // Текущий сдвиг ЕЩЁ И ССЫЛКОЙ, а не только состоянием. Состояние React
  // обновляет пакетом, и последний `touchmove` с `touchend` вполне могут
  // попасть в один пакет — тогда обработчик конца жеста читает НОЛЬ,
  // решает «не дотянул» и возвращает строку на место. Жест при этом
  // выглядит как «иногда не срабатывает», а воспроизводится только
  // на быстром движении пальцем.
  const offset = useRef(0)

  // Без действий это обычная строка: обёртку и слушатели заводить незачем.
  if (actions.length === 0) return <>{children}</>

  const shelfWidth = () => shelf.current?.offsetWidth ?? 0

  function slide(next: number) {
    offset.current = next
    setDx(next)
  }

  function onTouchStart(e: React.TouchEvent) {
    start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, base: open ? -shelfWidth() : 0 }
    axis.current = 'none'
  }

  function onTouchMove(e: React.TouchEvent) {
    const s = start.current
    if (!s) return
    const mx = e.touches[0].clientX - s.x
    const my = e.touches[0].clientY - s.y
    if (axis.current === 'none') {
      // Порог в 8px: без него любое дрожание пальца при прокрутке
      // объявляло бы жест горизонтальным.
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return
      axis.current = Math.abs(mx) > Math.abs(my) ? 'x' : 'y'
    }
    if (axis.current !== 'x') return
    const w = shelfWidth()
    const next = s.base + mx
    // Влево — до ширины полки, дальше сопротивление; вправо дальше
    // закрытого положения строка не едет вовсе.
    slide(next > 0 ? 0 : next < -w ? -w - (Math.abs(next) - w) * 0.2 : next)
  }

  function onTouchEnd() {
    const decided = axis.current === 'x'
    start.current = null
    axis.current = 'none'
    if (!decided) return
    const w = shelfWidth()
    const willOpen = Math.abs(offset.current) > w / 2
    setOpen(willOpen)
    slide(willOpen ? -w : 0)
  }

  function close() { setOpen(false); slide(0) }

  return (
    <div className="swipe-row"
         onTouchStart={onTouchStart}
         onTouchMove={onTouchMove}
         onTouchEnd={onTouchEnd}
         onTouchCancel={onTouchEnd}>
      {/* Полка действий лежит ПОД лицевой частью и видна ровно настолько,
          насколько та сдвинута. `aria-hidden` пока строка закрыта: для
          читалки экрана это не элементы управления, а состояние жеста —
          сами действия ей доступны на карточке позиции. */}
      <div ref={shelf} className="swipe-actions" aria-hidden={!open}>
        {actions.map((a) => (
          <button key={a.key} type="button" className="swipe-action" data-tone={a.tone ?? 'blue'}
                  tabIndex={open ? 0 : -1}
                  onClick={() => { close(); a.onSelect() }}>
            <span aria-hidden><a.icon size={18} /></span>
            {a.label}
          </button>
        ))}
      </div>

      <div className="swipe-face"
           style={{
             transform: dx ? `translateX(${dx}px)` : undefined,
             // Пока палец на экране — без плавности: иначе строка
             // тянется за пальцем с задержкой и жест ощущается вязким.
             transition: start.current ? 'none' : undefined,
           }}
           onClickCapture={(e) => {
             if (!open) return
             e.preventDefault()
             e.stopPropagation()
             close()
           }}>
        {children}
      </div>
    </div>
  )
}
