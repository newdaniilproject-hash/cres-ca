import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { currentMembership } from '@/lib/tenant'
import { AppShell } from '@/components/shell'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Сьогодні' }

// Сводка дня: записи, что заканчивается, что спливає. Мастер открывает
// это утром — за десять секунд ясно, что требует внимания.
export default async function AppHome() {
  const m = await currentMembership()
  if (!m) redirect('/register/seller')
  const supabase = await createClient()

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
  const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999)

  const [{ data: shop }, { data: bookings }, { data: low }, { data: expiring }] =
    await Promise.all([
      supabase.from('tenants').select('name, status, storefront_enabled, slug')
        .eq('id', m.tenantId).single(),
      supabase.from('bookings')
        .select('id, number, title, variant_name, period, status, contact_name')
        .eq('tenant_id', m.tenantId)
        .in('status', ['booked', 'confirmed', 'arrived'])
        .gte('period', `[${todayStart.toISOString()},)`)
        .order('period').limit(20),
      supabase.from('stock_low_view').select('kind, title, to_order')
        .eq('tenant_id', m.tenantId).limit(6),
      supabase.from('material_containers')
        .select('code, use_by, materials(name)')
        .eq('tenant_id', m.tenantId)
        .eq('status', 'opened')
        .not('use_by', 'is', null)
        .lte('use_by', new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10))
        .order('use_by').limit(6),
    ])

  const todays = (bookings ?? []).filter((b) => {
    const start = new Date(String(b.period).match(/"([^"]+)"/)?.[1] ?? '')
    return start >= todayStart && start <= todayEnd
  })

  return (
    <AppShell modules={m.modules} active="/app" title={shop?.name ?? 'Кабінет'}>
      {shop && shop.status === 'draft' && (
        <div className="card-flat rise mb-6 flex flex-wrap items-center justify-between gap-3">
          <p className="t-md">
            Заклад у чернетці: облік уже працює, публічна сторінка вимкнена.
          </p>
          <Link href="/app/settings" className="btn-secondary h-9 t-sm">До публікації</Link>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Записи сегодня */}
        <section className="card rise-1">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="t-lg">Записи сьогодні</h2>
            <Link href="/app/bookings" className="btn-ghost h-8 t-sm">Усі</Link>
          </div>
          {todays.length === 0 ? (
            <div className="empty !py-8">Сьогодні записів немає</div>
          ) : (
            todays.map((b) => {
              const t = new Date(String(b.period).match(/"([^"]+)"/)?.[1] ?? '')
              return (
                <div key={b.id} className="row">
                  <div className="flex items-center gap-3">
                    <span className="tabular t-xl" style={{ color: 'var(--color-accent)' }}>
                      {t.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <div>
                      <p className="t-md">{b.contact_name}</p>
                      <p className="t-xs prose-muted">{b.title} · {b.variant_name}</p>
                    </div>
                  </div>
                  <span className={b.status === 'confirmed' ? 'badge-success' : 'badge'}>
                    {b.status === 'booked' ? 'нова' : b.status === 'arrived' ? 'у кріслі' : 'ок'}
                  </span>
                </div>
              )
            })
          )}
        </section>

        {/* Сроки годности */}
        <section className="card rise-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="t-lg">Спливає термін</h2>
            <Link href="/app/inventory" className="btn-ghost h-8 t-sm">Склад</Link>
          </div>
          {(expiring ?? []).length === 0 ? (
            <div className="empty !py-8">Найближчі два тижні — усе в межах терміну</div>
          ) : (
            (expiring ?? []).map((c) => (
              <div key={c.code} className="row">
                <div>
                  <p className="t-md">
                    {(c.materials as unknown as { name: string })?.name}
                  </p>
                  <p className="t-xs prose-muted">Ємність {c.code}</p>
                </div>
                <span className="badge-warn tabular">до {new Date(c.use_by!).toLocaleDateString('uk-UA')}</span>
              </div>
            ))
          )}
        </section>

        {/* Что закупить */}
        <section className="card rise-3 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="t-lg">Що закуповувати</h2>
            <Link href="/app/inventory" className="btn-ghost h-8 t-sm">Залишки</Link>
          </div>
          {(low ?? []).length === 0 ? (
            <div className="empty !py-8">Запасів достатньо</div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {(low ?? []).map((r, i) => (
                <span key={i} className="badge-warn tabular">
                  {r.title} · докупити {Number(r.to_order)}
                </span>
              ))}
            </div>
          )}
        </section>
      </div>
    </AppShell>
  )
}
