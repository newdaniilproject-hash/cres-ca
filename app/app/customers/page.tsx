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

// Отборы списка. Значения мехАнические, а не оценочные: «постійний клієнт»
// — это суждение, которого в продукте нет, и вводить его раскладкой экрана
// нельзя. Здесь только то, что считается по колонкам без домыслов.
const FILTERS = ['all', 'month', 'idle'] as const
type Filter = (typeof FILTERS)[number]

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>
}) {
  const m = await currentMembership()
  if (!m) redirect('/register/seller')
  if (!can(m, 'customers.read')) redirect('/app')
  if (!hasModule(m, 'customers')) return <ModuleOff m={m} module="customers" />

  const { filter } = await searchParams
  const active: Filter =
    (FILTERS as readonly string[]).includes(filter ?? '') ? (filter as Filter) : 'all'

  const t = await getT()
  const supabase = await createClient()

  // Граница месяца считается НА СЕРВЕРЕ и уезжает в запрос. Считать её
  // в браузере значило бы получить одну дату при отрисовке на сервере
  // и другую в гидратации — тот же класс расхождения, что и с темой.
  const now = new Date()
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()

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
  // Счётчики — тремя запросами БЕЗ строк (`head: true`), как на экране
  // заказов, и по той же причине: выдача обрезана сотней, и посчитанное
  // из неё «усього 100» у базы в тысячу человек — враньё в плитке.
  // `is_active` — 0134. Прибраний клієнт зникає зі списку і з лічильників
  // разом: список без нього, а лічильник із ним — це два різні числа
  // на одному екрані, і людина побачить «усього 12» над одинадцятьма
  // рядками. Фільтр тому стоїть в ОБОХ місцях, а не в одному.
  const countOf = (kind: Filter) => {
    let q = supabase.from('customers')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', m.tenantId)
      .eq('is_active', true)
    if (kind === 'month') q = q.gte('last_order_at', monthStart)
    if (kind === 'idle') q = q.eq('orders_count', 0)
    return q
  }

  let list = supabase.from('customers')
    .select('id, name, orders_count, total_spent, last_order_at, tags')
    .eq('tenant_id', m.tenantId)
    .eq('is_active', true)
  if (active === 'month') list = list.gte('last_order_at', monthStart)
  if (active === 'idle') list = list.eq('orders_count', 0)

  const [{ data: customers }, { data: reminders }, all, month, idle] = await Promise.all([
    list.order('last_order_at', { ascending: false, nullsFirst: false }).limit(100),
    supabase.from('reminders')
      .select('id, title, due_at, customers(name)')
      .eq('tenant_id', m.tenantId).eq('status', 'pending')
      .order('due_at').limit(10),
    countOf('all'),
    countOf('month'),
    countOf('idle'),
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

      {/* `customers.write` решает только, рисовать ли кнопку «Додати
          клієнта»: сама вставка идёт под политикой `customers_insert`
          (0006), и без права она откажет независимо от кнопки. */}
      <CustomersClient tenantId={m.tenantId} customers={customers ?? []}
                       active={active}
                       stats={{
                         all: all.count ?? 0,
                         month: month.count ?? 0,
                         idle: idle.count ?? 0,
                       }}
                       canWrite={can(m, 'customers.write')} />

      <p className="field-hint rise-2 mt-4">{t('customers.hint')}</p>
    </AppShell>
  )
}
