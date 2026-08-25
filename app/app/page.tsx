import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { currentMembership, currentUserId, can, hasModule } from '@/lib/tenant'
import { AppShell } from '@/components/shell'
import { getT } from '@/lib/i18n/server'
import { TodayMobile, type TodayAttention } from './today-mobile'
import { TodayWeb } from './today-web'

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
  // ⚠️ `finances.read`, ВО МНОЖЕСТВЕННОМ. Здесь стояло `finance.read` —
  // права с таким ключом в `role_grants` нет вовсе, и проверка возвращала
  // false у всех, кроме владельца: у него в токене `"*"`, и `tenant_can`
  // пропускает что угодно. То есть у владельца карточка была, у менеджера
  // и бухгалтера — никогда, и без единой ошибки на экране.
  //
  // Модуль при этом называется `finance`, в единственном, и это НЕ ошибка:
  // модуль и право — разные оси с разными именами (см. «Доступ: роли
  // и модули»). Похожесть имён и есть ловушка; реестр модулей ссылается
  // на правильное `finances.read`, а этот экран расходился с ним молча.
  const seeFinance = can(m, 'finances.read') && hasModule(m, 'finance')
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
          Данные ТЕ ЖЕ, что у мобильных секций выше, — разметка своя,
          источник один (правило «общий слой вместо паритета»).
          Сама разметка — в `today-web.tsx`, разбор выноса в его шапке. */}
      <TodayWeb
        t={t}
        tenantId={m.tenantId}
        // Кнопка «Додати запис» рисуется по тому же праву, которое
        // проверяет внутри себя сам `create_booking` (0105).
        canBook={can(m, 'orders.write')}
        showBookings={seeBookings}
        showExpiring={seeContainers}
        showStock={seeStock}
        showFinance={seeFinance}
        showOrders={seeOrders}
        showReminders={seeReminders}
        bookings={todays.map((b) => ({
          id: b.id as string,
          startISO: String(b.period).match(/"([^"]+)"/)?.[1] ?? '',
          name: (b.contact_name as string) ?? '',
          service: [b.title, b.variant_name].filter(Boolean).join(' · '),
        }))}
        expiring={(expiring ?? []).map((c) => ({
          code: c.code as string,
          useBy: c.use_by as string,
          title: c.material_name as string,
        }))}
        low={(low ?? []).map((r) => ({
          title: r.title as string,
          toOrder: Number(r.to_order),
        }))}
        orders={lastOrders.map((o) => ({
          id: o.id as string,
          number: Number(o.number),
          name: (o.contact_name as string) ?? '',
          total: Number(o.total),
          status: o.status as string,
          createdAt: o.created_at as string,
        }))}
        reminders={reminders.map((r) => ({
          event: String(r.event),
          sendAfter: String(r.send_after),
        }))}
        income={monthIncome}
        expense={monthExpense}
        sparkPath={sparkPath}
        sparkPts={sparkPts}
      />
    </AppShell>
  )
}
