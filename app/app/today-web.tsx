import Link from 'next/link'
import type { T } from '@/lib/i18n/translate'
import { IconBox, IconCalendar, IconClock } from '@/components/icons'
// Значок и подпись статуса заказа — из общего модуля раздела заказов
// (`app/app/orders/status.ts`), а не своим маленьким словарём здесь.
// Своя копия расходится с первой на первой же миграции, и расходится молча.
import { orderBadge, orderLabel } from './orders/status'
import { NewBookingButton } from './bookings/new-booking'

// ── «Сьогодні» на широком экране (хендофф CRESKO Web, §1) ────────────────────
//
// Вынесено из `app/app/page.tsx` по той же причине и тем же способом, что
// и `today-mobile.tsx`: страница СЕРВЕРНАЯ и живёт за входом, а сеть
// контейнера закрыта политикой окружения. Пока разметка сидела вперемешку
// с восемью запросами, сверить её с макетом было нечем — расхождения
// находил владелец глазами. Здесь она принимает готовые значения, и ту же
// самую разметку рисует временный стенд приёмки с данными из хендоффа.
//
// `'use client'` НЕ ставится: состояния у экрана нет, а директива утащила бы
// в бандл переводчик со всеми словарями. Переводчик приходит пропом.

export type TodayCardBooking = {
  id: string
  startISO: string
  /** Имя клиента и услуга — данные заклада, не переводятся. */
  name: string
  service: string
}

export type TodayCardExpiring = {
  code: string
  /** Дата `ГГГГ-ММ-ДД`; тон и остаток дней считаются здесь. */
  useBy: string
  title: string
}

export type TodayCardLow = { title: string; toOrder: number }

export type TodayCardOrder = {
  id: string
  number: number
  name: string
  total: number
  status: string
  createdAt: string
}

export type TodayCardReminder = { event: string; sendAfter: string }

export function TodayWeb(props: {
  t: T
  tenantId: string
  /** `orders.write` — то же право, которое проверяет сам `create_booking`. */
  canBook: boolean
  showBookings: boolean
  showExpiring: boolean
  showStock: boolean
  showFinance: boolean
  showOrders: boolean
  showReminders: boolean
  bookings: TodayCardBooking[]
  expiring: TodayCardExpiring[]
  low: TodayCardLow[]
  orders: TodayCardOrder[]
  reminders: TodayCardReminder[]
  income: number
  expense: number
  /** Готовая кривая спарклайна в системе координат 0 0 300 104. */
  sparkPath: string
  sparkPts: readonly (readonly [number, number])[]
}) {
  const {
    t, tenantId, canBook,
    showBookings, showExpiring, showStock, showFinance, showOrders, showReminders,
    bookings, expiring, low, orders, reminders, income, expense,
    sparkPath, sparkPts,
  } = props

  // Дата в шапке — с прописной по той же причине, что и на телефоне:
  // Intl отдаёт день недели строчным, а это начало строки, а не название.
  const dateLine = t.date(new Date(), { day: 'numeric', month: 'long', weekday: 'long' })
  const dateCap = dateLine.charAt(0).toUpperCase() + dateLine.slice(1)

  // Отметка времени в строке заказа. Сегодняшний заказ показывается ЧАСОМ,
  // а не «20 серп., 10:24»: в макете здесь стоит «10:24» и «7 трав.», и это
  // не сокращение ради красоты — карточка называется «Останні замовлення»,
  // то есть слово «сьогодні» в каждой её строке не сообщает ничего, зато
  // отнимает у имени покупателя треть ширины (оно превращалось в «О…»).
  const today0 = new Date(); today0.setHours(0, 0, 0, 0)
  const stamp = (iso: string) => (new Date(iso) >= today0
    ? t.dateTime(iso, { hour: '2-digit', minute: '2-digit' })
    : t.date(iso, { day: 'numeric', month: 'short' }))

  return (
    <div className="hidden lg:block">
      {/* README §1: H1 29px, инлайн-дата с иконкой календаря; справа
          outline «Календар» и primary «Додати запис».

          Две кнопки — это ДВЕ разные двери, а не одна, нарисованная
          дважды: «Календар» уводит на экран записей, «Додати запис»
          открывает форму прямо здесь. Форма при этом ОДНА на весь
          продукт — тот же `NewBookingButton`, что стоит на «Записах»;
          второй её копии нет и быть не может (она зовёт `available_slots`
          и `create_booking`, и вторая сборка параметров разъехалась бы
          с первой). Клиент звонит и смотрит на утреннюю сводку — это
          и есть место, где его записывают. */}
      <div className="mb-5 flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-baseline gap-3">
          <h1 className="webh1">{t('home.web.title')}</h1>
          <span className="flex shrink-0 items-center gap-1.5"
                style={{ fontSize: 14, color: 'var(--web-muted-soft, var(--color-muted))' }}>
            <IconCalendar size={15} />
            {dateCap}
          </span>
        </div>
        {showBookings && (
          <div className="flex shrink-0 items-center gap-2">
            <Link href="/app/bookings" className="btn-secondary">
              <IconCalendar size={17} />
              {t('home.web.calendar')}
            </Link>
            {canBook && (
              <NewBookingButton tenantId={tenantId} className="btn-primary" />
            )}
          </div>
        )}
      </div>

      {/* README §1: два ряда по три карточки, `gap:20px`. Карточки одного
          ряда РАСТЯГИВАЮТСЯ до самой высокой (умолчание грида), а список
          внутри берёт `flex-1` — только поэтому кнопка-ссылка стоит
          у всех трёх на одной высоте. Выравнивание по верху (`items-start`)
          давало три разных подола в ряду, и глаз читал это как обрыв. */}
      <div className="grid grid-cols-3 gap-5">
        {showBookings && (
          <section className="webcard flex flex-col">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="webh2" style={{ fontSize: 16 }}>{t('home.bookings.title')}</p>
              {bookings.length > 0 && (
                <span className="badge-accent tabular">{t.number(bookings.length)}</span>
              )}
            </div>
            <div className="flex-1">
              {bookings.length === 0
                ? <p className="t-sm prose-muted">{t('home.bookings.empty')}</p>
                : bookings.slice(0, 4).map((b, i, a) => (
                    <div key={b.id} className="flex items-center gap-3 py-2.5"
                         style={{
                           borderBottom: i === a.length - 1
                             ? undefined
                             : '1px solid var(--web-border-dash, var(--color-border))',
                         }}>
                      <span aria-hidden className="list-anchor shrink-0" data-tone="accent"
                            style={{ width: 36, height: 36, fontWeight: 650 }}>
                        {(b.name || '?').trim().charAt(0).toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate" style={{ fontSize: 14, fontWeight: 650, color: 'var(--color-text)' }}>
                          {b.name}
                        </span>
                        <span className="block truncate" style={{ fontSize: 12, color: 'var(--color-muted)' }}>
                          {b.service}
                        </span>
                      </span>
                      <span className="tabular shrink-0" style={{ fontSize: 13, fontWeight: 650, color: 'var(--color-text)' }}>
                        {t.dateTime(b.startISO, { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  ))}
            </div>
            <Link href="/app/bookings" className="webcard-link">
              {t('home.web.allBookings')}
            </Link>
          </section>
        )}

        {showExpiring && (
          <section className="webcard flex flex-col">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="webh2" style={{ fontSize: 16 }}>{t('home.expiring.title')}</p>
              {expiring.length > 0 && (
                <span className="badge-danger tabular">{t.number(expiring.length)}</span>
              )}
            </div>
            <div className="flex-1">
              {expiring.length === 0
                ? <p className="t-sm prose-muted">{t('home.expiring.empty')}</p>
                : expiring.slice(0, 4).map((c, i, a) => {
                    // Тон по остатку: README §1 — 1 день красный,
                    // 3–5 жёлтый, дальше зелёный.
                    const days = Math.ceil((new Date(c.useBy).getTime() - Date.now()) / 864e5)
                    const toneVar = days <= 1
                      ? '--color-danger' : days <= 5 ? '--color-warn' : '--color-success'
                    return (
                      <div key={c.code} className="flex items-center gap-3 py-2.5"
                           style={{
                             borderBottom: i === a.length - 1
                               ? undefined
                               : '1px solid var(--web-border-dash, var(--color-border))',
                           }}>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate" style={{ fontSize: 14, fontWeight: 650, color: 'var(--color-text)' }}>
                            {c.title}
                          </span>
                          <span className="block truncate" style={{ fontSize: 12, color: 'var(--color-muted)' }}>
                            {t('home.expiring.container', { code: c.code })}
                          </span>
                        </span>
                        <span className="tabular shrink-0 text-right">
                          <span className="block" style={{ fontSize: 13, fontWeight: 650, color: `var(${toneVar})` }}>
                            {/* День и месяц, без года: строка отвечает
                                на «когда закончится», а год у ёмкости,
                                которой осталось восемь дней, — четыре
                                лишних знака в самом узком месте. */}
                            {t.date(c.useBy, { day: 'numeric', month: 'short' })}
                          </span>
                          <span className="block" style={{ fontSize: 11, color: 'var(--color-muted)' }}>
                            {t.plural('inventory.days', Math.max(days, 0))}
                          </span>
                        </span>
                      </div>
                    )
                  })}
            </div>
            {/* Ссылка — только по праву на склад: адрес `/app/inventory`
                разворачивает обратно того, у кого его нет. */}
            {showStock && (
              <Link href="/app/inventory" className="webcard-link">
                {t('home.web.allExpiry')}
              </Link>
            )}
          </section>
        )}

        {showStock && (
          <section className="webcard flex flex-col">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="webh2" style={{ fontSize: 16 }}>{t('home.reorder.title')}</p>
              {low.length > 0 && <span className="badge-warn tabular">{t.number(low.length)}</span>}
            </div>
            <div className="flex-1">
              {low.length === 0
                ? <p className="t-sm prose-muted">{t('home.reorder.empty')}</p>
                : low.slice(0, 6).map((r, i) => (
                    <div key={i} className="flex items-center gap-3 py-1.5">
                      {/* Чередование тонов плашки — из README §1. */}
                      <span aria-hidden className="wmetric-icon shrink-0"
                            data-tone={i % 3 === 0 ? 'violet' : i % 3 === 1 ? 'blue' : 'emerald'}
                            style={{ width: 34, height: 34, borderRadius: 10 }}>
                        <IconBox size={17} />
                      </span>
                      <span className="min-w-0 flex-1 truncate"
                            style={{ fontSize: 14, fontWeight: 650, color: 'var(--color-text)' }}>
                        {r.title}
                      </span>
                      <span className="tabular shrink-0" style={{ fontSize: 12, color: 'var(--color-muted)' }}>
                        {t('home.reorder.item', { n: t.number(r.toOrder) })}
                      </span>
                    </div>
                  ))}
            </div>
            <Link href="/app/inventory/reorder" className="webcard-link">
              {t('home.web.makeOrder')}
            </Link>
          </section>
        )}

        {showFinance && (
          <section className="webcard flex flex-col">
            <p className="webh2 mb-3" style={{ fontSize: 16 }}>{t('home.web.finance')}</p>
            <div className="grid grid-cols-2 gap-3">
              <div style={{ background: 'var(--color-success-soft)', borderRadius: 12, padding: '12px 14px' }}>
                <p style={{ fontSize: 12, color: 'var(--color-muted)' }}>{t('finance.form.income')}</p>
                <p className="tabular" style={{ fontSize: 21, fontWeight: 800, color: 'var(--color-success)' }}>
                  {t.money(income)}
                </p>
              </div>
              <div style={{ background: 'var(--color-danger-soft)', borderRadius: 12, padding: '12px 14px' }}>
                <p style={{ fontSize: 12, color: 'var(--color-muted)' }}>{t('finance.form.expense')}</p>
                <p className="tabular" style={{ fontSize: 21, fontWeight: 800, color: 'var(--color-danger)' }}>
                  {t.money(expense)}
                </p>
              </div>
            </div>
            {/* Спарклайн дохода по дням: кривая через средние точки
                (README §1), заливка 10% тона, точки 3.4px на узлах.
                Пусто — осей в никуда не рисуем. */}
            <div className="flex-1">
              {sparkPath && (
                <svg viewBox="0 0 300 104" preserveAspectRatio="none"
                     className="mt-3 w-full" style={{ height: 104 }} aria-hidden>
                  <path d={`${sparkPath} L 300 104 L 0 104 Z`} fill="var(--tone-blue-soft)" stroke="none" />
                  <path d={sparkPath} fill="none" stroke="var(--tone-blue)" strokeWidth="2.4"
                        vectorEffect="non-scaling-stroke" />
                  {sparkPts.map((p, i) => (
                    <circle key={i} cx={p[0]} cy={p[1]} r="3.4" fill="var(--tone-blue)" />
                  ))}
                </svg>
              )}
            </div>
            <Link href="/app/finance" className="webcard-link">{t('home.web.allFinance')}</Link>
          </section>
        )}

        {showOrders && (
          <section className="webcard flex flex-col">
            <p className="webh2 mb-2" style={{ fontSize: 16 }}>{t('home.web.orders')}</p>
            <div className="flex-1">
              {orders.length === 0
                ? <p className="t-sm prose-muted">{t('home.web.orders.empty')}</p>
                : orders.map((o, i, a) => (
                    // Строка ведёт в саму карточку заказа, а не в список:
                    // в макете это строка с номером и суммой, и упереться
                    // в неё взглядом, чтобы потом искать тот же номер
                    // в списке заново, — лишний шаг на ровном месте.
                    // Гридом, а не флексом: во флексе имя покупателя
                    // сжималось до «О…» — сумма, значок и время держали
                    // свою ширину, а отдавать место было только имени.
                    <Link key={o.id} href={`/app/orders/${o.id}`}
                          className="grid items-center gap-x-2 py-2.5"
                          style={{
                            gridTemplateColumns: 'auto minmax(0, 1fr) auto auto',
                            borderBottom: i === a.length - 1
                              ? undefined
                              : '1px solid var(--web-border-dash, var(--color-border))',
                          }}>
                      <span className="tabular"
                            style={{ fontSize: 13, color: 'var(--color-muted)' }}>
                        № {o.number}
                      </span>
                      <span className="truncate"
                            style={{ fontSize: 13, fontWeight: 650, color: 'var(--color-text)' }}>
                        {o.name}
                      </span>
                      <span className="tabular"
                            style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text)' }}>
                        {t.money(o.total)}
                      </span>
                      <span className={orderBadge(o.status)}>
                        {orderLabel(t, o.status)}
                      </span>
                      {/* Время — второй строкой под суммой и значком,
                          а не пятой колонкой: карточка занимает треть
                          экрана, и пять колонок в неё не встают — первым
                          сжимается имя. */}
                      <span className="tabular col-start-3 -mt-0.5 text-right"
                            style={{ gridColumnEnd: 'span 2', fontSize: 11, color: 'var(--web-muted-soft, var(--color-muted))' }}>
                        {stamp(o.createdAt)}
                      </span>
                    </Link>
                  ))}
            </div>
            <Link href="/app/orders" className="webcard-link">{t('home.web.allOrders')}</Link>
          </section>
        )}

        {showReminders && (
          <section className="webcard flex flex-col">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="webh2" style={{ fontSize: 16 }}>{t('home.web.reminders')}</p>
              {reminders.length > 0 && (
                <span className="badge tabular">{t.number(reminders.length)}</span>
              )}
            </div>
            <div className="flex-1">
              {reminders.length === 0
                ? <p className="t-sm prose-muted">{t('home.web.reminders.empty')}</p>
                : reminders.map((r, i) => (
                    <div key={i} className="flex items-center gap-3 py-2">
                      <span aria-hidden className="wmetric-icon shrink-0" data-tone="amber"
                            style={{ width: 36, height: 36, borderRadius: 11 }}>
                        <IconClock size={17} />
                      </span>
                      <span className="min-w-0 flex-1">
                        {/* Событие очереди — служебный код; человеку — подпись. */}
                        <span className="block truncate" style={{ fontSize: 14, fontWeight: 650, color: 'var(--color-text)' }}>
                          {r.event.startsWith('booking')
                            ? t('home.web.reminder.booking')
                            : t('home.web.reminder.other')}
                        </span>
                        <span className="block truncate" style={{ fontSize: 12, color: 'var(--color-muted)' }}>
                          {t.dateTime(r.sendAfter)}
                        </span>
                      </span>
                    </div>
                  ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
