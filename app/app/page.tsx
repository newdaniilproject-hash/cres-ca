import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { currentMembership, currentUserId, can, hasModule } from '@/lib/tenant'
import { AppShell } from '@/components/shell'
import { getT } from '@/lib/i18n/server'
import { IconBox, IconCalendar, IconClock } from '@/components/icons'
import { TodayMobile, type TodayAttention } from './today-mobile'

export const dynamic = 'force-dynamic'

// Заголовок вкладки браузера — строка интерфейса, поэтому из словаря.
// Разбор решения — в `app/app/journals/page.tsx`.
export async function generateMetadata() {
  const t = await getT()
  return { title: t('home.meta.title') }
}

// Сводка дня: записи, что заканчивается, что спливає. Мастер открывает
// это утром — за десять секунд ясно, что требует внимания.
export default async function AppHome() {
  const m = await currentMembership()
  if (!m) redirect('/register/seller')
  // Экран серверный, поэтому переводчик берётся `await getT()`, а не хуком.
  const t = await getT()
  const supabase = await createClient()

  // ЭТОТ экран правом не закрывается и закрыт быть не может: он —
  // адрес, куда уходит `redirect('/app')` со всех остальных страниц.
  // Проверка права здесь означала бы цикл редиректов.
  //
  // Поэтому здесь другой приём той же задачи: каждый блок сводки
  // спрашивает своё право САМ, и запрос под него даже не отправляется.
  // Иначе получалось наоборот: accountant видел «Сьогодні записів немає»
  // и «Запасів достатньо» — три бодрых утверждения о заведении, ни одно
  // из которых он не имеет права знать и ни одно из которых не правда.
  // Пустой блок здесь не безобиден: по нему принимают решения утром.
  //
  // Со второй осью здесь ровно то же самое, и по той же причине. Экран
  // модулем не закрывается — он адрес всех редиректов, а `ModuleOff`
  // вместо сводки означал бы «кабинета нет». Значит модуль спрашивает
  // каждый блок сам, рядом со своим правом: набор `modules` описывает,
  // что заведение вообще брало, и блок раздела, которого у заклада нет,
  // утверждает о нём то, чего оно не покупало. «Сьогодні записів немає»
  // без модуля `bookings` — не пустота, а неправда: записей нет не потому,
  // что день свободен. Пара `право && модуль` считается один раз здесь,
  // и под невыполненную — запрос не отправляется вовсе.
  const seeBookings = can(m, 'orders.read') && hasModule(m, 'bookings')     // bookings_read (0010)
  const seeStock = can(m, 'stock.read') && hasModule(m, 'inventory')        // stock_low_view (0009)
  const seeContainers = can(m, 'compliance.read') && hasModule(m, 'compliance') // compliance_containers (0035)
  const seeSettings = can(m, 'settings.read')
  const seeOrders = can(m, 'orders.read') && hasModule(m, 'orders')
  const seeFinance = can(m, 'finance.read') && hasModule(m, 'finance')
  // Нагадування — это НАСТОЯЩАЯ очередь уведомлений (напоминания за 24ч/2ч
  // к записям), а не выдуманный список: политика чтения — customers.read.
  const seeReminders = can(m, 'customers.read')
  // Витрина — отдельный модуль, и у экрана настроек его нет: «Магазин»
  // в панели не помечен модулем, потому что там же лежат данные закладу,
  // команда и удаление аккаунта. Модулю `storefront` принадлежит не
  // страница, а публичная сторінка заклада — и всё, что о ней говорит.
  const seeStorefront = hasModule(m, 'storefront')

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
  const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999)
  const userId = await currentUserId()

  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0)
  const monthIso = monthStart.toISOString().slice(0, 10)

  const [{ data: shop }, { data: me }, bookingsRes, lowRes, expiringRes,
         ordersRes, financeRes, remindersRes] =
    await Promise.all([
      // `storefront_enabled` и `slug` отсюда убраны: их не читал никто,
      // а сведения это витринные — набирать их в запрос заведению без
      // модуля `storefront` незачем. Имя нужно заголовку, `status` —
      // плашке «у чернетці», и она ниже спрашивает модуль.
      supabase.from('tenants').select('name, status')
        .eq('id', m.tenantId).single(),
      // Имя человека для карточки-героя. `currentUserId()` берёт id
      // из уже разобранного токена (без сети, CLAUDE.md → правило 3),
      // а `full_name` — это ОДИН лёгкий запрос к своей же строке
      // `profiles`, а не поход к серверу авторизации.
      userId
        ? supabase.from('profiles').select('full_name').eq('id', userId).maybeSingle()
        : Promise.resolve({ data: null }),
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
      // `compliance_containers.material_name` — та же величина, но взятая
      // внутри представления, где арендатор отсекается его собственным
      // WHERE по `compliance.read` (0062).
      seeContainers ? supabase.from('compliance_containers')
        .select('code, use_by, material_name')
        .eq('tenant_id', m.tenantId)
        .eq('status', 'opened')
        .not('use_by', 'is', null)
        .lte('use_by', new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10))
        .order('use_by').limit(6) : null,
      // Три запроса ниже — только для ДЕСКТОПНОГО дашборда (CRESKO Web,
      // экран «Сьогодні»): последние заказы, финансы месяца, напоминания.
      // Телефон эти карточки не рисует, но запросы дешёвые и идут одним
      // Promise.all — отдельная десктопная загрузка стоила бы дороже.
      seeOrders ? supabase.from('orders')
        .select('id, number, total, status, contact_name, created_at')
        .eq('tenant_id', m.tenantId)
        .order('created_at', { ascending: false }).limit(4) : null,
      seeFinance ? supabase.from('finance_records')
        .select('kind, amount, occurred_on')
        .eq('tenant_id', m.tenantId)
        .gte('occurred_on', monthIso).limit(1000) : null,
      seeReminders ? supabase.from('notification_outbox')
        .select('event, send_after, payload')
        .eq('tenant_id', m.tenantId)
        .eq('status', 'pending')
        .gt('send_after', new Date().toISOString())
        .order('send_after').limit(3) : null,
    ])

  const bookings = bookingsRes?.data ?? null
  const low = lowRes?.data ?? null
  const expiring = expiringRes?.data ?? null

  const todays = (bookings ?? []).filter((b) => {
    const start = new Date(String(b.period).match(/"([^"]+)"/)?.[1] ?? '')
    return start >= todayStart && start <= todayEnd
  })

  // «Потребує уваги» — сумма двух разных бед: ёмкость на подходе к сроку
  // и позиция на исходе. Собирается ОДНИМ списком, а не двумя секциями,
  // потому что в карточке-герое это одно число: раздельные блоки не давали
  // ему ни одного выхода и при этом вели двумя ссылками в один «Склад».
  //
  // Записи без подтверждения в это число больше не входят. Они уже видны
  // выше — своей строкой в расписании и жёлтым бейджем «нова», — а число,
  // которое больше списка под ним, читается как потерянные строки.
  //
  // Ссылки: страницы склада стоят на `stock.read` И модуле `inventory`
  // (это и есть `seeStock`). Без него строка не ведёт никуда — ссылка,
  // разворачивающая обратно сюда, хуже её отсутствия.
  const stockHref = seeStock ? '/app/inventory' : null
  const soon = Date.now() + 3 * 864e5
  const attention: TodayAttention[] = [
    ...(expiring ?? []).map((c) => ({
      key: `c:${c.code}`,
      title: c.material_name as string,
      sub: t('home.expiring.container', { code: c.code as string }),
      badge: t('home.expiring.until', { date: t.date(c.use_by) }),
      hot: new Date(c.use_by as string).getTime() <= soon,
      href: stockHref,
    })),
    ...(low ?? []).map((r, i) => ({
      key: `l:${i}`,
      title: r.title as string,
      sub: t('home.attention.low'),
      badge: t('home.reorder.item', { n: t.number(Number(r.to_order)) }),
      href: seeStock ? '/app/inventory/reorder' : null,
    })),
  ]

  const firstName = (me?.full_name ?? '').trim().split(/\s+/)[0] || ''

  // ── Данные десктопного дашборда ──────────────────────────────────────
  const lastOrders = ordersRes?.data ?? []
  const finRows = (financeRes?.data ?? []) as { kind: string; amount: number; occurred_on: string }[]
  let monthIncome = 0; let monthExpense = 0
  const byDay = new Map<string, number>()
  for (const r of finRows) {
    const a = Number(r.amount)
    if (r.kind === 'income') {
      monthIncome += a
      byDay.set(r.occurred_on, (byDay.get(r.occurred_on) ?? 0) + a)
    } else monthExpense += a
  }
  // Спарклайн дохода по дням месяца. Точки строит сервер, кривую — SVG:
  // сглаживание кубическими Безье через средние точки, как в README.
  const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate()
  const daySums: number[] = []
  for (let d = 1; d <= Math.min(daysInMonth, new Date().getDate()); d++) {
    const key = `${monthIso.slice(0, 8)}${String(d).padStart(2, '0')}`
    daySums.push(byDay.get(key) ?? 0)
  }
  const sparkMax = Math.max(1, ...daySums)
  const sparkPts = daySums.map((v, i) => [
    daySums.length > 1 ? (i / (daySums.length - 1)) * 300 : 150,
    96 - (v / sparkMax) * 84,
  ] as const)
  const sparkPath = sparkPts.length < 2 ? '' : sparkPts.reduce((acc, p, i, a) => {
    if (i === 0) return `M ${p[0]} ${p[1]}`
    const prev = a[i - 1]
    const mx = (prev[0] + p[0]) / 2
    return `${acc} C ${mx} ${prev[1]}, ${mx} ${p[1]}, ${p[0]} ${p[1]}`
  }, '')
  const reminders = remindersRes?.data ?? []

  return (
    <AppShell modules={m.modules} perms={m.perms}>
      {/* Кнопка ведёт на /app/settings, а туда пускает только
          `settings.read`. Показывать её тому, кого экран настроек
          развернёт обратно, значит завести ту самую сломанную
          навигацию, ради которой всё это и делается.

          Плюс модуль `storefront`: вся плашка — про публичную сторінку.
          Без модуля витрины «публічна сторінка вимкнена» и «До публікації»
          обещают заведению публикацию, которой оно не покупало, — и ведут
          к блоку настроек, который при выключенном модуле не рисуется. */}
      {shop && shop.status === 'draft' && seeSettings && seeStorefront && (
        <div className="card-flat rise mb-6 flex flex-wrap items-center justify-between gap-3">
          <p className="t-md">{t('home.draft.notice')}</p>
          <Link href="/app/settings" className="btn-secondary t-sm">
            {t('home.draft.publish')}
          </Link>
        </div>
      )}

      {/* ── Телефон: приветствие, карточка дня, расписание, «потребує уваги» ──
          Разметка живёт в `today-mobile.tsx` — там же разбор, почему
          она вынесена и почему это не клиентский компонент. Сюда
          приходят только уже посчитанные значения.

          Приветствие БЕЗ «доброго ранку/дня/вечора»: часы для этого выбора
          были бы СЕРВЕРНЫЕ (функция физически рисует страницу в Дублине),
          а не человека в Києві — «доброго ранку» провисело бы до полудня
          по местному времени продавца. Дешевле и честнее одно приветствие
          без времени суток, чем неправильное время суток. */}
      <TodayMobile
        t={t}
        name={firstName}
        showBookings={seeBookings}
        showAttention={seeContainers || seeStock}
        bookings={todays.map((b) => ({
          id: b.id as string,
          startISO: String(b.period).match(/"([^"]+)"/)?.[1] ?? '',
          name: (b.contact_name as string) ?? '',
          service: [b.title, b.variant_name].filter(Boolean).join(' · '),
          status: b.status as string,
        }))}
        attention={attention}
      />

      {/* ── CRESKO Web: дашборд «Сьогодні» (только lg) ─────────────
          README §1: H1 29px с датой, два ряда по три карточки.
          Данные ТЕ ЖЕ, что у мобильных секций ниже, — разметка своя,
          источник один (правило «общий слой вместо паритета»). */}
      <div className="mb-5 hidden items-center justify-between lg:flex">
        <div className="flex items-baseline gap-3">
          <h1 className="webh1">{t('home.web.title')}</h1>
          <span className="flex items-center gap-1.5" style={{ fontSize: 14, color: 'var(--web-muted-soft, var(--color-muted))' }}>
            <IconCalendar size={15} />
            {t.date(new Date(), { day: 'numeric', month: 'long', weekday: 'long' })}
          </span>
        </div>
        {seeBookings && (
          <div className="flex gap-2">
            <Link href="/app/bookings" className="btn-secondary">{t('home.web.calendar')}</Link>
            <Link href="/app/bookings" className="btn-primary">{t('home.web.addBooking')}</Link>
          </div>
        )}
      </div>
      <div className="hidden gap-5 lg:grid lg:grid-cols-3">
        {seeBookings && (
          <section className="webcard">
            <div className="mb-3 flex items-center justify-between">
              <p className="webh2" style={{ fontSize: 15 }}>{t('home.bookings.title')}</p>
              {todays.length > 0 && <span className="badge tabular">{t.number(todays.length)}</span>}
            </div>
            {todays.length === 0
              ? <p className="t-sm prose-muted">{t('home.bookings.empty')}</p>
              : todays.slice(0, 4).map((b) => {
                  const start = new Date(String(b.period).match(/"([^"]+)"/)?.[1] ?? '')
                  return (
                    <div key={b.id} className="flex items-center gap-3 py-2"
                         style={{ borderBottom: '1px dashed var(--web-border-dash, var(--color-border))' }}>
                      <span className="list-anchor shrink-0"
                            style={{ width: 36, height: 36, background: 'var(--color-accent-soft)', color: 'var(--color-accent-ink)' }}>
                        {(b.contact_name || '?').trim().charAt(0).toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate" style={{ fontSize: 14, fontWeight: 650 }}>{b.contact_name}</span>
                        <span className="block truncate" style={{ fontSize: 12, color: 'var(--color-muted)' }}>
                          {b.title} · {b.variant_name}
                        </span>
                      </span>
                      <span className="tabular shrink-0" style={{ fontSize: 13, fontWeight: 650 }}>
                        {t.dateTime(start, { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  )
                })}
            <Link href="/app/bookings" className="webcard-link">{t('home.web.allBookings')}</Link>
          </section>
        )}
        {seeContainers && (
          <section className="webcard">
            <div className="mb-3 flex items-center justify-between">
              <p className="webh2" style={{ fontSize: 15 }}>{t('home.expiring.title')}</p>
              {(expiring ?? []).length > 0 && <span className="badge-danger tabular">{t.number((expiring ?? []).length)}</span>}
            </div>
            {(expiring ?? []).length === 0
              ? <p className="t-sm prose-muted">{t('home.expiring.empty')}</p>
              : (expiring ?? []).slice(0, 4).map((c) => {
                  const days = Math.ceil((new Date(c.use_by as string).getTime() - Date.now()) / 864e5)
                  const toneVar = days <= 1 ? '--color-danger' : days <= 5 ? '--color-warn' : '--color-success'
                  return (
                    <div key={c.code} className="flex items-center gap-3 py-2"
                         style={{ borderBottom: '1px dashed var(--web-border-dash, var(--color-border))' }}>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate" style={{ fontSize: 14, fontWeight: 650 }}>{c.material_name}</span>
                        <span className="block truncate" style={{ fontSize: 12, color: 'var(--color-muted)' }}>
                          {t('home.expiring.container', { code: c.code })}
                        </span>
                      </span>
                      <span className="tabular shrink-0 text-right">
                        <span className="block" style={{ fontSize: 13, fontWeight: 650, color: `var(${toneVar})` }}>
                          {t.date(c.use_by)}
                        </span>
                        <span className="block" style={{ fontSize: 11, color: 'var(--color-muted)' }}>
                          {t.plural('inventory.days', Math.max(days, 0))}
                        </span>
                      </span>
                    </div>
                  )
                })}
            {seeStock && <Link href="/app/inventory" className="webcard-link">{t('home.web.allExpiry')}</Link>}
          </section>
        )}
        {seeStock && (
          <section className="webcard">
            <div className="mb-3 flex items-center justify-between">
              <p className="webh2" style={{ fontSize: 15 }}>{t('home.reorder.title')}</p>
              {(low ?? []).length > 0 && <span className="badge-warn tabular">{t.number((low ?? []).length)}</span>}
            </div>
            {(low ?? []).length === 0
              ? <p className="t-sm prose-muted">{t('home.reorder.empty')}</p>
              : (low ?? []).slice(0, 6).map((r, i) => (
                  <div key={i} className="flex items-center gap-3 py-2"
                       style={{ borderBottom: '1px dashed var(--web-border-dash, var(--color-border))' }}>
                    <span className="wmetric-icon shrink-0" data-tone={i % 2 ? 'violet' : 'blue'}
                          style={{ width: 34, height: 34 }}>
                      <IconBox size={17} />
                    </span>
                    <span className="min-w-0 flex-1 truncate" style={{ fontSize: 14, fontWeight: 650 }}>{r.title}</span>
                    <span className="tabular shrink-0" style={{ fontSize: 12, color: 'var(--color-muted)' }}>
                      {t('home.reorder.item', { n: t.number(Number(r.to_order)) })}
                    </span>
                  </div>
                ))}
            <Link href="/app/inventory/reorder" className="webcard-link">{t('home.web.makeOrder')}</Link>
          </section>
        )}
        {seeFinance && (
          <section className="webcard">
            <p className="webh2 mb-3" style={{ fontSize: 15 }}>{t('home.web.finance')}</p>
            <div className="mb-3 grid grid-cols-2 gap-3">
              <div className="rounded-xl p-3" style={{ background: 'var(--color-success-soft)' }}>
                <p style={{ fontSize: 12, color: 'var(--color-muted)' }}>{t('finance.form.income')}</p>
                <p className="tabular" style={{ fontSize: 19, fontWeight: 800, color: 'var(--color-success)' }}>
                  {t.money(monthIncome)}
                </p>
              </div>
              <div className="rounded-xl p-3" style={{ background: 'var(--color-danger-soft)' }}>
                <p style={{ fontSize: 12, color: 'var(--color-muted)' }}>{t('finance.form.expense')}</p>
                <p className="tabular" style={{ fontSize: 19, fontWeight: 800, color: 'var(--color-danger)' }}>
                  {t.money(monthExpense)}
                </p>
              </div>
            </div>
            {/* Спарклайн дохода по дням: кривая через средние точки (README),
                заливка 10% тона, точки на узлах. Пусто — не рисуем осей в никуда. */}
            {sparkPath && (
              <svg viewBox="0 0 300 104" className="w-full" style={{ height: 104 }} aria-hidden>
                <path d={`${sparkPath} L 300 104 L 0 104 Z`} fill="var(--tone-blue-soft)" stroke="none" />
                <path d={sparkPath} fill="none" stroke="var(--tone-blue)" strokeWidth="2.4" />
                {sparkPts.map((p, i) => (
                  <circle key={i} cx={p[0]} cy={p[1]} r="3.4" fill="var(--tone-blue)" />
                ))}
              </svg>
            )}
            <Link href="/app/finance" className="webcard-link">{t('home.web.allFinance')}</Link>
          </section>
        )}
        {seeOrders && (
          <section className="webcard">
            <p className="webh2 mb-3" style={{ fontSize: 15 }}>{t('home.web.orders')}</p>
            {lastOrders.length === 0
              ? <p className="t-sm prose-muted">{t('home.web.orders.empty')}</p>
              : lastOrders.map((o) => (
                  <div key={o.id} className="flex items-center gap-3 py-2"
                       style={{ borderBottom: '1px dashed var(--web-border-dash, var(--color-border))' }}>
                    <span className="tabular shrink-0" style={{ fontSize: 13, fontWeight: 650 }}>№ {o.number}</span>
                    <span className="min-w-0 flex-1 truncate" style={{ fontSize: 13, color: 'var(--web-text-secondary, var(--color-muted))' }}>
                      {o.contact_name}
                    </span>
                    <span className="tabular shrink-0" style={{ fontSize: 13, fontWeight: 700 }}>{t.money(Number(o.total))}</span>
                  </div>
                ))}
            <Link href="/app/orders" className="webcard-link">{t('home.web.allOrders')}</Link>
          </section>
        )}
        {seeReminders && (
          <section className="webcard">
            <p className="webh2 mb-3" style={{ fontSize: 15 }}>{t('home.web.reminders')}</p>
            {reminders.length === 0
              ? <p className="t-sm prose-muted">{t('home.web.reminders.empty')}</p>
              : reminders.map((r, i) => (
                  <div key={i} className="flex items-center gap-3 py-2"
                       style={{ borderBottom: '1px dashed var(--web-border-dash, var(--color-border))' }}>
                    <span className="wmetric-icon shrink-0" data-tone="amber" style={{ width: 34, height: 34 }}>
                      <IconClock size={17} />
                    </span>
                    <span className="min-w-0 flex-1">
                      {/* Событие очереди — служебный код; человеку — подпись. */}
                      <span className="block truncate" style={{ fontSize: 14, fontWeight: 650 }}>
                        {String(r.event).startsWith('booking')
                          ? t('home.web.reminder.booking')
                          : t('home.web.reminder.other')}
                      </span>
                      <span className="block truncate" style={{ fontSize: 12, color: 'var(--color-muted)' }}>
                        {t.dateTime(r.send_after)}
                      </span>
                    </span>
                  </div>
                ))}
          </section>
        )}
      </div>
    </AppShell>
  )
}
