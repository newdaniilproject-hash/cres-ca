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

// Заглавная буква — ОФОРМЛЕНИЕ, а не вторая строка словаря. Подписи
// источников написаны строчными, потому что раньше стояли хвостом
// приглушённой строки («19 серп., 10:32 · instagram»); в названии
// карточки тот же хвост начинает отрезок и читается как обрубок.
// Второго ключа с большой буквы заводить нельзя — это ровно тот случай,
// когда одно значение начинает жить в двух местах и молча расходится.
const cap = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

// ⚠️ ТОЧКИ СОСТОЯНИЯ (`statusTone`) ЗДЕСЬ БОЛЬШЕ НЕТ, и это не потеря
// цвета. Она красилась ровно по тем же четырём веткам, что и значок
// справа (`orderBadge`), то есть говорила то же самое, только без слов —
// два кодирования одного признака в одной строке. Осталось то из них,
// которое человек может прочитать, не зная нашей палитры.
//
// Освободившееся место слева занимает плашка из макета (README, розділ G):
// она делает строку заказом с первого взгляда, ровно как плашка
// расширения делает строку файлом на экране документов.

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
        <button type="button" className="metric" aria-pressed={active === 'all'}
                onClick={() => go('all')}>
          <span className="metric-value tabular">{t.number(stats.all)}</span>
          <span className="metric-label">{t('orders.stats.all')}</span>
        </button>
        <button type="button" className="metric" data-tone="blue"
                aria-pressed={active === 'new'} onClick={() => go('new')}>
          <span className="metric-value tabular">{t.number(stats.fresh)}</span>
          <span className="metric-label">{t('orders.stats.new')}</span>
        </button>
        <button type="button" className="metric" data-tone="emerald"
                aria-pressed={active === 'completed'} onClick={() => go('completed')}>
          <span className="metric-value tabular">{t.number(stats.done)}</span>
          <span className="metric-label">{t('orders.stats.done')}</span>
        </button>
      </section>

      {/* ⚠️ ЧИПОВ «Усі», «нове» и «завершено» ЗДЕСЬ БОЛЬШЕ НЕТ, И ЭТО
          НЕ ПОТЕРЯ ФИЛЬТРА. Ровно эти три отбора уже стоят выше плитками,
          и плитка при этом ещё и называет число — то есть чип был вторым
          входом в то же самое, только беднее. Заодно ушли три из
          одиннадцати позиций уезжающей вбок ленты, а плитка получила
          состояние нажатости (`aria-pressed`), которого ей не хватало:
          раньше выбранный отбор подсвечивался чипом, и снятая плитка
          оставила бы человека без ответа на «а что сейчас показано».

          Остальные восемь статусов остаются лентой: их не назвать
          числами (плиток стало бы одиннадцать), а перенос на вторую
          строку смешал бы их со списком. */}
      <div className="scroll-x rise-1 -mx-4 flex items-center gap-2 px-4 pb-1 sm:mx-0 sm:px-0 lg:hidden">
        {ORDER_STATUSES.filter((s) => s !== 'new' && s !== 'completed').map((s) => (
          <button key={s} onClick={() => go(s)}
                  className={`${active === s ? 'chip-active' : 'chip'} shrink-0`}>
            {orderLabel(t, s)}
          </button>
        ))}
      </div>

      {/* На широком экране плиток-фильтров нет (там метрики §19 ведут
          на «Усі»), поэтому лента статусов остаётся полной. */}
      <div className="scroll-x rise-1 hidden items-center gap-2 pb-1 lg:flex">
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

        {/* README, розділ G: плашка зі значком — назва з джерелом —
            час; праворуч бейдж статусу, під ним сума.

            Порядок правого стовпця саме такий, а не навпаки: гроші —
            найбільше число на екрані, і поставлені зверху вони
            перетягують очі на себе в кожному рядку, а шукають у списку
            «що горить». Стан зверху, сума під ним — так у макеті.

            Мітки «гість» тут немає: у рядку вже шість величин, а
            відсутність акаунта важить лише тоді, коли замовлення
            відкрили, — там вона й лишилась. */}
        <div className="rise-1 flex flex-col gap-2 lg:hidden">
          {orders.map((o) => (
            <Link key={o.id} href={`/app/orders/${o.id}`} className="list-card">
              <span aria-hidden className="flex shrink-0 items-center justify-center"
                    style={{
                      width: 44, height: 44,
                      borderRadius: 'var(--radius-control)',
                      background: 'var(--color-accent-soft)',
                      color: 'var(--color-accent-ink)',
                    }}>
                <IconBag size={20} />
              </span>
              <span className="min-w-0 flex-1">
                {/* Номер, джерело і покупець одним рядком, як у макеті:
                    «№1042 · Instagram · dm_shop». Джерело переїхало сюди
                    з приглушеного рядка знизу — воно відповідає на
                    «звідки це прийшло», а не на «коли». */}
                <span className="t-md clamp-2 block">
                  <span className="tabular">№{o.number}</span>
                  {sourceLabel(t, o.source) ? ` · ${cap(sourceLabel(t, o.source))}` : ''}
                  {' · '}{o.name}
                </span>
                <span className="tabular t-xs mt-0.5 block truncate prose-muted">
                  {t.dateTime(o.createdAt, shortStamp)}
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1">
                <span className={orderBadge(o.status)}>{orderLabel(t, o.status)}</span>
                {/* Символ валюты ставит Intl (`t.money`), а не подстановка «₴». */}
                <span className="tabular t-md">{t.money(o.total)}</span>
              </span>
            </Link>
          ))}
        </div>
        </>
      )}

      {/* ⚠️ ПОДСКАЗКА ПОД СПИСКОМ ПОЯВЛЯЕТСЯ, ТОЛЬКО КОГДА СПИСОК ОБРЕЗАН.
          Раньше «Показано 4 із 4» стояло всегда — три строки серого
          текста под каждым списком, повторяющие плитку «Усього» и ничего
          не сообщающие. Она нужна ровно в одном случае: выдача упёрлась
          в сотню, и увиденное — не всё. */}
      {orders.length > 0 && orders.length < total && (
        <p className="field-hint lg:hidden">
          {t('orders.footer.shown', { shown: orders.length, total })}
        </p>
      )}

      {/* Ручной заказ на телефоне — плавающей кнопкой, как на складе
          (М31), а не полосой над списком.

          Прежняя запись здесь («плавающая кнопка перекрывает последнюю
          строку списка») отменена: `.fab-wide` поднята над нижней
          панелью и вырезом её собственным правилом, а полоса стоила
          отдельного ряда на первом экране — там, где макет показывает
          сразу карточки. Заказ по телефону принимают, пока покупатель
          на линии: кнопка обязана быть под пальцем на любой прокрутке,
          а не в конце сотни строк. */}
      {canWrite && (
        <button type="button" className="fab-wide lg:hidden"
                onClick={() => setAdding(true)}>
          <IconPlus size={18} />
          {t('orders.new.cta')}
        </button>
      )}

      {/* Форма ручного заказа — одна на обе раскладки. Список после успеха
          она обновляет сама. */}
      <NewOrderSheet tenantId={tenantId} open={adding} onClose={() => setAdding(false)} />
    </div>
  )
}
