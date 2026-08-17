import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { currentMembership, can, hasModule } from '@/lib/tenant'
import { ModuleOff } from '@/components/module-gate'
import { AppShell } from '@/components/shell'
import { CustomersClient } from './customers-client'
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

  // ⚠️ КОЛОНКИ `phone` И `email` ЗДЕСЬ НЕ ЗАПРАШИВАЮТСЯ, И ЭТО РЕШЕНИЕ,
  // А НЕ ЭКОНОМИЯ. Контакт клиента отдаёт `customer_card` (0090): она
  // проверяет право `customers.contacts`, маскирует телефон и почту тому,
  // у кого его нет, и пишет строку в журнал доступа. Список, который
  // показывает контакты сам, обходит всё три вещи разом — и именно так
  // «кто выгрузил базу» перестаёт иметь ответ.
  //
  // Что этим НЕ закрыто: политика чтения самой таблицы висит на
  // `customers.read`, значит те же колонки достаются прямым запросом
  // к PostgREST мимо этого экрана. Разбор и починка — notes/pii-leaks.md,
  // пункт 1; она меняет права на таблицу, то есть соседний модуль.
  const [{ data: customers }, { data: reminders }] = await Promise.all([
    supabase.from('customers')
      .select('id, name, orders_count, total_spent, last_order_at, tags')
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

      <CustomersClient tenantId={m.tenantId} customers={customers ?? []} />

      <p className="field-hint rise-2 mt-4">{t('customers.hint')}</p>
    </AppShell>
  )
}
