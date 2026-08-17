import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { currentMembership, can, hasModule } from '@/lib/tenant'
import { ModuleOff } from '@/components/module-gate'
import { AppShell } from '@/components/shell'
import { getT } from '@/lib/i18n/server'

export const dynamic = 'force-dynamic'

// Заголовок вкладки браузера — строка интерфейса, поэтому из словаря.
// Разбор решения — в `app/app/journals/page.tsx`.
export async function generateMetadata() {
  const t = await getT()
  return { title: t('customers.meta.title') }
}

export default async function CustomersPage() {
  const m = await currentMembership()
  if (!m) redirect('/register/seller')
  if (!can(m, 'customers.read')) redirect('/app')
  if (!hasModule(m, 'customers')) return <ModuleOff m={m} module="customers" />

  const t = await getT()
  const supabase = await createClient()
  const [{ data: customers }, { data: reminders }] = await Promise.all([
    supabase.from('customers')
      .select('id, name, phone, orders_count, total_spent, last_order_at, tags')
      .eq('tenant_id', m.tenantId)
      .order('last_order_at', { ascending: false, nullsFirst: false })
      .limit(100),
    supabase.from('reminders')
      .select('id, title, due_at, customers(name)')
      .eq('tenant_id', m.tenantId).eq('status', 'pending')
      .order('due_at').limit(10),
  ])

  return (
    <AppShell modules={m.modules} perms={m.perms}>
      {(reminders ?? []).length > 0 && (
        <section className="card-flat rise mb-5">
          <h2 className="t-md mb-2">{t('customers.reminders.title')}</h2>
          <div className="flex flex-wrap gap-2">
            {(reminders ?? []).map((r) => (
              <span key={r.id} className="badge-warn tabular">
                {r.title}
                {(r.customers as unknown as { name: string })?.name
                  ? ` · ${(r.customers as unknown as { name: string }).name}` : ''}
                {' · '}{t.date(r.due_at)}
              </span>
            ))}
          </div>
        </section>
      )}

      <section className="card rise-1 !p-0">
        {(customers ?? []).length === 0 ? (
          <div className="empty">{t('customers.empty')}</div>
        ) : (customers ?? []).map((c) => (
          <div key={c.id} className="row px-5">
            <div className="min-w-0">
              <p className="t-md truncate">{c.name}</p>
              <p className="tabular t-xs mt-0.5 prose-muted">
                {c.phone ?? t('customers.noPhone')}
                {c.last_order_at
                  ? ` · ${t('customers.lastVisit', { date: t.date(c.last_order_at) })}` : ''}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {/* Символ валюты ставит Intl (`t.money`), а не подстановка «₴». */}
              {Number(c.total_spent) > 0 && (
                <span className="badge tabular">{t.money(Number(c.total_spent))}</span>
              )}
              <span className="badge-accent tabular">
                {t('customers.ordersCount', { n: Number(c.orders_count) })}
              </span>
            </div>
          </div>
        ))}
      </section>

      <p className="field-hint rise-2 mt-4">{t('customers.hint')}</p>
    </AppShell>
  )
}
