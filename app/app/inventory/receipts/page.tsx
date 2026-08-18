import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { currentMembership, can, hasModule, currentUserId } from '@/lib/tenant'
import { ModuleOff } from '@/components/module-gate'
import { AppShell } from '@/components/shell'
import { ReceiptsClient } from './receipts-client'
import { getT } from '@/lib/i18n/server'

export const dynamic = 'force-dynamic'
// Заголовок вкладки — тем же ключом, что и заголовок экрана
// в оболочке (`components/app-shell.tsx`).
export async function generateMetadata() {
  const t = await getT()
  return { title: t('app.screen.inventory.receipts.title') }
}

// Приход — единственный способ набрать остаток: материал создаётся с нулём,
// и других дверей в базу у него нет (CLAUDE.md, правило 5).
export default async function ReceiptsPage() {
  const m = await currentMembership()
  if (!m) redirect('/register/seller')
  // `stock_receipts_read` и `suppliers_read` — обе на `stock.read`
  // (0003, 0009).
  if (!can(m, 'stock.read')) redirect('/app')
  if (!hasModule(m, 'inventory')) return <ModuleOff m={m} module="inventory" />

  const supabase = await createClient()
  // created_by у приёмки — NOT NULL и сверяется политикой RLS с auth.uid():
  // без этого id форма не запишет документ.
  const userId = await currentUserId()

  const [{ data: receipts, error }, { data: suppliers }] = await Promise.all([
    supabase.from('stock_receipts')
      .select('id, document_number, status, note, created_at, applied_at, suppliers(name)')
      .eq('tenant_id', m.tenantId)
      .order('created_at', { ascending: false })
      .limit(60),
    supabase.from('suppliers')
      .select('id, name')
      .eq('tenant_id', m.tenantId)
      .eq('is_active', true)
      .order('name')
      .limit(200),
  ])

  // Число строк тянем отдельным запросом по уже отобранным документам:
  // в перечне надо с одного взгляда отличать пустую заготовку от готовой
  // к проведению — пустую приёмку база провести не даст.
  const ids = (receipts ?? []).map((r) => r.id as string)
  const lineRows = ids.length > 0
    ? await supabase.from('stock_receipt_lines').select('receipt_id').in('receipt_id', ids)
    : null
  const lines = (lineRows?.data ?? []) as { receipt_id: string }[]

  return (
    <AppShell>
      <ReceiptsClient
        tenantId={m.tenantId}
        userId={userId ?? ''}
        canWrite={can(m, 'stock.write')}
        error={error?.message ?? ''}
        suppliers={suppliers ?? []}
        receipts={(receipts ?? []).map((r) => ({
          id: r.id as string,
          number: (r.document_number as string | null) ?? null,
          status: r.status as string,
          note: (r.note as string | null) ?? null,
          supplier: (r.suppliers as unknown as { name: string } | null)?.name ?? null,
          createdAt: r.created_at as string,
          appliedAt: (r.applied_at as string | null) ?? null,
          lines: lines.filter((l) => l.receipt_id === r.id).length,
        }))}
      />
    </AppShell>
  )
}
