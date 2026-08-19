'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '@/lib/i18n/client'

// Шторка снизу. В приложении окно посреди экрана — чужой элемент:
// нативные экраны показывают дополнительное содержимое снизу, оттуда,
// куда дотягивается большой палец.
//
// Что здесь обязательно и почему:
//  • Тянется пальцем. Шторка, которую нельзя стянуть вниз, читается как
//    картинка окна, а не как шторка. Порог — треть высоты либо резкий
//    рывок; иначе она возвращается на место с пружиной.
//  • Пока тянут, палец не должен прокручивать содержимое под шторкой,
//    поэтому body фиксируется на время показа.
//  • Высота в dvh и запас под клавиатуру (--kb): в шторке бывают поля,
//    и кнопка «Зберегти» обязана оставаться видимой.
//  • Отклик: лёгкий щелчок при открытии и при закрытии жестом.
//
// В обычном браузере это тоже работает и выглядит уместно — на телефоне
// сайт ведёт себя так же. Отдельного «вебового» вида не заводим.
export function Sheet({
  open,
  onClose,
  title,
  footer,
  children,
}: {
  open: boolean
  onClose: () => void
  title?: string
  /** Прижатая к низу полоса действий: не уезжает вместе с содержимым. */
  footer?: React.ReactNode
  children: React.ReactNode
}) {
  const t = useT()
  const panel = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState(0)
  const start = useRef<{ y: number; t: number } | null>(null)

  const close = useCallback(() => onClose(), [onClose])

  // Пока шторка открыта — страница под ней неподвижна. Иначе палец,
  // не попавший в шторку, прокручивает список за ней, и это выглядит
  // как поломка.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  useEffect(() => { if (!open) setDrag(0) }, [open])

  // Шторка рисуется В BODY, а не там, где её позвали. Причина найдена
  // 19.08.2026 по отзыву владельца «кнопка уведомления в хедере не
  // работает, сломана»: колокол стоит внутри `.apphead`, а у той
  // `backdrop-filter: blur(12px)` — и любой элемент с `position: fixed`
  // внутри такого предка считает координаты ОТ НЕГО, а не от окна
  // (то же делают transform и filter). Шторка честно открывалась, но
  // «внизу шапки», то есть полоской в пятьдесят пикселей под значками,
  // а затемнение накрывало одну шапку. Нажатие выглядело как ничего.
  //
  // Портал снимает весь класс этой ошибки разом, а не один её случай:
  // любая будущая шторка внутри липкой панели, карточки с тенью или
  // анимированного блока попадёт в ту же ловушку, и искать её будут
  // так же долго. Позиция в дереве React (и вместе с ней контекст,
  // события и язык) при этом сохраняется — портал меняет только
  // место в DOM.
  const [host, setHost] = useState<HTMLElement | null>(null)
  useEffect(() => { setHost(document.body) }, [])

  function onTouchStart(e: React.TouchEvent) {
    // Тянуть можно только когда содержимое прокручено в самый верх:
    // иначе жест «вниз» — это прокрутка списка, а не закрытие.
    if ((scroller.current?.scrollTop ?? 0) > 0) return
    start.current = { y: e.touches[0].clientY, t: Date.now() }
  }

  function onTouchMove(e: React.TouchEvent) {
    if (!start.current) return
    const dy = e.touches[0].clientY - start.current.y
    if (dy <= 0) { setDrag(0); return }
    // Сопротивление: шторка идёт за пальцем медленнее, и жест ощущается
    // как физический, а не как перетаскивание слоя.
    setDrag(dy < 120 ? dy : 120 + (dy - 120) * 0.35)
  }

  function onTouchEnd() {
    const s = start.current
    start.current = null
    if (!s) return
    const h = panel.current?.offsetHeight ?? 400
    const fast = Date.now() - s.t < 260 && drag > 60
    if (drag > h / 3 || fast) { close(); return }
    setDrag(0)
  }

  if (!open || !host) return null

  return createPortal(
    <div className="sheet-layer" role="dialog" aria-modal="true" aria-label={title}>
      <button
        type="button"
        aria-label={t('common.close.aria')}
        className="sheet-backdrop"
        style={{ opacity: Math.max(0, 1 - drag / 260) }}
        onClick={close}
      />
      <div
        ref={panel}
        className="sheet"
        style={{
          transform: drag ? `translateY(${drag}px)` : undefined,
          transition: start.current ? 'none' : undefined,
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      >
        <div className="sheet-grip" aria-hidden />
        {title && <h2 className="display t-xl mb-4 mt-1">{title}</h2>}
        <div ref={scroller} className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>,
    host,
  )
}
