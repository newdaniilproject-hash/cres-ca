import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { currentMembership, can } from '@/lib/tenant'
import { AppShell } from '@/components/shell'
import { BarcodesClient } from './barcodes-client'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Заводські штрихкоди' }

// Заводской штрихкод — это то, что уже напечатано на упаковке. Их у одного
// расходника бывает несколько: один на коробке, другой на банке внутри.
// Сканер (scan_lookup из 0009_warehouse_plus.sql) ищет расходник именно
// по этой таблице, поэтому незаписанный код на экране сканера не находится.
export default async function BarcodesPage() {
  const m = await currentMembership()
  if (!m) redirect('/register/seller')
  const supabase = await createClient()

  // auth.getUser() здесь не нужен: в material_barcodes нет created_by —
  // код принадлежит упаковке, а не тому, кто поднёс сканер. Арендатора
  // в строке RLS сверяет с tenant_id, который проставляет форма.

  const [{ data: materials, error }, { data: codes, error: codesError }] = await Promise.all([
    supabase.from('materials')
      .select('id, name, unit, category')
      .eq('tenant_id', m.tenantId)
      .eq('is_active', true)
      .order('name')
      .limit(300),
    supabase.from('material_barcodes')
      .select('material_id, barcode')
      .eq('tenant_id', m.tenantId)
      .limit(1000),
  ])

  const rows = (codes ?? []) as { material_id: string; barcode: string }[]

  return (
    <AppShell modules={m.modules} active="/app/inventory" title="Заводські штрихкоди">
      <BarcodesClient
        tenantId={m.tenantId}
        canWrite={can(m, 'stock.write')}
        error={error?.message ?? ''}
        loadError={codesError?.message ?? ''}
        materials={(materials ?? []).map((mt) => ({
          id: mt.id as string,
          name: mt.name as string,
          unit: mt.unit as string,
          category: (mt.category as string | null) ?? null,
          codes: rows.filter((c) => c.material_id === mt.id).map((c) => c.barcode),
        }))}
      />
    </AppShell>
  )
}
