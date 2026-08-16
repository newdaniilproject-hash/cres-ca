import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { currentMembership, can, hasModule } from '@/lib/tenant'
import { ModuleOff } from '@/components/module-gate'
import { AppShell } from '@/components/shell'
import { FinanceClient } from './finance-client'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Фінанси' }

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

  const supabase = await createClient()

  const [
    { data: { user } },
    { data: records, error: recordsError },
    { data: sums, error: sumsError },
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
    supabase.from('finance_records')
      .select('kind, amount')
      .eq('tenant_id', m.tenantId)
      .gte('occurred_on', from).lte('occurred_on', to),
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
  for (const r of sums ?? []) {
    if (r.kind === 'income') income += Number(r.amount)
    else expense += Number(r.amount)
  }

  return (
    <AppShell modules={m.modules} perms={m.perms} active="/app/finance" title="Фінанси">
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
