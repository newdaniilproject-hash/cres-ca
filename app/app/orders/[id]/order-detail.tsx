'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { ORDER_LABEL, ORDER_STATUSES, orderBadge } from '../orders-client'

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
// потому что кнопка обещает действие, а не называет состояние.
const ACTION: Record<string, string> = {
  confirmed: 'Прийняти в роботу',
  awaiting_payment: 'Виставити рахунок',
  paid: 'Оплата надійшла',
  packing: 'Збирати',
  shipped: 'Передано перевізнику',
  delivered: 'Доставлено',
  completed: 'Завершити',
  cancelled: 'Скасувати',
  returned: 'Оформити повернення',
}

const SOURCE_LABEL: Record<string, string> = {
  storefront: 'з вітрини',
  manual: 'заведено вручну',
  instagram: 'instagram',
  phone: 'телефоном',
  offline: 'офлайн',
}

const money = (n: number) => `${n.toLocaleString('uk-UA')} ₴`

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
    if (error) { setErr(error.message); return }
    setNote(''); router.refresh()
  }

  const fmt = (s: string) => new Date(s).toLocaleString('uk-UA', {
    day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  })

  // Имя автора события не показываем: политика profiles_self_read отдаёт
  // только собственный профиль, поэтому join вернул бы пустоту для всех,
  // кроме себя. Честнее назвать роль, чем показать прочерк.
  const actorLabel = (e: OrderEvent) =>
    e.actor === null ? 'гість або система'
      : e.actor === userId ? 'ви'
      : 'команда магазину'

  const delivery = [
    order.deliveryMethod, order.deliveryCity,
    order.deliveryBranch, order.deliveryAddress,
  ].filter(Boolean).join(' · ')

  return (
    <div className="flex flex-col gap-5">
      <div className="rise flex flex-wrap items-center justify-between gap-3">
        <Link href="/app/orders" className="btn-ghost">← Усі замовлення</Link>
        <div className="flex items-center gap-2">
          <span className="text-xs prose-muted">
            {fmt(order.createdAt)} · {SOURCE_LABEL[order.source] ?? order.source}
          </span>
          {order.guest && <span className="badge">гостьове</span>}
          <span className={orderBadge(order.status)}>
            {ORDER_LABEL[order.status] ?? order.status}
          </span>
        </div>
      </div>

      {loadError && <p className="field-error rise">Частина даних не завантажилась: {loadError}</p>}
      {err && <p className="field-error rise">{err}</p>}

      {/* Смена статуса */}
      {canWrite && (
        <section className="card rise-1">
          <h2 className="mb-3 font-medium">Що робимо далі</h2>
          {forward.length === 0 && undoing.length === 0 ? (
            <p className="text-sm prose-muted">
              Це кінцевий стан — переходів із нього немає.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {forward.map((s, i) => (
                  <button key={s} disabled={busy !== null}
                          className={i === 0 ? 'btn-primary h-10 text-sm' : 'btn-secondary h-10 text-sm'}
                          onClick={() => void move(s)}>
                    {ACTION[s] ?? ORDER_LABEL[s]}
                  </button>
                ))}
                {undoing.map((s) => (
                  <button key={s} disabled={busy !== null}
                          className="btn-danger h-10 text-sm"
                          onClick={() => void move(s)}>
                    {ACTION[s] ?? ORDER_LABEL[s]}
                  </button>
                ))}
              </div>
              <div className="mt-3">
                <label className="field-label" htmlFor="status-note">Коментар до переходу</label>
                <input id="status-note" className="input" value={note}
                       placeholder="Причина скасування, номер накладної, домовленість…"
                       onChange={(e) => setNote(e.target.value)} />
                <p className="field-hint">
                  Коментар лишиться в історії назавжди. Перехід в «оплачено»
                  сам створює запис доходу у Фінансах, а скасування й повернення —
                  звільняють резерв на складі.
                </p>
              </div>
            </>
          )}
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Позиции */}
        <section className="card rise-2 lg:col-span-2 !p-0">
          <h2 className="px-5 pt-5 font-medium">Позиції</h2>
          <div className="px-5">
            {items.length === 0 ? (
              <div className="empty">У замовленні немає жодної позиції</div>
            ) : items.map((it) => (
              <div key={it.id} className="row">
                <div className="min-w-0">
                  <p className="truncate font-medium">{it.title}</p>
                  <p className="mt-0.5 text-xs prose-muted">
                    {it.variant} · {money(it.price)} × {it.qty}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-medium">
                  {money(it.price * it.qty)}
                </span>
              </div>
            ))}
          </div>
          <div className="flex flex-col items-end gap-1 px-5 pb-5 pt-4 text-sm">
            <p className="prose-muted">Позиції: {money(order.subtotal)}</p>
            {order.discount > 0 && (
              <p className="prose-muted">Знижка: −{money(order.discount)}</p>
            )}
            <p className="display text-xl font-semibold">{money(order.total)}</p>
            {order.paid > 0 && (
              <p className="prose-muted">Сплачено: {money(order.paid)}</p>
            )}
          </div>
        </section>

        {/* Контакты и доставка */}
        <section className="card rise-3">
          <h2 className="mb-3 font-medium">Покупець</h2>
          <div className="flex flex-col gap-1 text-sm">
            <p className="font-medium">{order.name}</p>
            {order.phone
              ? <a href={`tel:${order.phone}`} className="prose-muted">{order.phone}</a>
              : <p className="prose-muted">телефон не вказано</p>}
            {order.email && (
              <a href={`mailto:${order.email}`} className="prose-muted">{order.email}</a>
            )}
            {order.guest && (
              <p className="field-hint">
                Замовлення оформлене без акаунта: у нас є лише імʼя й телефон
                із форми. Написати в застосунку такому покупцеві не вийде — тільки подзвонити.
              </p>
            )}
          </div>

          <div className="divider my-4" />

          <h2 className="mb-3 font-medium">Доставка</h2>
          <div className="flex flex-col gap-1 text-sm">
            <p className={delivery ? '' : 'prose-muted'}>
              {delivery || 'спосіб доставки не вказано'}
            </p>
            {order.tracking && (
              <p className="prose-muted">Накладна: {order.tracking}</p>
            )}
          </div>

          {(order.comment || order.cancelReason) && (
            <>
              <div className="divider my-4" />
              {order.comment && (
                <p className="text-sm">
                  <span className="prose-muted">Коментар покупця: </span>{order.comment}
                </p>
              )}
              {order.cancelReason && (
                <p className="mt-1 text-sm">
                  <span className="prose-muted">Причина скасування: </span>{order.cancelReason}
                </p>
              )}
            </>
          )}
        </section>

        {/* История */}
        <section className="card rise-4">
          <h2 className="mb-3 font-medium">Історія</h2>
          {events.length === 0 ? (
            <div className="empty !py-8">Подій ще немає</div>
          ) : (
            <ol className="flex flex-col gap-4">
              {events.map((e) => (
                <li key={e.id} className="flex gap-3">
                  <span aria-hidden
                        className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                        style={{ background: 'var(--color-accent)' }} />
                  <div className="min-w-0">
                    <p className="text-sm">
                      {e.from ? `${ORDER_LABEL[e.from] ?? e.from} → ` : ''}
                      <span className="font-medium">{ORDER_LABEL[e.to] ?? e.to}</span>
                    </p>
                    <p className="text-xs prose-muted">{fmt(e.at)} · {actorLabel(e)}</p>
                    {e.note && <p className="mt-0.5 text-sm">{e.note}</p>}
                  </div>
                </li>
              ))}
            </ol>
          )}
          <p className="field-hint">
            Історію пише база на кожному переході. Стерти чи виправити
            запис неможливо — це і є доказ того, що сталося із замовленням.
          </p>
        </section>
      </div>
    </div>
  )
}
