import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { currentMembership, can, hasModule } from '@/lib/tenant'
import { ModuleOff } from '@/components/module-gate'
import { AppShell } from '@/components/shell'
import { BarcodesClient } from './barcodes-client'
import { getT } from '@/lib/i18n/server'
import { dbErrorText } from '@/lib/errors/db'

export const dynamic = 'force-dynamic'
// Заголовок вкладки — тем же ключом, что и заголовок экрана
// в оболочке (`components/app-shell.tsx`).
export async function generateMetadata() {
  const t = await getT()
  return { title: t('app.screen.inventory.barcodes.title') }
}

// Заводской штрихкод — это то, что уже напечатано на упаковке. Их у одного
// расходника бывает несколько: один на коробке, другой на банке внутри.
// Сканер (scan_lookup из 0009_warehouse_plus.sql) ищет расходник именно
// по этой таблице, поэтому незаписанный код на экране сканера не находится.
export default async function BarcodesPage() {
  const m = await currentMembership()
  if (!m) redirect('/register/seller')
  // `material_barcodes_read` и `materials_member_read` — обе на
  // `stock.read` (0009, 0003).
  if (!can(m, 'stock.read')) redirect('/app')
  if (!hasModule(m, 'inventory')) return <ModuleOff m={m} module="inventory" />

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

  // Отказ базы переводится ЗДЕСЬ, а не в клиенте: сырой текст Postgres
  // печатает значения полей (М25), человеку уходит только своя подпись.
  const t = await getT()

  return (
    <AppShell>
      <BarcodesClient
        tenantId={m.tenantId}
        canWrite={can(m, 'stock.write')}
        error={error ? dbErrorText(t, error) : ''}
        loadError={codesError ? dbErrorText(t, codesError) : ''}
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
