import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { currentMembership, can } from '@/lib/tenant'
import { AppShell } from '@/components/shell'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Клієнти' }

export default async function CustomersPage() {
  const m = await currentMembership()
  if (!m) redirect('/register/seller')
  if (!can(m, 'customers.read')) redirect('/app')

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
    <AppShell active="/app/customers" title="Клієнти">
      {(reminders ?? []).length > 0 && (
        <section className="card-flat rise mb-5">
          <h2 className="mb-2 text-sm font-medium">Нагадування</h2>
          <div className="flex flex-wrap gap-2">
            {(reminders ?? []).map((r) => (
              <span key={r.id} className="badge-warn">
                {r.title}
                {(r.customers as unknown as { name: string })?.name
                  ? ` · ${(r.customers as unknown as { name: string }).name}` : ''}
                {' · '}{new Date(r.due_at).toLocaleDateString('uk-UA')}
              </span>
            ))}
          </div>
        </section>
      )}

      <section className="card rise-1 !p-0">
        {(customers ?? []).length === 0 ? (
          <div className="empty">
            База порожня. Клієнти зʼявляються самі — з першим записом
            або замовленням, навіть гостьовим.
          </div>
        ) : (customers ?? []).map((c) => (
          <div key={c.id} className="row px-5">
            <div className="min-w-0">
              <p className="truncate font-medium">{c.name}</p>
              <p className="mt-0.5 text-xs prose-muted">
                {c.phone ?? 'без телефону'}
                {c.last_order_at
                  ? ` · останній візит ${new Date(c.last_order_at).toLocaleDateString('uk-UA')}` : ''}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {Number(c.total_spent) > 0 && (
                <span className="badge">{Number(c.total_spent).toLocaleString('uk-UA')} ₴</span>
              )}
              <span className="badge-accent">{c.orders_count} зам.</span>
            </div>
          </div>
        ))}
      </section>

      <p className="field-hint rise-2 mt-4">
        База клієнтів належить вам: вивантаження у файл — у налаштуваннях,
        у будь-який момент, без умов.
      </p>
    </AppShell>
  )
}
