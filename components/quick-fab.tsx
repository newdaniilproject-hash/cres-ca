'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { IconPlus } from '@/components/icons'
import { useT } from '@/lib/i18n/client'

// ── Плавающая кнопка со СТОСОМ быстрых действий ─────────────────────────────
//
// Заведена 20.08.2026 по референсам владельца: у экрана одно плавающее
// действие, и оно раскрывается в подписанные пункты, а не ведёт сразу
// в одно из них.
//
// Зачем это вообще, кроме вида. На складе ряд плиток «Швидкі дії» стоял
// ПОСТОЯННО и занимал полосу первого экрана, хотя нужен на секунду —
// и при этом главное действие («+ Засіб») лежало отдельной плавающей
// кнопкой, то есть входов в операции склада было два в двух разных
// местах одного экрана. Стос сводит их в один орган управления: ряд
// плиток с экрана уходит, первый экран отдаётся числам и списку.
//
// Правила, без которых это ломается:
//
//  • ОДНО действие — не меню. Если пункт всего один, рисуется широкая
//    кнопка с его подписью (`.fab-wide`): раскрывать «меню» из одного
//    пункта — лишнее нажатие на пустом месте.
//  • ПОДПИСИ ОБЯЗАТЕЛЬНЫ. Безымянный значок в стосе — ребус: «плюс
//    в кружке» на складе может означать и приёмку, и новый засіб,
//    и розлив.
//  • Кнопка остаётся НАД затемнением (`.fab-open`), иначе стос нельзя
//    закрыть тем же нажатием, которым его открыли.
//  • Пункты появляются снизу вверх с задержкой по одному: так видно,
//    что раскрылся ОДИН орган управления, а не всплыло меню. Задержка
//    считается от НИЖНЕГО пункта — он ближе всех к кнопке.
//
// Отклика (haptic) здесь нет намеренно: бриф владельца прямо запрещает
// микро-отклик на каждое действие — мастера работают в спешке между
// клиентами.
export type QuickAction = {
  /** Ключ для React и для `data-`: подпись переводится и ключом быть не может. */
  key: string
  label: string
  icon: React.ComponentType<{ size?: number }>
  /**
   * Только `accent`, и только у ГЛАВНОГО действия вкладки.
   * Цвет в этом продукте означает состояние; раскрасить пять пунктов
   * стоса в пять тонов значит сказать цветом то, чего он не значит
   * (постоянное ограничение системы из брифа владельца).
   */
  tone?: 'accent'
  href?: string
  onClick?: () => void
  /** Печать наклеек открывается новой вкладкой — там лист на принтер. */
  blank?: boolean
}

export function QuickFab({ actions }: { actions: QuickAction[] }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const first = useRef<HTMLAnchorElement | HTMLButtonElement | null>(null)

  // Закрытие с клавиатуры. Стос — всплывающий слой, и оставлять его
  // открытым после Escape значит запереть человека в нём на десктопе.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // Курсор — на ближний к кнопке пункт, после того как стос отрисовался.
  useEffect(() => {
    if (!open) return
    const id = setTimeout(() => first.current?.focus(), 60)
    return () => clearTimeout(id)
  }, [open])

  if (actions.length === 0) return null

  // Один пункт — не меню, а кнопка с его подписью.
  if (actions.length === 1) {
    const a = actions[0]
    return a.href
      ? <Link href={a.href} className="fab-wide lg:hidden"
              {...(a.blank ? { target: '_blank', rel: 'noreferrer' } : {})}>{a.label}</Link>
      : <button type="button" className="fab-wide lg:hidden" onClick={a.onClick}>{a.label}</button>
  }

  return (
    <>
      {open && (
        <button type="button" aria-label={t('common.close.aria')}
                className="fab-scrim lg:hidden" onClick={() => setOpen(false)} />
      )}

      {open && (
        <div className="fab-stack lg:hidden" role="menu">
          {actions.map((a, i) => {
            // Ближний к кнопке пункт — ПОСЛЕДНИЙ в разметке, и появляется
            // первым: стос растёт вверх от кнопки, а не сверху вниз.
            const delay = `${(actions.length - 1 - i) * 30}ms`
            const last = i === actions.length - 1
            const inner = (
              <>
                <span aria-hidden className="fab-item-icon" data-tone={a.tone}>
                  <a.icon size={16} />
                </span>
                {a.label}
              </>
            )
            const common = {
              className: 'fab-item',
              style: { animationDelay: delay },
              role: 'menuitem' as const,
              onClick: () => setOpen(false),
            }
            return a.href
              ? <Link key={a.key} href={a.href} {...common}
                      ref={last ? (n) => { first.current = n } : undefined}
                      {...(a.blank ? { target: '_blank', rel: 'noreferrer' } : {})}>
                  {inner}
                </Link>
              : <button key={a.key} type="button" {...common}
                        ref={last ? (n) => { first.current = n } : undefined}
                        onClick={() => { setOpen(false); a.onClick?.() }}>
                  {inner}
                </button>
          })}
        </div>
      )}

      <button
        type="button"
        className={`fab lg:hidden${open ? ' fab-open' : ''}`}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={t(open ? 'common.close.aria' : 'app.quick.open')}
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden className="fab-turn" data-open={open}>
          <IconPlus size={24} />
        </span>
      </button>
    </>
  )
}
