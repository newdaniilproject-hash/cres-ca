import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { currentMembership, can, hasModule } from '@/lib/tenant'
import { ModuleOff } from '@/components/module-gate'
import { AppShell } from '@/components/shell'
import { FinanceClient } from './finance-client'
import { getT } from '@/lib/i18n/server'

export const dynamic = 'force-dynamic'

// Заголовок вкладки браузера — строка интерфейса, поэтому из словаря.
// Разбор решения — в `app/app/journals/page.tsx`.
export async function generateMetadata() {
  const t = await getT()
  return { title: t('finance.meta.title') }
}

// occurred_on — дата без времени, поэтому границы периода считаются
// в календаре, а не в миллисекундах: toISOString сдвинул бы первое число
// месяца на предыдущее для любого часового пояса восточнее Гринвича.
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function range(period: string): { from: string; to: string } {
  const now = new Date()
  if (period === 'prev') {
    return {
      from: iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
      to: iso(new Date(now.getFullYear(), now.getMonth(), 0)),
    }
  }
  if (period === '30d') {
    return {
      from: iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29)),
      to: iso(now),
    }
  }
  return {
    from: iso(new Date(now.getFullYear(), now.getMonth(), 1)),
    to: iso(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
  }
}

// Предыдущий сопоставимый период — ровно для дельты на плитках (§15).
// Считается тем же календарём, что и `range`, и по той же причине:
// «минус 30 дней» в миллисекундах ломается на переходе на летнее время.
// Сопоставимость важнее красоты: месяц сравнивается с месяцем, окно
// в 30 дней — с предыдущими 30 днями, а не с календарным месяцем.
function prevRange(period: string): { from: string; to: string } {
  const now = new Date()
  if (period === 'prev') {
    return {
      from: iso(new Date(now.getFullYear(), now.getMonth() - 2, 1)),
      to: iso(new Date(now.getFullYear(), now.getMonth() - 1, 0)),
    }
  }
  if (period === '30d') {
    return {
      from: iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 59)),
      to: iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30)),
    }
  }
  return {
    from: iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
    to: iso(new Date(now.getFullYear(), now.getMonth(), 0)),
  }
}

export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>
}) {
  const m = await currentMembership()
  if (!m) redirect('/register/seller')
  if (!can(m, 'finances.read')) redirect('/app')
  // Единственный вместе с маркетингом модуль ВНЕ умолчания (0064, 0065):
  // именно этот адрес владелец нового заведения открывал руками и видел
  // экран финансов, которых не покупал.
  if (!hasModule(m, 'finance')) return <ModuleOff m={m} module="finance" />

  const { period: raw } = await searchParams
  const period = raw === 'prev' || raw === '30d' ? raw : 'month'
  const { from, to } = range(period)
  const prev = prevRange(period)

  const supabase = await createClient()

  const [
    { data: { user } },
    { data: records, error: recordsError },
    { data: sums, error: sumsError },
    { data: prevSums },
    { data: categories, error: categoriesError },
  ] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from('finance_records')
      .select('id, kind, amount, note, occurred_on, order_id, category_id, orders(number)')
      .eq('tenant_id', m.tenantId)
      .gte('occurred_on', from).lte('occurred_on', to)
      .order('occurred_on', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(200),
    // Итоги считаются отдельным запросом по всему периоду, а не по видимым
    // двумстам строкам: плитки обязаны сойтись с реальностью, даже когда
    // список обрезан. Тянутся только вид и сумма — это дёшево.
    //
    // `occurred_on` тянется здесь же ради графика «Динаміка доходу»:
    // строить его по видимым двумстам строкам значило бы рисовать провал
    // в начале месяца ровно там, где список обрезан, а не там, где не было
    // дохода. Колонка дешёвая, второго запроса не нужно.
    supabase.from('finance_records')
      .select('kind, amount, occurred_on')
      .eq('tenant_id', m.tenantId)
      .gte('occurred_on', from).lte('occurred_on', to),
    // Прошлый период — ТОЛЬКО ради дельты на плитках. Ошибка этого запроса
    // намеренно не попадает в `error`: без дельты экран полон, а красная
    // строка про «не всі дані» из-за подписи под числом пугает зря.
    supabase.from('finance_records')
      .select('kind, amount')
      .eq('tenant_id', m.tenantId)
      .gte('occurred_on', prev.from).lte('occurred_on', prev.to),
    supabase.from('finance_categories')
      .select('id, kind, name, is_active')
      .eq('tenant_id', m.tenantId)
      .order('kind').order('position').order('name'),
  ])

  // Сегодняшнюю дату для формы считает сервер: если бы её брал браузер,
  // разметка сервера и клиента расходилась бы на границе суток —
  // сервер живёт в UTC, продавец в Києві.
  const today = iso(new Date())

  let income = 0
  let expense = 0
  // Доход по дням — для графика. Ключ карты это сама дата `occurred_on`,
  // а не индекс: день без единой записи в карту не попадает и обязан
  // превратиться в ноль ниже, иначе кривая «перепрыгнет» пустые дни.
  const byDay = new Map<string, number>()
  for (const r of sums ?? []) {
    const amount = Number(r.amount)
    if (r.kind === 'income') {
      income += amount
      byDay.set(r.occurred_on, (byDay.get(r.occurred_on) ?? 0) + amount)
    } else expense += amount
  }

  let prevIncome = 0
  let prevExpense = 0
  for (const r of prevSums ?? []) {
    if (r.kind === 'income') prevIncome += Number(r.amount)
    else prevExpense += Number(r.amount)
  }

  // Ряд по дням периода. Конец — сегодня, а не конец месяца: хвост из
  // будущих нулей читается как обвал дохода, хотя этих дней ещё не было.
  const series: { day: string; value: number }[] = []
  for (
    const cursor = new Date(`${from}T00:00:00`);
    iso(cursor) <= (to < today ? to : today) && series.length < 40;
    cursor.setDate(cursor.getDate() + 1)
  ) {
    const key = iso(cursor)
    series.push({ day: key, value: byDay.get(key) ?? 0 })
  }

  return (
    <AppShell modules={m.modules} perms={m.perms}>
      <FinanceClient
        tenantId={m.tenantId}
        userId={user?.id ?? ''}
        canWrite={can(m, 'finances.write')}
        period={period}
        from={from}
        to={to}
        today={today}
        income={income}
        expense={expense}
        prevIncome={prevIncome}
        prevExpense={prevExpense}
        // Число операций — по ВСЕМУ периоду, как и суммы: это тот же
        // запрос итогов, а не длина обрезанного списка.
        operations={(sums ?? []).length}
        series={series}
        error={[recordsError?.message, sumsError?.message, categoriesError?.message]
          .filter(Boolean).join(' · ')}
        records={(records ?? []).map((r) => ({
          id: r.id,
          kind: r.kind === 'income' ? 'income' as const : 'expense' as const,
          amount: Number(r.amount),
          note: r.note,
          occurredOn: r.occurred_on,
          categoryId: r.category_id,
          orderId: r.order_id,
          // Заказ подтягивается связью по order_id. Если у роли нет
          // orders.read, RLS вернёт здесь null — тогда просто не покажем
          // номер, а сама запись дохода останется на месте.
          orderNumber: (r.orders as unknown as { number: number } | null)?.number ?? null,
        }))}
        categories={(categories ?? []).map((c) => ({
          id: c.id,
          kind: c.kind === 'income' ? 'income' as const : 'expense' as const,
          name: c.name,
          isActive: c.is_active,
        }))}
      />
    </AppShell>
  )
}
