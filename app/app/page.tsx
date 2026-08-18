import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { currentMembership, can, hasModule } from '@/lib/tenant'
import { AppShell, PageActions } from '@/components/shell'
import { IconCalendar, IconPlus } from '@/components/icons'
import { getT } from '@/lib/i18n/server'

export const dynamic = 'force-dynamic'

// Заголовок вкладки браузера — строка интерфейса, поэтому из словаря.
// Разбор решения — в `app/app/journals/page.tsx`.
export async function generateMetadata() {
  const t = await getT()
  return { title: t('home.meta.title') }
}

// ── СВОДКА ДНЯ ──────────────────────────────────────────────────────────────
//
// Шесть блоков по макету «салон страница сегодня» (18.08.2026): записи,
// сроки, что закупить, деньги за месяц, последние заказы, напоминания.
// Было три — записи, сроки, закупка.
//
// ЭТОТ ЭКРАН ПРАВОМ НЕ ЗАКРЫВАЕТСЯ и закрыт быть не может: он адрес, куда
// уходит `redirect('/app')` со всех остальных страниц, и проверка права
// здесь означала бы цикл редиректов.
//
// Поэтому здесь другой приём той же задачи: каждый блок спрашивает своё
// право И свой модуль САМ, и запрос под него даже не отправляется. Иначе
// получалось наоборот: accountant видел «Сьогодні записів немає» — бодрое
// утверждение о заведении, которого он не имеет права знать и которое
// вдобавок неправда. Пустой блок здесь не безобиден: по нему принимают
// решения утром.
//
// Со второй осью то же самое. Блок раздела, которого заведение не покупало,
// утверждает о нём то, чего оно не брало: «Сьогодні записів немає» без
// модуля `bookings` — не пустота, а неправда.
export default async function AppHome() {
  const m = await currentMembership()
  if (!m) redirect('/register/seller')
  // Экран серверный, поэтому переводчик берётся `await getT()`, а не хуком.
  const t = await getT()
  const supabase = await createClient()

  const seeBookings = can(m, 'orders.read') && hasModule(m, 'bookings')     // bookings_read (0010)
  const seeStock = can(m, 'stock.read') && hasModule(m, 'inventory')        // stock_low_view (0009)
  const seeContainers = can(m, 'compliance.read') && hasModule(m, 'compliance') // compliance_containers (0035)
  const seeOrders = can(m, 'orders.read') && hasModule(m, 'orders')
  const seeFinance = can(m, 'finances.read') && hasModule(m, 'finance')
  const seeSettings = can(m, 'settings.read')
  // Витрина — отдельный модуль, и у экрана настроек его нет: «Магазин»
  // в панели не помечен модулем, потому что там же лежат данные закладу,
  // команда и удаление аккаунта. Модулю `storefront` принадлежит не
  // страница, а публичная сторінка заклада — и всё, что о ней говорит.
  const seeStorefront = hasModule(m, 'storefront')

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
  const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999)
  const today = new Date()
  // Границы месяцев считаются один раз: их спрашивают три запроса.
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
  const prevStart = new Date(today.getFullYear(), today.getMonth() - 1, 1)
  const iso = (d: Date) => d.toISOString().slice(0, 10)

  const [
    { data: shop }, bookingsRes, lowRes, expiringRes,
    financeRes, ordersRes, overdueRes, countRes, noNotifyRes,
  ] = await Promise.all([
    supabase.from('tenants').select('name, status').eq('id', m.tenantId).single(),

    seeBookings ? supabase.from('bookings')
      .select('id, number, title, variant_name, period, status, contact_name')
      .eq('tenant_id', m.tenantId)
      .in('status', ['booked', 'confirmed', 'arrived'])
      .gte('period', `[${todayStart.toISOString()},)`)
      .order('period').limit(20) : null,

    seeStock ? supabase.from('stock_low_view').select('kind, title, to_order')
      .eq('tenant_id', m.tenantId).limit(6) : null,

    // Из представления, а не из таблицы со вложенной связью
    // `materials(name)`. Сама таблица ёмкостей открыта по
    // `compliance.read` и данные бы отдала — а вот `materials` закрыта
    // на `stock.read` (0035), и вложенная связь к ней возвращает null,
    // а НЕ ошибку. У инспектора блок «Спливає термін» показывал список
    // сроков без единого названия засоба: строки есть, читать нечего.
    seeContainers ? supabase.from('compliance_containers')
      .select('code, use_by, material_name')
      .eq('tenant_id', m.tenantId)
      .eq('status', 'opened')
      .not('use_by', 'is', null)
      .gte('use_by', iso(today))
      .lte('use_by', iso(new Date(Date.now() + 14 * 864e5)))
      .order('use_by').limit(5) : null,

    // Деньги: один запрос на два месяца сразу. Разделить их на «этот»
    // и «прошлый» дешевле в памяти, чем вторым походом в базу.
    seeFinance ? supabase.from('finance_records')
      .select('kind, amount, occurred_on')
      .eq('tenant_id', m.tenantId)
      .gte('occurred_on', iso(prevStart))
      .order('occurred_on') : null,

    seeOrders ? supabase.from('orders')
      .select('id, number, status, total, contact_name, created_at')
      .eq('tenant_id', m.tenantId)
      .order('created_at', { ascending: false }).limit(4) : null,

    // ── Напоминания ──────────────────────────────────────────────
    // В макете здесь налоги, сроки сертификатов и «оновити техкарти».
    // Сущности «напоминание» в базе НЕТ, и заводить блок, который
    // никогда не наполнится, нельзя (правило 8). Поэтому блок собран
    // из трёх настоящих сигналов, каждый со своим сроком и каждый
    // читается из живых данных.
    seeContainers ? supabase.from('compliance_containers')
      .select('code', { count: 'exact', head: true })
      .eq('tenant_id', m.tenantId).eq('status', 'opened')
      .lt('use_by', iso(today)) : null,

    seeStock ? supabase.from('stock_counts')
      .select('id, started_at').eq('tenant_id', m.tenantId)
      .neq('status', 'applied').order('started_at').limit(1) : null,

    // Автоматической выгрузки из реестра нотификаций МОЗ не существует —
    // код вводится руками, и его отсутствие обязано быть видно
    // (CLAUDE.md → «Что готово, а чего нет»).
    seeContainers ? supabase.from('materials')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', m.tenantId).eq('is_active', true)
      .eq('is_cosmetic', true).is('notification_code', null) : null,
  ])

  const bookings = bookingsRes?.data ?? null
  const low = lowRes?.data ?? null
  const expiring = expiringRes?.data ?? null
  const orders = ordersRes?.data ?? null

  const todays = (bookings ?? []).filter((b) => {
    const start = new Date(String(b.period).match(/"([^"]+)"/)?.[1] ?? '')
    return start >= todayStart && start <= todayEnd
  })

  // ── Деньги за месяц ──────────────────────────────────────────
  const fin = financeRes?.data ?? []
  const inMonth = (d: string, from: Date, to: Date) => d >= iso(from) && d < iso(to)
  const sum = (kind: string, from: Date, to: Date) => fin
    .filter((r) => r.kind === kind && inMonth(String(r.occurred_on), from, to))
    .reduce((acc, r) => acc + Number(r.amount), 0)

  const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1)
  const income = sum('income', monthStart, nextMonth)
  const expense = sum('expense', monthStart, nextMonth)
  const prevIncome = sum('income', prevStart, monthStart)
  const delta = prevIncome > 0 ? Math.round(((income - prevIncome) / prevIncome) * 100) : 0

  // Накопительный ряд по дням месяца — под линию. Считается здесь,
  // а не в базе: строк за месяц десятки, и представление ради них
  // было бы дороже в поддержке, чем этот цикл.
  const days = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()
  const series: number[] = []
  let running = 0
  for (let d = 1; d <= days; d += 1) {
    const day = iso(new Date(today.getFullYear(), today.getMonth(), d))
    running += fin
      .filter((r) => r.kind === 'income' && String(r.occurred_on) === day)
      .reduce((acc, r) => acc + Number(r.amount), 0)
    series.push(running)
  }
  const peak = Math.max(...series, 1)
  const point = (v: number, i: number) =>
    `${(i / Math.max(days - 1, 1)) * 100},${34 - (v / peak) * 30}`
  const line = series.map(point).join(' ')

  // ── Напоминания ──────────────────────────────────────────────
  const overdue = overdueRes?.count ?? 0
  const openCount = countRes?.data?.[0] ?? null
  const noNotify = noNotifyRes?.count ?? 0
  const reminders = overdue + (openCount ? 1 : 0) + noNotify

  return (
    <AppShell modules={m.modules} perms={m.perms}>
      {/* Действия экрана — в строку заголовка порталом: заголовок
          собирает оболочка из адреса, а кнопки принадлежат экрану.
          Разбор — у `PageActions` в components/app-shell.tsx. */}
      {seeBookings && (
        <PageActions>
          <Link href="/app/bookings" className="btn-secondary t-sm">
            <IconCalendar size={17} /> {t('home.actions.calendar')}
          </Link>
          <Link href="/app/bookings" className="btn-primary t-sm">
            <IconPlus size={17} /> {t('home.actions.addBooking')}
          </Link>
        </PageActions>
      )}

      {/* Кнопка ведёт на /app/settings, а туда пускает только
          `settings.read`. Показывать её тому, кого экран настроек
          развернёт обратно, значит завести ту самую сломанную
          навигацию, ради которой всё это и делается.

          Плюс модуль `storefront`: вся плашка — про публичную сторінку. */}
      {shop && shop.status === 'draft' && seeSettings && seeStorefront && (
        <div className="card-flat rise mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="t-md">{t('home.draft.notice')}</p>
          <Link href="/app/settings" className="btn-secondary t-sm">
            {t('home.draft.publish')}
          </Link>
        </div>
      )}

      {/* Три колонки на большом экране, две на планшете, одна на телефоне.
          Порядок карточек — из макета: сверху то, что смотрят утром. */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">

        {/* ── Записи сегодня ──────────────────────────────────── */}
        {seeBookings && (
        <section className="card rise-1">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="t-lg">
              {t('home.bookings.title')}{' '}
              {todays.length > 0 && <span className="badge tabular">{todays.length}</span>}
            </h2>
            <Link href="/app/bookings" className="btn-ghost t-sm">{t('home.bookings.all')}</Link>
          </div>
          {todays.length === 0 ? (
            <div className="empty !py-8">{t('home.bookings.empty')}</div>
          ) : (
            todays.map((b) => {
              // Переменная названа `start`, а не `t`: `t` — переводчик.
              const start = new Date(String(b.period).match(/"([^"]+)"/)?.[1] ?? '')
              return (
                <div key={b.id} className="row">
                  <div className="flex items-center gap-3">
                    <span className="tabular t-xl" style={{ color: 'var(--color-accent-ink)' }}>
                      {t.dateTime(start, { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <div>
                      {/* Имя клиента, название услуги и варианта — данные. */}
                      <p className="t-md">{b.contact_name}</p>
                      <p className="t-xs prose-muted">{b.title} · {b.variant_name}</p>
                    </div>
                  </div>
                  {/* Статус записи — значение перечисления
                      (`booking_status_transitions`), переводится подпись. */}
                  <span className={b.status === 'confirmed' ? 'badge-success' : 'badge'}>
                    {b.status === 'booked'
                      ? t('home.booking.status.booked')
                      : b.status === 'arrived'
                      ? t('home.booking.status.arrived')
                      : t('home.booking.status.ok')}
                  </span>
                </div>
              )
            })
          )}
        </section>
        )}

        {/* ── Сроки годности ──────────────────────────────────── */}
        {seeContainers && (
        <section className="card rise-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="t-lg">
              {t('home.expiring.title')}{' '}
              {(expiring ?? []).length > 0 && (
                <span className="badge-warn tabular">{(expiring ?? []).length}</span>
              )}
            </h2>
            {/* Сам блок стоит на `compliance.read`, а склад за ссылкой —
                на `stock.read`: `/app/inventory` разворачивает обратно
                сюда всех, у кого его нет, то есть инспектора. */}
            {seeStock && (
              <Link href="/app/inventory" className="btn-ghost t-sm">
                {t('home.expiring.stock')}
              </Link>
            )}
          </div>
          {(expiring ?? []).length === 0 ? (
            <div className="empty !py-8">{t('home.expiring.empty')}</div>
          ) : (
            (expiring ?? []).map((c) => (
              <div key={c.code} className="row">
                <div>
                  {/* Назва засобу і код ємності — данные заклада. */}
                  <p className="t-md">{c.material_name}</p>
                  <p className="t-xs prose-muted">
                    {t('home.expiring.container', { code: c.code })}
                  </p>
                </div>
                <span className="badge-warn tabular">
                  {t('home.expiring.until', { date: t.date(c.use_by) })}
                </span>
              </div>
            ))
          )}
        </section>
        )}

        {/* ── Что закупить ────────────────────────────────────── */}
        {seeStock && (
        <section className="card rise-3">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="t-lg">
              {t('home.reorder.title')}{' '}
              {(low ?? []).length > 0 && <span className="badge-warn tabular">{(low ?? []).length}</span>}
            </h2>
            <Link href="/app/inventory/reorder" className="btn-ghost t-sm">
              {t('home.reorder.stock')}
            </Link>
          </div>
          {(low ?? []).length === 0 ? (
            <div className="empty !py-8">{t('home.reorder.empty')}</div>
          ) : (
            (low ?? []).map((r, i) => (
              <div key={i} className="row">
                {/* Назва позиції — данные; переводится только «докупити». */}
                <p className="t-md">{r.title}</p>
                <span className="badge-warn tabular">
                  {t('home.reorder.item', { n: t.number(Number(r.to_order)) })}
                </span>
              </div>
            ))
          )}
        </section>
        )}

        {/* ── Деньги за месяц ─────────────────────────────────── */}
        {seeFinance && (
        <section className="card rise-1">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="t-lg">{t('home.finance.title')}</h2>
            <Link href="/app/finance" className="btn-ghost t-sm">{t('home.finance.all')}</Link>
          </div>

          {fin.length === 0 ? (
            <div className="empty !py-8">{t('home.finance.empty')}</div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="stat-tile">
                  <span className="stat-tile-label">{t('home.finance.income')}</span>
                  <span className="stat-tile-value">{t.money(income)}</span>
                  <span className="t-xs" style={{
                    color: delta >= 0 ? 'var(--color-success)' : 'var(--color-danger)',
                  }}>
                    {prevIncome === 0
                      ? t('home.finance.same')
                      : delta >= 0
                      ? t('home.finance.up', { n: String(delta) })
                      : t('home.finance.down', { n: String(Math.abs(delta)) })}
                  </span>
                </div>
                <div className="stat-tile">
                  <span className="stat-tile-label">{t('home.finance.expense')}</span>
                  <span className="stat-tile-value">{t.money(expense)}</span>
                </div>
              </div>

              {/* Линия накопленного дохода. Инлайновый SVG, а не библиотека:
                  ради одного графика тянуть в бандл пакет — плохая сделка,
                  а `viewBox` растягивает его по ширине карточки сам. */}
              <svg viewBox="0 0 100 36" preserveAspectRatio="none" aria-hidden
                   className="mt-4 w-full" style={{ height: 72 }}>
                <polyline points={`0,36 ${line} 100,36`} fill="var(--color-accent-soft)" stroke="none" />
                <polyline points={line} fill="none" stroke="var(--color-accent)"
                          strokeWidth="1.4" vectorEffect="non-scaling-stroke"
                          strokeLinejoin="round" strokeLinecap="round" />
              </svg>
            </>
          )}
        </section>
        )}

        {/* ── Последние заказы ────────────────────────────────── */}
        {seeOrders && (
        <section className="card rise-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="t-lg">{t('home.orders.title')}</h2>
            <Link href="/app/orders" className="btn-ghost t-sm">{t('home.orders.all')}</Link>
          </div>
          {(orders ?? []).length === 0 ? (
            <div className="empty !py-8">{t('home.orders.empty')}</div>
          ) : (
            (orders ?? []).map((o) => (
              <Link key={o.id} href={`/app/orders/${o.id}`} className="row">
                <div className="min-w-0">
                  <p className="t-md truncate">
                    <span className="tabular prose-muted">
                      {t('home.orders.number', { n: String(o.number) })}
                    </span>{' '}
                    {o.contact_name}
                  </p>
                  <p className="t-xs prose-muted tabular">{t.date(o.created_at)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="tabular t-md">{t.money(Number(o.total))}</span>
                  {/* Статус заказа — значение перечисления
                      (`order_status_transitions`), переводится подпись. */}
                  <span className={
                    o.status === 'completed' || o.status === 'delivered' ? 'badge-success'
                    : o.status === 'cancelled' || o.status === 'returned' ? 'badge-danger'
                    : o.status === 'new' ? 'badge-accent' : 'badge'
                  }>
                    {t(`orders.status.${o.status}` as 'orders.status.new')}
                  </span>
                </div>
              </Link>
            ))
          )}
        </section>
        )}

        {/* ── Напоминания ─────────────────────────────────────── */}
        {(seeContainers || seeStock) && (
        <section className="card rise-3">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="t-lg">
              {t('home.reminders.title')}{' '}
              {reminders > 0 && <span className="badge-danger tabular">{reminders}</span>}
            </h2>
          </div>

          {reminders === 0 ? (
            <div className="empty !py-8">{t('home.reminders.empty')}</div>
          ) : (
            <>
              {overdue > 0 && (
                <Link href="/app/inventory" className="row">
                  <div>
                    <p className="t-md">{t('home.reminders.overdue.title')}</p>
                    <p className="t-xs prose-muted">
                      {t('home.reminders.overdue.text', { n: String(overdue) })}
                    </p>
                  </div>
                  <span className="badge-danger tabular">{overdue}</span>
                </Link>
              )}
              {openCount && (
                <Link href={`/app/inventory/counts/${openCount.id}`} className="row">
                  <div>
                    <p className="t-md">{t('home.reminders.count.title')}</p>
                    <p className="t-xs prose-muted">
                      {t('home.reminders.count.text', { date: t.date(openCount.started_at) })}
                    </p>
                  </div>
                  <span className="badge-warn">1</span>
                </Link>
              )}
              {noNotify > 0 && (
                <Link href="/app/inventory" className="row">
                  <div>
                    <p className="t-md">{t('home.reminders.notification.title')}</p>
                    <p className="t-xs prose-muted">
                      {t('home.reminders.notification.text', { n: String(noNotify) })}
                    </p>
                  </div>
                  <span className="badge-warn tabular">{noNotify}</span>
                </Link>
              )}
            </>
          )}
        </section>
        )}
      </div>
    </AppShell>
  )
}
