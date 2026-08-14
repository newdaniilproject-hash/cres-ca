import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { currentMembership } from '@/lib/tenant'
import { AppShell } from '@/components/shell'
import { OfferingForm, type CategoryRow, type LocationRow } from '../offering-form'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Нова позиція' }

// Справочники (категории платформы и места хранения) грузим здесь, а не
// в форме: они одинаковы для всех позиций и не меняются во время заполнения.
export default async function NewOfferingPage() {
  const m = await currentMembership()
  if (!m) redirect('/register/seller')
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
    <AppShell modules={m.modules} active="/app/catalog" title="Нова позиція">
      <OfferingForm
        tenantId={m.tenantId}
        categories={(categories ?? []) as CategoryRow[]}
        locations={(locations ?? []) as LocationRow[]}
      />
    </AppShell>
  )
}
