'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { IconBag } from '@/components/icons'
import { ORDER_STATUSES, orderBadge, orderLabel } from '../status'
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
    <div className="flex flex-col gap-4">
      {/* ⚠️ ССЫЛКИ «← Усі замовлення» ЗДЕСЬ БОЛЬШЕ НЕТ, И ЭТО НЕ ПОТЕРЯ
          ВЫХОДА. Оболочка ставит стрелку «назад» в шапке каждого
          внутреннего экрана и ведёт ею в тот же `/app/orders`
          (`components/app-shell.tsx`, `backOf`), плюс жест свайпом
          показывает предыдущий экран под пальцем. Своя кнопка была
          третьим входом в одно и то же действие и занимала целый ряд
          над карточкой заказа.

          README, розділ G, `orderItem`: «Шапка замовлення (номер,
          клієнт, час, статус)» — одной карточкой, а не полосой из
          четырёх разнородных кусков. */}
      <section className="card rise flex items-center gap-3">
        <span aria-hidden className="flex shrink-0 items-center justify-center"
              style={{
                width: 44, height: 44,
                borderRadius: 'var(--radius-control)',
                background: 'var(--color-accent-soft)',
                color: 'var(--color-accent-ink)',
              }}>
          <IconBag size={20} />
        </span>
        <div className="min-w-0 flex-1">
          {/* Имя покупателя — данные заказа, не переводится. */}
          <p className="t-lg clamp-2">
            <span className="tabular">№{order.number}</span> · {order.name}
          </p>
          <p className="tabular t-xs mt-0.5 truncate prose-muted">
            {t.dateTime(order.createdAt, stamp)} · {sourceLabel(t, order.source)}
          </p>
        </div>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <span className={orderBadge(order.status)}>{orderLabel(t, order.status)}</span>
          {order.guest && <span className="badge">{t('orders.detail.badge.guest')}</span>}
        </span>
      </section>

      {/* Тексты отказов базы подставляются как есть; из словаря — рамка. */}
      {loadError && (
        <p className="field-error rise">{t('orders.detail.error.partial', { message: loadError })}</p>
      )}
      {err && <p className="field-error rise">{err}</p>}

      {/* ── Склад замовлення ──────────────────────────────────────────
          README: позиции, суммы и строка «Разом» одной карточкой.

          ⚠️ СТРОКИ «Позиції: 920 ₴» НАД ИТОГОМ БОЛЬШЕ НЕ БЫВАЕТ БЕЗ
          СКИДКИ. Без неё это ровно то же число, что и «Разом», набранное
          дважды подряд — а в заказе без скидки, то есть почти во всех,
          так и было. Появляется только тогда, когда есть что вычитать. */}
      <section className="card rise-1 !p-0">
        <p className="eyebrow px-5 pt-5">{t('orders.detail.items.title')}</p>
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
        <div className="tabular flex flex-col gap-1 px-5 pb-5 pt-4">
          {order.discount > 0 && (
            <>
              <p className="t-sm text-right prose-muted">
                {t('orders.detail.sum.subtotal', { sum: t.money(order.subtotal) })}
              </p>
              <p className="t-sm text-right prose-muted">
                {t('orders.detail.sum.discount', { sum: t.money(order.discount) })}
              </p>
            </>
          )}
          {/* «Разом» — подпись слева, число справа: строка итога в макете
              единственная, у которой есть имя, и по нему глаз находит
              её среди позиций. */}
          <p className="t-lg flex items-baseline justify-between gap-4">
            <span>{t('orders.detail.sum.total')}</span>
            <span>{t.money(order.total)}</span>
          </p>
          {order.paid > 0 && (
            <p className="t-sm text-right prose-muted">
              {t('orders.detail.sum.paid', { sum: t.money(order.paid) })}
            </p>
          )}
        </div>
      </section>

      {/* ── Дії ──────────────────────────────────────────────────────
          README: главное действие кнопкой, «Скасувати замовлення»
          отдельно внизу и `danger`. Карточки с заголовком «Що робимо
          далі» вокруг них больше нет: заголовок над двумя кнопками
          объяснял то, что кнопки и так говорят словами. */}
      {canWrite && (
        forward.length === 0 && undoing.length === 0 ? (
          <p className="t-sm rise-2 prose-muted">{t('orders.detail.next.final')}</p>
        ) : (
          <div className="rise-2 flex flex-col gap-3">
            {/* Комментарий уезжает вместе с переходом, поэтому стоит
                НАД кнопками: набранный после нажатия он не попадёт
                никуда. */}
            <div>
              <label className="field-label" htmlFor="status-note">
                {t('orders.detail.note.label')}
              </label>
              <input id="status-note" className="input" value={note}
                     placeholder={t('orders.detail.note.placeholder')}
                     onChange={(e) => setNote(e.target.value)} />
            </div>

            {forward.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {forward.map((s, i) => (
                  <button key={s} disabled={busy !== null}
                          className={`${i === 0 ? 'btn-primary' : 'btn-secondary'} t-md flex-1`}
                          style={{ minHeight: 'var(--tap-min)' }}
                          onClick={() => void move(s)}>
                    {actionLabel(t, s)}
                  </button>
                ))}
              </div>
            )}

            {undoing.map((s) => (
              <button key={s} disabled={busy !== null}
                      className="btn-danger t-md w-full"
                      style={{ minHeight: 'var(--tap-min)' }}
                      onClick={() => void move(s)}>
                {actionLabel(t, s)}
              </button>
            ))}

            <p className="field-hint">{t('orders.detail.note.hint')}</p>
          </div>
        )
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ── Покупець і доставка ────────────────────────────────────
            Было ДВЕ секции с заголовками и разделителем внутри одной
            карточки, и каждая строка в них шла свободным текстом:
            «Покупець» → имя, телефон, почта; «Доставка» → склеенная
            через « · » строка из четырёх полей, в которой не видно,
            где город, а где отделение.

            Стало одна таблица «ключ → значение» (README, розділ C):
            те же данные, но каждое названо, и на 390px они не
            слипаются в абзац. */}
        <section className="rise-3">
          <div className="kv">
            <div className="kv-row">
              <span className="kv-key">{t('orders.detail.buyer.title')}</span>
              {/* Имя покупателя — данные заказа. */}
              <span className="kv-val">{order.name}</span>
            </div>
            <div className="kv-row">
              <span className="kv-key">{t('orders.detail.phone.key')}</span>
              <span className="kv-val tabular">
                {order.phone
                  ? <a href={`tel:${order.phone}`}>{order.phone}</a>
                  : t('orders.detail.buyer.noPhone')}
              </span>
            </div>
            {order.email && (
              <div className="kv-row">
                <span className="kv-key">{t('orders.detail.email.key')}</span>
                <span className="kv-val truncate">
                  <a href={`mailto:${order.email}`}>{order.email}</a>
                </span>
              </div>
            )}
            <div className="kv-row">
              <span className="kv-key">{t('orders.detail.delivery.title')}</span>
              <span className="kv-val">{delivery || t('orders.detail.delivery.none')}</span>
            </div>
            {order.tracking && (
              <div className="kv-row">
                <span className="kv-key">{t('orders.detail.tracking.key')}</span>
                <span className="kv-val tabular">{order.tracking}</span>
              </div>
            )}
          </div>
          {/* Комментарий покупателя и причина отмены — НЕ строки таблицы:
              их подписи в словаре написаны с двоеточием на конце, потому
              что задуманы началом предложения («Коментар покупця: …»),
              а в столбце «ключ → значення» двоеточие лишнее. Резать его
              из перевода нельзя — это было бы вторым правилом о том, как
              строка выглядит, живущим в коде. */}
          {order.comment && (
            <p className="t-md mt-2">
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
          {order.guest && (
            <p className="field-hint mt-2">{t('orders.detail.buyer.guestHint')}</p>
          )}
        </section>

        {/* История. ⚠️ Абзаца «Історію пише база на кожному переході…»
            под ней больше нет: он объяснял неизменяемость журнала тому,
            кто зашёл посмотреть, что стало с заказом, и занимал на
            телефоне три строки под каждым открытием. Само правило от
            этого не изменилось — оно в базе, а не в подписи. */}
        <section className="card rise-4">
          <p className="eyebrow mb-3">{t('orders.detail.history.title')}</p>
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
        </section>
      </div>
    </div>
  )
}
