import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { currentMembership, can } from '@/lib/tenant'
import { AppShell } from '@/components/shell'
import { MovementsClient } from './movements-client'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Рухи залишку' }

// Значения enum stock_movement_type из 0003_inventory.sql. Список повторяет
// тот, что в movements-client: импортировать его оттуда нельзя — серверный
// компонент получил бы ссылку на клиентский модуль, а не массив.
const MOVEMENT_TYPES = [
  'receipt', 'sale', 'write_off', 'return', 'adjustment', 'transfer_out', 'transfer_in',
]

export default async function MovementsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>
}) {
  const m = await currentMembership()
  if (!m) redirect('/register/seller')

  const { type } = await searchParams
  // Чужое значение в адресе не должно уходить в запрос: незнакомый тип
  // не enum, и база ответила бы ошибкой вместо пустого списка.
  const active = type && MOVEMENT_TYPES.includes(type) ? type : 'all'

  const supabase = await createClient()

  let query = supabase
    .from('stock_movements')
    .select(`id, movement_type, quantity, note, reference_type, receipt_id, count_id,
             created_at, variant_id, material_id,
             offering_variants(name, unit, offerings(title)), materials(name, unit)`)
    .eq('tenant_id', m.tenantId)
  if (active !== 'all') query = query.eq('movement_type', active)

  const [{ data, error }, { data: materials }, { data: variants }] = await Promise.all([
    // Двести строк: журнал листают, чтобы понять «что было вчера», а не
    // чтобы свести годовой отчёт — для этого будет выгрузка.
    query.order('created_at', { ascending: false }).limit(200),
    supabase.from('materials')
      .select('id, name, unit')
      .eq('tenant_id', m.tenantId).eq('is_active', true)
      .order('name').limit(300),
    supabase.from('offering_variants')
      .select('id, name, unit, track_stock, offerings(title)')
      .eq('tenant_id', m.tenantId).eq('is_active', true)
      .order('created_at').limit(300),
  ])

  return (
    <AppShell modules={m.modules} active="/app/inventory" title="Рухи залишку">
      <MovementsClient
        tenantId={m.tenantId}
        canWrite={can(m, 'stock.write')}
        active={active}
        error={error?.message ?? ''}
        movements={(data ?? []).map((mv) => {
          const v = mv.offering_variants as unknown as
            { name: string; unit: string; offerings: { title: string } | null } | null
          const mt = mv.materials as unknown as { name: string; unit: string } | null
          return {
            id: mv.id as string,
            type: mv.movement_type as string,
            quantity: Number(mv.quantity),
            unit: v?.unit ?? mt?.unit ?? '',
            title: v ? `${v.offerings?.title ?? ''} · ${v.name}` : mt?.name ?? '—',
            kind: mv.material_id ? ('material' as const) : ('goods' as const),
            referenceType: (mv.reference_type as string | null) ?? null,
            receiptId: (mv.receipt_id as string | null) ?? null,
            countId: (mv.count_id as string | null) ?? null,
            note: (mv.note as string | null) ?? null,
            createdAt: mv.created_at as string,
          }
        })}
        materials={(materials ?? []).map((mt) => ({
          id: mt.id as string, name: mt.name as string, unit: mt.unit as string,
        }))}
        variants={(variants ?? [])
          // Вариант без учёта остатка списывать нечем: у него stock_qty
          // всегда 0, и движение по нему не имеет смысла.
          .filter((v) => v.track_stock)
          .map((v) => ({
            id: v.id as string,
            name: `${(v.offerings as unknown as { title: string } | null)?.title ?? ''} · ${v.name}`,
            unit: v.unit as string,
          }))}
      />
    </AppShell>
  )
}
