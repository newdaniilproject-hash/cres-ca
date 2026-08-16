'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useT } from '@/lib/i18n/client'
import type { T } from '@/lib/i18n/translate'

// Значения enum order_status из 0006_customers_orders.sql, в том же порядке.
// Порядок здесь несёт смысл: по нему сортируются кнопки переходов
// в карточке заказа, чтобы «вперёд по процессу» шло слева направо.
const STATUSES = [
  'new', 'confirmed', 'awaiting_payment', 'paid', 'packing',
  'shipped', 'delivered', 'completed', 'cancelled', 'returned',
] as const
type OrderStatus = (typeof STATUSES)[number]
export const ORDER_STATUSES: string[] = [...STATUSES]

// Подпись к статусу. Само значение (`awaiting_payment`) не переводится:
// это значение перечисления базы, по нему идут запрос и матрица переходов.
// Переводится ПОДПИСЬ. Неизвестный статус выводится как есть — новый
// появится миграцией раньше, чем в словаре.
export const orderLabel = (t: T, status: string): string =>
  ((STATUSES as readonly string[]).includes(status)
    ? t(`orders.status.${status as OrderStatus}`)
    : status)

// Цвет значка — по смыслу для продавца, а не по месту в цепочке:
// акцент — «требует моего действия», жёлтый — «ждём покупателя»,
// зелёный — «деньги/товар дошли», красный — «сделка не состоялась».
export function orderBadge(status: string): string {
  switch (status) {
    case 'new':
    case 'confirmed':
    case 'packing':
    case 'shipped':
      return 'badge-accent'
    case 'awaiting_payment':
    case 'returned':
      return 'badge-warn'
    case 'paid':
    case 'delivered':
    case 'completed':
      return 'badge-success'
    case 'cancelled':
      return 'badge-danger'
    default:
      return 'badge'
  }
}

// Откуда пришёл заказ. То же правило: значение `storefront` — служебное,
// переводится подпись. Неизвестный источник не подписывается вовсе —
// так было и раньше.
const SOURCES = ['storefront', 'manual', 'instagram', 'phone', 'offline'] as const
type Source = (typeof SOURCES)[number]
const sourceLabel = (t: T, v: string): string =>
  ((SOURCES as readonly string[]).includes(v) ? t(`orders.source.${v as Source}`) : '')

export type OrderRow = {
  id: string
  number: number
  status: string
  name: string
  phone: string | null
  guest: boolean
  total: number
  source: string
  createdAt: string
}

// Список заказов. Фильтр переключает адрес, а не прячет уже загруженные
// строки: выдача обрезана сотней записей, и отбор в браузере показывал бы
// «за все время» то, что на самом деле «за последние сто заказов».
export function OrdersClient({
  orders, active, total, error,
}: {
  orders: OrderRow[]
  active: string
  total: number
  error: string
}) {
  const t = useT()
  const router = useRouter()

  function go(status: string) {
    router.push(status === 'all' ? '/app/orders' : `/app/orders?status=${status}`)
  }

  // Своей `fmt` больше нет: дата собирается `t.dateTime` по локали языка
  // интерфейса, а не жёстким 'uk-UA'.
  const shortStamp: Intl.DateTimeFormatOptions = {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="rise flex flex-wrap items-center gap-2">
        <button onClick={() => go('all')} className={active === 'all' ? 'chip-active' : 'chip'}>
          {t('orders.filter.all')}
        </button>
        {ORDER_STATUSES.map((s) => (
          <button key={s} onClick={() => go(s)} className={active === s ? 'chip-active' : 'chip'}>
            {orderLabel(t, s)}
          </button>
        ))}
      </div>

      {/* `error` — текст базы, он подставляется как есть; из словаря
          только рамка вокруг него. */}
      {error && (
        <p className="field-error rise">{t('orders.error.load', { message: error })}</p>
      )}

      <section className="card rise-1 !p-0">
        {orders.length === 0 ? (
          <div className="empty">
            {active === 'all' ? t('orders.empty.all') : t('orders.empty.filter')}
          </div>
        ) : orders.map((o) => (
          <Link key={o.id} href={`/app/orders/${o.id}`} className="row px-5">
            <div className="min-w-0">
              <p className="t-md flex flex-wrap items-center gap-2">
                <span className="tabular">№{o.number}</span>
                <span className="truncate">{o.name}</span>
                {/* Гостевой заказ: аккаунта нет, связи с ним тоже — только
                    имя и телефон из формы. Помечаем, чтобы продавец не искал
                    несуществующую историю покупок. */}
                {o.guest && <span className="badge">{t('orders.badge.guest')}</span>}
              </p>
              <p className="tabular t-xs mt-0.5 prose-muted">
                {t.dateTime(o.createdAt, shortStamp)}
                {o.phone ? ` · ${o.phone}` : ''}
                {sourceLabel(t, o.source) ? ` · ${sourceLabel(t, o.source)}` : ''}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              {/* Символ валюты ставит Intl (`t.money`), а не подстановка «₴». */}
              <span className="tabular t-md">{t.money(o.total)}</span>
              <span className={orderBadge(o.status)}>{orderLabel(t, o.status)}</span>
            </div>
          </Link>
        ))}
      </section>

      {orders.length > 0 && (
        <p className="field-hint">
          {t('orders.footer.shown', { shown: orders.length, total })}
        </p>
      )}
    </div>
  )
}
