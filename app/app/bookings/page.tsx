import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { currentMembership, can, hasModule } from '@/lib/tenant'
import { ModuleOff } from '@/components/module-gate'
import { AppShell } from '@/components/shell'
import { BookingsClient } from './bookings-client'
import { parseRange } from './staff/range'
import { dayOf, isDay, mondayOf, shiftDay } from './week'
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
  searchParams: Promise<{ view?: string; week?: string }>
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

  // ── Вид и неделя живут в АДРЕСЕ, а не в состоянии экрана ────────────────
  //
  // `?view=week&week=2026-08-17`. Причина не в красоте адреса: неделю
  // листают стрелками десятками нажатий, и состояние экрана потеряло бы
  // её на перезагрузке, а «назад» браузера уводило бы с экрана целиком
  // вместо предыдущей недели. Плюс данные грузит сервер за нужный
  // диапазон — держать в браузере полгода записей незачем.
  const sp = await searchParams
  const view = sp.view === 'week' ? 'week' as const : 'day' as const
  // Умолчание — неделя, в которой сервер (UTC). Промахнуться она может
  // ровно на те три часа в неделю, когда в Києві уже понедельник, а в UTC
  // ещё воскресенье, и только если человек пришёл по адресу без `week`;
  // сам переключатель кладёт туда МЕСТНЫЙ понедельник (см. bookings-client).
  const weekStart = mondayOf(isDay(sp.week) ? sp.week : dayOf())

  const supabase = await createClient()

  const q = supabase.from('v_bookings').select(FIELDS).eq('tenant_id', m.tenantId)

  const { data } = view === 'week'
    // Окно шире недели на сутки с каждой стороны. Колонку дня выбирает
    // БРАУЗЕР в местном поясе (тот же приём, что у списка дня: он печатает
    // время без указания зоны), а сервер отбирает в UTC. Без запаса запись
    // понедельника на 01:00 по Києву лежала бы в воскресенье по UTC
    // и в сетку не попадала бы вовсе. Лишние сутки отбрасывает сама сетка.
    ? await q
      .overlaps('period', `[${shiftDay(weekStart, -1)}T00:00:00Z,${shiftDay(weekStart, 8)}T00:00:00Z)`)
      .order('period')
      .limit(300)
    // Список дня — как был: ближайшее, начиная со вчера.
    : await q
      .gte('period', `[${new Date(Date.now() - 864e5).toISOString()},)`)
      .order('period')
      .limit(100)

  return (
    <AppShell modules={m.modules} perms={m.perms}>
      <BookingsClient
        view={view}
        weekStart={weekStart}
        tenantId={m.tenantId}
        // `orders.write` решает только, рисовать ли «Новий запис»: то же
        // право проверяет внутри себя сам `create_booking` (0105).
        canWrite={can(m, 'orders.write')}
        bookings={((data ?? []) as unknown as Row[]).map(toBooking)}
      />
    </AppShell>
  )
}
