'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'

// Значения enum order_status из 0006_customers_orders.sql, в том же порядке.
// Порядок здесь несёт смысл: по нему сортируются кнопки переходов
// в карточке заказа, чтобы «вперёд по процессу» шло слева направо.
export const ORDER_STATUSES: string[] = [
  'new', 'confirmed', 'awaiting_payment', 'paid', 'packing',
  'shipped', 'delivered', 'completed', 'cancelled', 'returned',
]

export const ORDER_LABEL: Record<string, string> = {
  new: 'нове',
  confirmed: 'прийнято',
  awaiting_payment: 'очікує оплати',
  paid: 'оплачено',
  packing: 'збирається',
  shipped: 'відправлено',
  delivered: 'доставлено',
  completed: 'завершено',
  cancelled: 'скасовано',
  returned: 'повернення',
}

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

const SOURCE_LABEL: Record<string, string> = {
  storefront: 'вітрина',
  manual: 'вручну',
  instagram: 'instagram',
  phone: 'телефон',
  offline: 'офлайн',
}

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
  const router = useRouter()

  function go(status: string) {
    router.push(status === 'all' ? '/app/orders' : `/app/orders?status=${status}`)
  }

  const fmt = (s: string) =>
    new Date(s).toLocaleString('uk-UA', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    })

  return (
    <div className="flex flex-col gap-5">
      <div className="rise flex flex-wrap items-center gap-2">
        <button onClick={() => go('all')} className={active === 'all' ? 'chip-active' : 'chip'}>
          Усі
        </button>
        {ORDER_STATUSES.map((s) => (
          <button key={s} onClick={() => go(s)} className={active === s ? 'chip-active' : 'chip'}>
            {ORDER_LABEL[s]}
          </button>
        ))}
      </div>

      {error && <p className="field-error rise">Не вдалося завантажити замовлення: {error}</p>}

      <section className="card rise-1 !p-0">
        {orders.length === 0 ? (
          <div className="empty">
            {active === 'all'
              ? 'Замовлень ще немає. Перше зʼявиться тут одразу після оформлення — і з вітрини, і з вашого ручного продажу.'
              : 'У цьому статусі замовлень немає.'}
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
                {o.guest && <span className="badge">гість</span>}
              </p>
              <p className="tabular t-xs mt-0.5 prose-muted">
                {fmt(o.createdAt)}
                {o.phone ? ` · ${o.phone}` : ''}
                {SOURCE_LABEL[o.source] ? ` · ${SOURCE_LABEL[o.source]}` : ''}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className="tabular t-md">{o.total.toLocaleString('uk-UA')} ₴</span>
              <span className={orderBadge(o.status)}>{ORDER_LABEL[o.status] ?? o.status}</span>
            </div>
          </Link>
        ))}
      </section>

      {orders.length > 0 && (
        <p className="field-hint">
          Показано {orders.length} із {total}. Уточніть статус, щоб побачити
          решту — глибший перегляд зʼявиться разом із пошуком по замовленнях.
        </p>
      )}
    </div>
  )
}
