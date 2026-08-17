'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { ORDER_STATUSES, orderBadge, orderLabel } from '../orders-client'
import { useT } from '@/lib/i18n/client'
import type { T } from '@/lib/i18n/translate'
import { dbErrorText } from '@/lib/errors/db'

export type OrderItem = {
  id: string; title: string; variant: string; price: number; qty: number
}

export type OrderEvent = {
  id: string; from: string | null; to: string
  note: string | null; actor: string | null; at: string
}

export type OrderCard = {
  id: string; number: number; status: string
  name: string; phone: string | null; email: string | null; guest: boolean
  deliveryMethod: string | null; deliveryCity: string | null
  deliveryBranch: string | null; deliveryAddress: string | null
  tracking: string | null
  comment: string | null; cancelReason: string | null
  subtotal: number; discount: number; total: number; paid: number
  source: string; createdAt: string
}

// Подписи кнопок переходов. Ключ — целевой статус; текст императивный,
// потому что кнопка обещает действие, а не называет состояние. Само
// значение статуса не переводится — оно уезжает в `set_order_status`.
// Перехода без своей подписи не бывает, но если матрица в базе получит
// новый — покажем название состояния вместо обещания действия.
const ACTIONS = [
  'confirmed', 'awaiting_payment', 'paid', 'packing', 'shipped',
  'delivered', 'completed', 'cancelled', 'returned',
] as const
type ActionStatus = (typeof ACTIONS)[number]
const actionLabel = (t: T, status: string): string =>
  ((ACTIONS as readonly string[]).includes(status)
    ? t(`orders.action.${status as ActionStatus}`)
    : orderLabel(t, status))

// Откуда пришёл заказ. Здесь формулировка своя («з вітрини», а не
// «вітрина»): в карточке это часть предложения о дате, а в списке —
// пометка. Один ключ на оба места склеил бы две разные фразы.
const SOURCES = ['storefront', 'manual', 'instagram', 'phone', 'offline'] as const
type Source = (typeof SOURCES)[number]
const sourceLabel = (t: T, v: string): string =>
  ((SOURCES as readonly string[]).includes(v) ? t(`orders.detail.source.${v as Source}`) : v)

export function OrderDetail({
  order, items, events, allowed, canWrite, userId, loadError,
}: {
  order: OrderCard
  items: OrderItem[]
  events: OrderEvent[]
  allowed: string[]
  canWrite: boolean
  userId: string
  loadError: string
}) {
  const t = useT()
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')

  // Кнопки рисуем ТОЛЬКО из order_status_transitions: матрица переходов
  // живёт в базе, и триггер orders_guard отклонит всё, чего в ней нет.
  // Нарисовать «Відправити» из «нове» значит пообещать заведомо падающее
  // действие — поэтому список приходит из базы, а не из этого файла.
  const forward = useMemo(
    () => allowed
      .filter((s) => s !== 'cancelled' && s !== 'returned')
      .sort((a, b) => ORDER_STATUSES.indexOf(a) - ORDER_STATUSES.indexOf(b)),
    [allowed],
  )
  const undoing = useMemo(
    () => allowed.filter((s) => s === 'cancelled' || s === 'returned'),
    [allowed],
  )

  async function move(to: string) {
    setBusy(to); setErr('')
    // Прямой update по статусу заблокирует триггер: единственный путь —
    // set_order_status, он же освобождает резервы склада и пишет событие.
    const { error } = await supabase.rpc('set_order_status', {
      p_order_id: order.id,
      p_status: to,
      p_note: note.trim() || null,
    })
    setBusy(null)
    if (error) { setErr(dbErrorText(t, error)); return }
    setNote(''); router.refresh()
  }

  // Своей `fmt` больше нет: дату собирает `t.dateTime` по локали языка
  // интерфейса, а не жёстким 'uk-UA'. Деньги — `t.money`: подстановка
  // «₴» руками ломается на второй валюте.
  const stamp: Intl.DateTimeFormatOptions = {
    day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  }

  // Имя автора события не показываем: политика profiles_self_read отдаёт
  // только собственный профиль, поэтому join вернул бы пустоту для всех,
  // кроме себя. Честнее назвать роль, чем показать прочерк.
  const actorLabel = (e: OrderEvent) =>
    e.actor === null ? t('orders.detail.actor.system')
      : e.actor === userId ? t('orders.detail.actor.self')
      : t('orders.detail.actor.team')

  const delivery = [
    order.deliveryMethod, order.deliveryCity,
    order.deliveryBranch, order.deliveryAddress,
  ].filter(Boolean).join(' · ')

  return (
    <div className="flex flex-col gap-5">
      <div className="rise flex flex-wrap items-center justify-between gap-3">
        <Link href="/app/orders" className="btn-ghost">← {t('orders.detail.back')}</Link>
        <div className="flex items-center gap-2">
          <span className="tabular t-xs prose-muted">
            {t.dateTime(order.createdAt, stamp)} · {sourceLabel(t, order.source)}
          </span>
          {order.guest && <span className="badge">{t('orders.detail.badge.guest')}</span>}
          <span className={orderBadge(order.status)}>{orderLabel(t, order.status)}</span>
        </div>
      </div>

      {/* Тексты отказов базы подставляются как есть; из словаря — рамка. */}
      {loadError && (
        <p className="field-error rise">{t('orders.detail.error.partial', { message: loadError })}</p>
      )}
      {err && <p className="field-error rise">{err}</p>}

      {/* Смена статуса */}
      {canWrite && (
        <section className="card rise-1">
          <h2 className="t-lg mb-3">{t('orders.detail.next.title')}</h2>
          {forward.length === 0 && undoing.length === 0 ? (
            <p className="t-md prose-muted">{t('orders.detail.next.final')}</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {forward.map((s, i) => (
                  <button key={s} disabled={busy !== null}
                          className={i === 0 ? 'btn-primary t-md' : 'btn-secondary t-md'}
                          onClick={() => void move(s)}>
                    {actionLabel(t, s)}
                  </button>
                ))}
                {undoing.map((s) => (
                  <button key={s} disabled={busy !== null}
                          className="btn-danger t-md"
                          onClick={() => void move(s)}>
                    {actionLabel(t, s)}
                  </button>
                ))}
              </div>
              <div className="mt-3">
                <label className="field-label" htmlFor="status-note">
                  {t('orders.detail.note.label')}
                </label>
                <input id="status-note" className="input" value={note}
                       placeholder={t('orders.detail.note.placeholder')}
                       onChange={(e) => setNote(e.target.value)} />
                <p className="field-hint">{t('orders.detail.note.hint')}</p>
              </div>
            </>
          )}
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Позиции */}
        <section className="card rise-2 lg:col-span-2 !p-0">
          <h2 className="t-lg px-5 pt-5">{t('orders.detail.items.title')}</h2>
          <div className="px-5">
            {items.length === 0 ? (
              <div className="empty">{t('orders.detail.items.empty')}</div>
            ) : items.map((it) => (
              <div key={it.id} className="row">
                <div className="min-w-0">
                  <p className="t-md truncate">{it.title}</p>
                  <p className="tabular t-xs mt-0.5 prose-muted">
                    {it.variant} · {t.money(it.price)} × {t.number(it.qty)}
                  </p>
                </div>
                <span className="tabular t-md shrink-0">
                  {t.money(it.price * it.qty)}
                </span>
              </div>
            ))}
          </div>
          <div className="tabular t-md flex flex-col items-end gap-1 px-5 pb-5 pt-4">
            <p className="prose-muted">
              {t('orders.detail.sum.subtotal', { sum: t.money(order.subtotal) })}
            </p>
            {order.discount > 0 && (
              <p className="prose-muted">
                {t('orders.detail.sum.discount', { sum: t.money(order.discount) })}
              </p>
            )}
            <p className="t-2xl">{t.money(order.total)}</p>
            {order.paid > 0 && (
              <p className="prose-muted">
                {t('orders.detail.sum.paid', { sum: t.money(order.paid) })}
              </p>
            )}
          </div>
        </section>

        {/* Контакты и доставка */}
        <section className="card rise-3">
          <h2 className="t-lg mb-3">{t('orders.detail.buyer.title')}</h2>
          <div className="t-md flex flex-col gap-1">
            <p className="t-md">{order.name}</p>
            {order.phone
              ? <a href={`tel:${order.phone}`} className="prose-muted">{order.phone}</a>
              : <p className="prose-muted">{t('orders.detail.buyer.noPhone')}</p>}
            {order.email && (
              <a href={`mailto:${order.email}`} className="prose-muted">{order.email}</a>
            )}
            {order.guest && (
              <p className="field-hint">{t('orders.detail.buyer.guestHint')}</p>
            )}
          </div>

          <div className="divider my-4" />

          <h2 className="t-lg mb-3">{t('orders.detail.delivery.title')}</h2>
          <div className="t-md flex flex-col gap-1">
            <p className={delivery ? '' : 'prose-muted'}>
              {delivery || t('orders.detail.delivery.none')}
            </p>
            {order.tracking && (
              <p className="prose-muted">
                {t('orders.detail.delivery.tracking', { number: order.tracking })}
              </p>
            )}
          </div>

          {(order.comment || order.cancelReason) && (
            <>
              <div className="divider my-4" />
              {order.comment && (
                <p className="t-md">
                  <span className="prose-muted">{t('orders.detail.comment.label')} </span>
                  {order.comment}
                </p>
              )}
              {order.cancelReason && (
                <p className="t-md mt-1">
                  <span className="prose-muted">{t('orders.detail.cancel.label')} </span>
                  {order.cancelReason}
                </p>
              )}
            </>
          )}
        </section>

        {/* История */}
        <section className="card rise-4">
          <h2 className="t-lg mb-3">{t('orders.detail.history.title')}</h2>
          {events.length === 0 ? (
            <div className="empty !py-8">{t('orders.detail.history.empty')}</div>
          ) : (
            <ol className="flex flex-col gap-4">
              {events.map((e) => (
                <li key={e.id} className="flex gap-3">
                  <span aria-hidden
                        className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                        style={{ background: 'var(--color-accent)' }} />
                  <div className="min-w-0">
                    <p className="t-md">
                      {e.from ? `${orderLabel(t, e.from)} → ` : ''}
                      <span className="font-medium">{orderLabel(t, e.to)}</span>
                    </p>
                    <p className="tabular t-xs prose-muted">
                      {t.dateTime(e.at, stamp)} · {actorLabel(e)}
                    </p>
                    {e.note && <p className="t-md mt-0.5">{e.note}</p>}
                  </div>
                </li>
              ))}
            </ol>
          )}
          <p className="field-hint">{t('orders.detail.history.hint')}</p>
        </section>
      </div>
    </div>
  )
}
