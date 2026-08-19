import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { currentMembership, can, hasModule } from '@/lib/tenant'
import { ModuleOff } from '@/components/module-gate'
import { AppShell } from '@/components/shell'
import { BookingsClient } from './bookings-client'
import { parseRange } from './staff/range'
import { dayOf, isDay, mondayOf, shiftDay } from './week'
import { isMonth, monthEnd, monthOf, monthStart } from './month'
import { getT } from '@/lib/i18n/server'

export const dynamic = 'force-dynamic'

// Заголовок вкладки браузера — строка интерфейса, поэтому из словаря.
// Разбор решения — в `app/app/journals/page.tsx`.
export async function generateMetadata() {
  const t = await getT()
  return { title: t('bookings.meta.title') }
}

// Поля записи — один список на оба вида. Второй `select` для сетки
// разъехался бы с этим на первой же добавленной колонке.
const FIELDS = 'id, number, title, variant_name, period, status, contact_name, contact_phone, price, deposit_due, staff(name)'

type Row = {
  id: string; number: number; title: string; variant_name: string
  period: unknown; status: string
  contact_name: string; contact_phone: string | null
  price: number; deposit_due: number; staff: unknown
}

// Разбор строки в то, что рисуют оба вида. `period` приходит СТРОКОЙ
// `["…","…")` — PostgREST отдаёт диапазон ровно как его печатает Postgres,
// и разбирает его общий `parseRange` (см. `./staff/range.ts`), а не своя
// регулярка на экран. Конец периода списку дня не нужен, а сетке нужен:
// высота плашки — это длительность.
const toBooking = (b: Row) => {
  const r = parseRange(String(b.period))
  return {
    id: b.id, number: b.number, title: b.title, variant: b.variant_name,
    start: r.from, end: r.to,
    status: b.status, name: b.contact_name, phone: b.contact_phone,
    price: Number(b.price), deposit: Number(b.deposit_due),
    staff: (b.staff as { name: string } | null)?.name ?? '',
  }
}

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; week?: string; month?: string; day?: string }>
}) {
  const m = await currentMembership()
  if (!m) redirect('/register/seller')
  // Записи закрыты `orders.read`, а не своим правом: отдельного
  // `bookings.*` в базе нет — политика `bookings_read` (0010) стоит
  // на `orders.read`. Без этой проверки accountant и inspector
  // открывали экран прямым адресом и видели пустой список вместо
  // внятного «этот раздел не ваш».
  if (!can(m, 'orders.read')) redirect('/app')
  // Право `orders.read` общее у записей и заказов (0010), а модули у них
  // разные: заведение может взять записи и не брать интернет-заказы.
  if (!hasModule(m, 'bookings')) return <ModuleOff m={m} module="bookings" />

  // ── Вид, день, месяц и неделя живут в АДРЕСЕ, а не в состоянии экрана ───
  //
  // `?day=2026-08-19`, `?view=calendar&month=2026-08`, `?view=week&week=…`.
  // Причина не в красоте адреса: день и неделю листают стрелками десятками
  // нажатий, и состояние экрана потеряло бы их на перезагрузке, а «назад»
  // браузера уводило бы с экрана целиком вместо предыдущего дня. Плюс
  // данные грузит сервер за нужный диапазон — держать в браузере полгода
  // записей незачем.
  const sp = await searchParams
  const view = sp.view === 'week'
    ? 'week' as const
    : sp.view === 'calendar' ? 'calendar' as const : 'day' as const

  // Умолчания — день, месяц и неделя, в которых сервер (UTC). Промахнуться
  // они могут ровно на те часы, когда в Києві уже завтра, а в UTC ещё
  // сегодня, и только если человек пришёл по адресу без параметра; сам
  // переключатель кладёт туда МЕСТНЫЙ день (см. bookings-client).
  const day = isDay(sp.day) ? sp.day : dayOf()
  const weekStart = mondayOf(isDay(sp.week) ? sp.week : day)
  const month = isMonth(sp.month) ? sp.month : monthOf(day)

  const supabase = await createClient()

  const q = supabase.from('v_bookings').select(FIELDS).eq('tenant_id', m.tenantId)

  // ОКНО ЗАПРОСА ШИРЕ ПОКАЗАННОГО НА СУТКИ С КАЖДОЙ СТОРОНЫ — и это одно
  // и то же решение во всех трёх видах. Колонку и строку выбирает БРАУЗЕР
  // в местном поясе (тот же приём, что у времени в списке: оно печатается
  // без указания зоны), а сервер отбирает в UTC. Без запаса запись
  // понедельника на 01:00 по Києву лежала бы в воскресенье по UTC и
  // в сетку не попадала бы вовсе. Лишние сутки отбрасывает сам вид.
  const window = (from: string, to: string) =>
    q.overlaps('period', `[${from}T00:00:00Z,${to}T00:00:00Z)`).order('period')

  const { data } = view === 'week'
    ? await window(shiftDay(weekStart, -1), shiftDay(weekStart, 8)).limit(300)
    : view === 'calendar'
      // Месяц целиком: в сетке у каждого дня стоит точка «здесь есть
      // записи», и посчитать её можно только по всем записям месяца.
      // Предел выше недельного — тридцать дней салона это сотни записей,
      // а обрезанный хвост означал бы дни без точек, то есть ложь
      // на единственном признаке, который сетка показывает.
      ? await window(shiftDay(monthStart(month), -1), shiftDay(monthEnd(month), 1)).limit(1000)
      : await window(shiftDay(day, -1), shiftDay(day, 2)).limit(200)

  return (
    <AppShell modules={m.modules} perms={m.perms}>
      <BookingsClient
        view={view}
        weekStart={weekStart}
        month={month}
        day={day}
        tenantId={m.tenantId}
        // `orders.write` решает только, рисовать ли «Новий запис»: то же
        // право проверяет внутри себя сам `create_booking` (0105).
        canWrite={can(m, 'orders.write')}
        bookings={((data ?? []) as unknown as Row[]).map(toBooking)}
      />
    </AppShell>
  )
}
