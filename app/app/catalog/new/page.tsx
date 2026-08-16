import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { currentMembership, can, hasModule } from '@/lib/tenant'
import { ModuleOff } from '@/components/module-gate'
import { AppShell } from '@/components/shell'
import { OfferingForm, type CategoryRow, type LocationRow } from '../offering-form'
import { getT } from '@/lib/i18n/server'

export const dynamic = 'force-dynamic'

// Заголовок вкладки браузера — строка интерфейса, поэтому из словаря.
// Разбор решения — в `app/app/journals/page.tsx`.
export async function generateMetadata() {
  const t = await getT()
  return { title: t('catalog.new.meta.title') }
}

// Справочники (категории платформы и места хранения) грузим здесь, а не
// в форме: они одинаковы для всех позиций и не меняются во время заполнения.
export default async function NewOfferingPage() {
  const m = await currentMembership()
  if (!m) redirect('/register/seller')
  // Здесь `catalog.write`, а не `.read`: экран целиком состоит из формы
  // создания, режима «тільки читання» у него нет. С одним лишь
  // `catalog.read` (operator, viewer, accountant) человек заполнял всю
  // форму и упирался в отказ политики `offerings_insert` на кнопке
  // «Зберегти» — потерянная работа вместо запрета на входе.
  if (!can(m, 'catalog.write')) redirect('/app/catalog')
  // Модуль — после права и здесь, но отказ рисуется экраном, а не
  // редиректом на `/app/catalog`: тот при выключенном модуле показывает
  // ровно тот же `ModuleOff`, и лишний переход только съел бы объяснение.
  if (!hasModule(m, 'catalog')) return <ModuleOff m={m} module="catalog" />

  const supabase = await createClient()

  const [{ data: categories }, { data: locations }] = await Promise.all([
    supabase.from('categories')
      .select('id, name, kind').eq('is_active', true)
      .order('position').order('name').limit(300),
    supabase.from('storage_locations')
      .select('id, name').eq('tenant_id', m.tenantId)
      .eq('is_active', true).order('position'),
  ])

  return (
    <AppShell>
      <OfferingForm
        tenantId={m.tenantId}
        // Сюда без `catalog.write` не попасть — редирект выше. Значение
        // всё равно приходит из `can()`, а не константой `true`: одно
        // место правды на оба экрана формы.
        canWrite={can(m, 'catalog.write')}
        canStock={can(m, 'stock.read')}
        // Модули соседних разделов: витрина решает, показывать ли галку
        // «в загальному каталозі» и публичный адрес позиции, записи —
        // блок «Умови запису». Считаются на сервере: клиент за членством
        // не ходит (правило 3).
        hasStorefront={hasModule(m, 'storefront')}
        hasBookings={hasModule(m, 'bookings')}
        categories={(categories ?? []) as CategoryRow[]}
        locations={(locations ?? []) as LocationRow[]}
      />
    </AppShell>
  )
}
