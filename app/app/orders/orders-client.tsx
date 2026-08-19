'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useT } from '@/lib/i18n/client'
import type { T } from '@/lib/i18n/translate'
import { IconBag } from '@/components/icons'

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

// Точка состояния в карточке — тот же язык, что у значка, но без слов:
// в списке из тридцати строк тридцать раз прочитанное «Нове» не читается
// вовсе, а цвет отвечает на «что здесь горит» одним взглядом.
function statusTone(status: string): string | undefined {
  switch (status) {
    case 'new':
    case 'confirmed':
    case 'packing':
    case 'shipped':
      return 'accent'
    case 'awaiting_payment':
    case 'returned':
      return 'warn'
    case 'paid':
    case 'delivered':
    case 'completed':
      return 'success'
    default:
      return undefined
  }
}

export type OrderRow = {
  id: string
  number: number
  status: string
  name: string
  guest: boolean
  total: number
  source: string
  createdAt: string
}

// Список заказов. Фильтр переключает адрес, а не прячет уже загруженные
// строки: выдача обрезана сотней записей, и отбор в браузере показывал бы
// «за все время» то, что на самом деле «за последние сто заказов».
export function OrdersClient({
  orders, active, total, stats, error,
}: {
  orders: OrderRow[]
  active: string
  total: number
  /** Счётчики по ВСЕМУ заведению, а не по выданной сотне (см. page.tsx). */
  stats: { all: number; fresh: number; done: number }
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
    <div className="flex flex-col gap-4">
      {/* README, розділ G: «Статистика (усього / нові / виконані)».
          Три величины и ровно эти: сколько всего, что требует меня,
          что закрыто. Числа кликабельные — плитка, сообщающая «нових: 4»
          и не дающая их увидеть, заставляет искать их фильтром руками
          (та же ошибка, что была на складе, М31). */}
      <section className="rise grid grid-cols-3 gap-2">
        <button type="button" className="metric" onClick={() => go('all')}>
          <span className="metric-value tabular">{t.number(stats.all)}</span>
          <span className="metric-label">{t('orders.stats.all')}</span>
        </button>
        <button type="button" className="metric" data-tone="blue" onClick={() => go('new')}>
          <span className="metric-value tabular">{t.number(stats.fresh)}</span>
          <span className="metric-label">{t('orders.stats.new')}</span>
        </button>
        <button type="button" className="metric" data-tone="emerald" onClick={() => go('completed')}>
          <span className="metric-value tabular">{t.number(stats.done)}</span>
          <span className="metric-label">{t('orders.stats.done')}</span>
        </button>
      </section>

      {/* Одиннадцать статусов переносом занимали три строки и съедали
          первый экран. Одной строкой с прокруткой вбок — как вкладки
          на складе; перенос на вторую строку смешивал бы их с тем,
          что стоит рядом. */}
      <div className="scroll-x rise-1 -mx-4 flex items-center gap-2 px-4 pb-1 sm:mx-0 sm:px-0">
        <button onClick={() => go('all')}
                className={`${active === 'all' ? 'chip-active' : 'chip'} shrink-0`}>
          {t('orders.filter.all')}
        </button>
        {ORDER_STATUSES.map((s) => (
          <button key={s} onClick={() => go(s)}
                  className={`${active === s ? 'chip-active' : 'chip'} shrink-0`}>
            {orderLabel(t, s)}
          </button>
        ))}
      </div>

      {/* `error` — текст базы, он подставляется как есть; из словаря
          только рамка вокруг него. */}
      {error && (
        <p className="field-error rise">{t('orders.error.load', { message: error })}</p>
      )}

      {/* Список — отдельные карточки, а не одна с разделителями (README,
          та же форма, что у склада и записей): у строки три уровня текста
          плюс метка состояния, и в сплошном списке они слипаются. */}
      {orders.length === 0 ? (
        <section className="card rise-1">
          <div className="empty">
            <span className="empty-icon"><IconBag size={24} /></span>
            <p className="empty-title">
              {active === 'all' ? t('orders.empty.all') : t('orders.empty.filter')}
            </p>
            {active !== 'all' && (
              <button type="button" className="btn-secondary" onClick={() => go('all')}>
                {t('orders.filter.all')}
              </button>
            )}
          </div>
        </section>
      ) : (
        <div className="rise-1 flex flex-col gap-2">
          {orders.map((o) => (
            <Link key={o.id} href={`/app/orders/${o.id}`} className="list-card">
              <span aria-hidden className="status-dot" data-tone={statusTone(o.status)} />
              <span className="min-w-0 flex-1">
                <span className="t-md flex flex-wrap items-center gap-2">
                  <span className="tabular">№{o.number}</span>
                  <span className="truncate">{o.name}</span>
                  {/* Гостевой заказ: аккаунта нет, связи с ним тоже — только
                      имя и телефон из формы. Помечаем, чтобы продавец
                      не искал несуществующую историю покупок. */}
                  {o.guest && <span className="badge">{t('orders.badge.guest')}</span>}
                </span>
                <span className="tabular t-xs mt-0.5 block prose-muted">
                  {t.dateTime(o.createdAt, shortStamp)}
                  {sourceLabel(t, o.source) ? ` · ${sourceLabel(t, o.source)}` : ''}
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1">
                {/* Символ валюты ставит Intl (`t.money`), а не подстановка «₴». */}
                <span className="tabular t-md">{t.money(o.total)}</span>
                <span className={orderBadge(o.status)}>{orderLabel(t, o.status)}</span>
              </span>
            </Link>
          ))}
        </div>
      )}

      {orders.length > 0 && (
        <p className="field-hint">
          {t('orders.footer.shown', { shown: orders.length, total })}
        </p>
      )}
    </div>
  )
}
