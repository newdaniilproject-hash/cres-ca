'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useT } from '@/lib/i18n/client'
import type { T } from '@/lib/i18n/translate'
import {
  IconBag, IconCheck, IconChevronRight, IconClock, IconInbox, IconPlus,
} from '@/components/icons'
import { NewOrderSheet } from './new-order'

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
  /** Сколько денег реально пришло: `orders.paid_amount`. */
  paid: number
  /** Число строк в заказе (`order_items`), а не количество товара. */
  items: number
  source: string
  createdAt: string
}

// Оплата — не статус, а сравнение двух чисел заказа. Три состояния и
// только три: пришло всё, пришла часть, не пришло ничего. Четвёртого
// («переплата») в продукте нет — возврат оформляется документом.
function payState(o: OrderRow): { key: 'paid' | 'partial' | 'none'; badge: string } {
  if (o.total > 0 && o.paid >= o.total) return { key: 'paid', badge: 'badge-success' }
  if (o.paid > 0) return { key: 'partial', badge: 'badge-warn' }
  return { key: 'none', badge: 'badge' }
}

// Колонки таблицы §19 — из хендоффа дословно.
const WGRID = '.8fr 1.6fr 1fr .9fr 1fr 1.1fr 1.3fr 40px'

// Список заказов. Фильтр переключает адрес, а не прячет уже загруженные
// строки: выдача обрезана сотней записей, и отбор в браузере показывал бы
// «за все время» то, что на самом деле «за последние сто заказов».
export function OrdersClient({
  orders, active, total, stats, error, tenantId, canWrite,
}: {
  orders: OrderRow[]
  active: string
  total: number
  /** Счётчики по ВСЕМУ заведению, а не по выданной сотне (см. page.tsx). */
  stats: { all: number; fresh: number; working: number; done: number }
  error: string
  tenantId: string
  /** `orders.write` — то же право, которое проверяет сам `create_order`. */
  canWrite: boolean
}) {
  const t = useT()
  const router = useRouter()
  // Одно состояние на две кнопки (широкий хедер и узкая полоса) — разбор
  // в шапке `new-order.tsx`.
  const [adding, setAdding] = useState(false)

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
      {/* ═══ CRESKO Web, §19 «Замовлення» — хедер экрана, ТОЛЬКО lg ══════
          Плашка со значком, имя экрана тем же ключом, что у панели и
          вкладки браузера, подпись под ним.

          «Нове замовлення» ЕСТЬ, и прежняя запись здесь («заказ не
          заводится из кабинета вовсе — он приходит с витрины») отменена:
          продажа по телефону и продажа у стойки не фиксировались нигде —
          ни в заказах, ни в резервах склада, ни в деньгах. Вторым
          источником заказов форма не становится: она зовёт тот же
          `create_order`, что и витрина, и ничего мимо него не пишет. */}
      <div className="mb-1 hidden items-center gap-3 lg:flex">
        <span aria-hidden className="flex shrink-0 items-center justify-center"
              style={{
                width: 44, height: 44,
                borderRadius: 'var(--radius-plate)',
                background: 'var(--color-accent-soft)',
                color: 'var(--color-accent-ink)',
              }}>
          <IconBag size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="webh1" data-size="27">{t('app.screen.orders.title')}</h1>
          <p style={{ fontSize: 14, color: 'var(--color-muted)' }}>
            {t('app.screen.orders.desc')}
          </p>
        </div>
        {canWrite && (
          <button type="button" className="btn-primary shrink-0"
                  style={{ minHeight: 'var(--tap-min)' }}
                  onClick={() => setAdding(true)}>
            <IconPlus size={18} />
            {t('orders.new.cta')}
          </button>
        )}
      </div>

      {/* ── CRESKO Web §19: четыре метрики (только lg) ─────────────────
          «В роботі» — всё между принятым и завершённым (список статусов
          в page.tsx), а не отдельный статус. Числа кликабельные по той же
          причине, что и на телефоне: плитка, сообщающая «нових: 4» и не
          дающая их увидеть, заставляет искать их фильтром руками.
          «Усього» и «В роботі» ведут на «Усі»: одного адреса под набор
          из шести статусов у списка нет, и врать переходом хуже, чем
          показать всё. */}
      <section className="hidden gap-4 lg:grid lg:grid-cols-4">
        <button type="button" className="wmetric" onClick={() => go('all')}
                style={{ minHeight: 'var(--tap-min)', textAlign: 'left' }}>
          <span className="min-w-0">
            <span className="wmetric-label block">{t('orders.stats.all')}</span>
            <span className="wmetric-value tabular block">{t.number(stats.all)}</span>
          </span>
          <span aria-hidden className="wmetric-icon" data-tone="violet">
            <IconBag size={18} />
          </span>
        </button>
        <button type="button" className="wmetric" onClick={() => go('new')}
                style={{ minHeight: 'var(--tap-min)', textAlign: 'left' }}>
          <span className="min-w-0">
            <span className="wmetric-label block">{t('orders.stats.new')}</span>
            <span className="wmetric-value tabular block">{t.number(stats.fresh)}</span>
          </span>
          <span aria-hidden className="wmetric-icon" data-tone="blue">
            <IconInbox size={18} />
          </span>
        </button>
        <button type="button" className="wmetric" onClick={() => go('all')}
                style={{ minHeight: 'var(--tap-min)', textAlign: 'left' }}>
          <span className="min-w-0">
            <span className="wmetric-label block">{t('orders.stats.inWork')}</span>
            <span className="wmetric-value tabular block">{t.number(stats.working)}</span>
          </span>
          <span aria-hidden className="wmetric-icon" data-tone="amber">
            <IconClock size={18} />
          </span>
        </button>
        <button type="button" className="wmetric" onClick={() => go('completed')}
                style={{ minHeight: 'var(--tap-min)', textAlign: 'left' }}>
          <span className="min-w-0">
            <span className="wmetric-label block">{t('orders.stats.done')}</span>
            <span className="wmetric-value tabular block">{t.number(stats.done)}</span>
          </span>
          <span aria-hidden className="wmetric-icon" data-tone="emerald">
            <IconCheck size={18} />
          </span>
        </button>
      </section>

      {/* README, розділ G: «Статистика (усього / нові / виконані)».
          Три величины и ровно эти: сколько всего, что требует меня,
          что закрыто. Числа кликабельные — плитка, сообщающая «нових: 4»
          и не дающая их увидеть, заставляет искать их фильтром руками
          (та же ошибка, что была на складе, М31). */}
      <section className="rise grid grid-cols-3 gap-2 lg:hidden">
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

      {/* Ручной заказ на телефоне — над полосой статусов, а не плавающей
          кнопкой поверх списка: снизу уже стоит панель разделов, и третий
          слой над ней перекрывает последнюю строку списка. */}
      {canWrite && (
        <div className="rise flex justify-end lg:hidden">
          <button type="button" className="btn-primary t-sm"
                  style={{ minHeight: 'var(--tap-min)' }}
                  onClick={() => setAdding(true)}>
            <IconPlus size={16} />
            {t('orders.new.cta')}
          </button>
        </div>
      )}

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
        <>
        {/* ── CRESKO Web §19: список таблицей (только lg) ───────────────
            Строка целиком ссылка на ту же карточку, что открывает
            мобильный список: адрес один, второго пути к заказу нет. */}
        <div className="wtable hidden lg:block">
          <div className="wtable-head" style={{ gridTemplateColumns: WGRID }}>
            <span>{t('orders.web.table.number')}</span>
            <span>{t('orders.web.table.customer')}</span>
            <span>{t('orders.web.table.items')}</span>
            <span>{t('orders.web.table.sum')}</span>
            <span>{t('orders.web.table.pay')}</span>
            <span>{t('orders.web.table.status')}</span>
            <span>{t('orders.web.table.date')}</span>
            <span />
          </div>
          {orders.map((o) => {
            const pay = payState(o)
            return (
              <Link key={o.id} href={`/app/orders/${o.id}`} className="wtable-row"
                    style={{ gridTemplateColumns: WGRID, minHeight: 'var(--tap-min)' }}>
                <span className="tabular font-semibold" style={{ color: 'var(--color-text)' }}>
                  №{o.number}
                </span>
                <span className="flex min-w-0 items-center gap-2">
                  {/* Имя покупателя — данные заказа, не переводится. */}
                  <span className="truncate font-semibold" style={{ color: 'var(--color-text)' }}>
                    {o.name}
                  </span>
                  {o.guest && <span className="badge shrink-0">{t('orders.badge.guest')}</span>}
                </span>
                <span className="tabular">
                  {o.items > 0
                    ? t('orders.web.items.count', { n: t.number(o.items) })
                    : t('common.noValue')}
                </span>
                <span className="tabular font-semibold" style={{ color: 'var(--color-text)' }}>
                  {t.money(o.total)}
                </span>
                <span>
                  <span className={pay.badge}>{t(`orders.web.pay.${pay.key}`)}</span>
                </span>
                <span>
                  <span className={orderBadge(o.status)}>{orderLabel(t, o.status)}</span>
                </span>
                <span className="tabular">{t.dateTime(o.createdAt, shortStamp)}</span>
                <span aria-hidden className="flex justify-end"
                      style={{ color: 'var(--color-faint)' }}>
                  <IconChevronRight size={18} />
                </span>
              </Link>
            )
          })}
          {/* Подвал таблицы говорит ровно то же, что подсказка под
              мобильным списком, и тем же ключом: два счётчика с разными
              словами о одном и том же — это два источника правды. */}
          <div className="wtable-foot">
            <span>{t('orders.footer.shown', { shown: orders.length, total })}</span>
          </div>
        </div>

        <div className="rise-1 flex flex-col gap-2 lg:hidden">
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
        </>
      )}

      {orders.length > 0 && (
        <p className="field-hint lg:hidden">
          {t('orders.footer.shown', { shown: orders.length, total })}
        </p>
      )}

      {/* Форма ручного заказа — одна на обе раскладки. Список после успеха
          она обновляет сама. */}
      <NewOrderSheet tenantId={tenantId} open={adding} onClose={() => setAdding(false)} />
    </div>
  )
}
