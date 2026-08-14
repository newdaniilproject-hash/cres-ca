import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { currentMembership, can } from '@/lib/tenant'
import { AppShell } from '@/components/shell'
import { CountDetail } from './count-detail'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Інвентаризація' }

export default async function CountPage({
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
  const { data: count, error } = await supabase
    .from('stock_counts')
    .select('id, status, note, started_at, applied_at')
    .eq('id', id)
    .eq('tenant_id', m.tenantId)
    .maybeSingle()

  if (error) {
    return (
      <AppShell modules={m.modules} active="/app/inventory" title="Інвентаризація">
        <p className="field-error rise">Не вдалося відкрити інвентаризацію: {error.message}</p>
      </AppShell>
    )
  }
  if (!count) notFound()

  const { data: lines, error: linesError } = await supabase
    .from('stock_count_lines')
    .select(`id, variant_id, expected_qty, counted_qty,
             offering_variants(name, unit, offerings(title))`)
    .eq('count_id', count.id)

  return (
    <AppShell modules={m.modules} active="/app/inventory" title="Інвентаризація">
      <CountDetail
        tenantId={m.tenantId}
        canWrite={can(m, 'stock.write')}
        loadError={linesError?.message ?? ''}
        count={{
          id: count.id as string,
          status: count.status as string,
          note: (count.note as string | null) ?? null,
          startedAt: count.started_at as string,
          appliedAt: (count.applied_at as string | null) ?? null,
        }}
        lines={(lines ?? []).map((l) => {
          const v = l.offering_variants as unknown as
            { name: string; unit: string; offerings: { title: string } | null } | null
          return {
            id: l.id as string,
            variantId: l.variant_id as string,
            title: `${v?.offerings?.title ?? ''} · ${v?.name ?? ''}`,
            unit: v?.unit ?? '',
            expected: Number(l.expected_qty),
            counted: l.counted_qty != null ? Number(l.counted_qty) : null,
          }
        })
          // Порядок строк — как на полке ищут глазами: по названию.
          // База отдаёт их одной вставкой, то есть с одинаковым created_at,
          // и без явной сортировки порядок был бы случайным.
          .sort((a, b) => a.title.localeCompare(b.title, 'uk'))}
      />
    </AppShell>
  )
}
