import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { currentMembership, can } from '@/lib/tenant'
import { AppShell } from '@/components/shell'
import { ReceiptDetail } from './receipt-detail'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Приймання' }

export default async function ReceiptPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const m = await currentMembership()
  if (!m) redirect('/register/seller')

  const { id } = await params
  const supabase = await createClient()

  // Фильтр по арендатору стоит рядом с фильтром по id намеренно: RLS отсечёт
  // чужой документ и без него, но так запрос честно описывает, что мы ищем.
  const { data: receipt, error } = await supabase
    .from('stock_receipts')
    .select('id, document_number, status, note, supplier_id, created_at, applied_at')
    .eq('id', id)
    .eq('tenant_id', m.tenantId)
    .maybeSingle()

  if (error) {
    return (
      <AppShell active="/app/inventory" title="Приймання">
        <p className="field-error rise">Не вдалося відкрити приймання: {error.message}</p>
      </AppShell>
    )
  }
  if (!receipt) notFound()

  const [
    { data: lines, error: linesError },
    { data: materials },
    { data: variants },
    { data: suppliers },
  ] = await Promise.all([
    supabase.from('stock_receipt_lines')
      .select(`id, quantity, unit_cost, variant_id, material_id,
               offering_variants(name, unit, offerings(title)), materials(name, unit)`)
      .eq('receipt_id', receipt.id)
      .order('created_at'),
    supabase.from('materials')
      .select('id, name, unit')
      .eq('tenant_id', m.tenantId).eq('is_active', true)
      .order('name').limit(300),
    supabase.from('offering_variants')
      .select('id, name, unit, track_stock, offerings(title)')
      .eq('tenant_id', m.tenantId).eq('is_active', true)
      .order('created_at').limit(300),
    supabase.from('suppliers')
      .select('id, name')
      .eq('tenant_id', m.tenantId).eq('is_active', true)
      .order('name').limit(200),
  ])

  return (
    <AppShell
      active="/app/inventory"
      title={receipt.document_number ? `Приймання №${receipt.document_number}` : 'Приймання'}
    >
      <ReceiptDetail
        canWrite={can(m, 'stock.write')}
        loadError={linesError?.message ?? ''}
        receipt={{
          id: receipt.id as string,
          number: (receipt.document_number as string | null) ?? null,
          status: receipt.status as string,
          note: (receipt.note as string | null) ?? null,
          supplierId: (receipt.supplier_id as string | null) ?? null,
          createdAt: receipt.created_at as string,
          appliedAt: (receipt.applied_at as string | null) ?? null,
        }}
        lines={(lines ?? []).map((l) => {
          const v = l.offering_variants as unknown as
            { name: string; unit: string; offerings: { title: string } | null } | null
          const mt = l.materials as unknown as { name: string; unit: string } | null
          return {
            id: l.id as string,
            kind: l.material_id ? ('material' as const) : ('goods' as const),
            title: v ? `${v.offerings?.title ?? ''} · ${v.name}` : mt?.name ?? '—',
            unit: v?.unit ?? mt?.unit ?? '',
            quantity: Number(l.quantity),
            unitCost: l.unit_cost != null ? Number(l.unit_cost) : null,
          }
        })}
        materials={(materials ?? []).map((mt) => ({
          id: mt.id as string, name: mt.name as string, unit: mt.unit as string,
        }))}
        variants={(variants ?? [])
          // Вариант без учёта остатка приходовать бессмысленно: у него
          // stock_qty всегда 0, и движение просто некуда лечь.
          .filter((v) => v.track_stock)
          .map((v) => ({
            id: v.id as string,
            name: `${(v.offerings as unknown as { title: string } | null)?.title ?? ''} · ${v.name}`,
            unit: v.unit as string,
          }))}
        suppliers={suppliers ?? []}
      />
    </AppShell>
  )
}
