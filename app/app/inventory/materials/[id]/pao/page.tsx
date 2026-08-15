import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { currentMembership, can } from '@/lib/tenant'
import { AppShell } from '@/components/shell'
import { PaoControl } from './pao-control'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Контроль відкриття та фасування' }

// Экраны 4 и 5 макета, пункт ТЗ 3.2 целиком:
// учёт PAO, кнопка «Відкрити банку», розлив в дозатор с генерацией
// внутреннего кода и наклейкой из пяти реквизитов.
export default async function PaoPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const m = await currentMembership()
  if (!m) redirect('/register/seller')

  const { id } = await params
  const supabase = await createClient()

  const { data: material } = await supabase
    .from('materials')
    .select('id, name, unit, pao_months, is_cosmetic')
    .eq('id', id).eq('tenant_id', m.tenantId).maybeSingle()

  if (!material) notFound()

  // Ёмкости берём ВСЕ, включая закрытые и списанные: история розливов
  // не должна исчезать от того, что дозатор закончился. Журнал — это
  // доказательство, а не текущий остаток.
  const [{ data: containers, error }, { data: batches }] = await Promise.all([
    supabase.from('material_containers')
      .select(`id, code, status, volume, unit, opened_at, use_by,
               decanted_at, parent_id, pao_months, note, created_at, batch_id`)
      .eq('tenant_id', m.tenantId).eq('material_id', id)
      .order('created_at', { ascending: false }).limit(300),
    supabase.from('material_batches')
      .select('id, batch_number, expiry_date')
      .eq('tenant_id', m.tenantId).eq('material_id', id)
      .order('expiry_date', { ascending: true }).limit(100),
  ])

  return (
    <AppShell active="/app/inventory" title="Відкриття та фасування"
              back={`/app/inventory/materials/${id}`} modules={m.modules}>
      <PaoControl
        canOpen={can(m, 'compliance.journal.write') || can(m, 'compliance.write')}
        material={{
          id: material.id, name: material.name, unit: material.unit,
          paoMonths: material.pao_months, isCosmetic: material.is_cosmetic,
        }}
        containers={(containers ?? []).map((c) => ({
          id: c.id, code: c.code, status: c.status,
          volume: c.volume != null ? Number(c.volume) : null, unit: c.unit,
          openedAt: c.opened_at, useBy: c.use_by, decantedAt: c.decanted_at,
          parentId: c.parent_id, paoMonths: c.pao_months, note: c.note,
          batchId: c.batch_id,
        }))}
        batches={(batches ?? []).map((b) => ({
          id: b.id, number: b.batch_number, expiry: b.expiry_date,
        }))}
        loadError={error?.message ?? ''}
      />
    </AppShell>
  )
}
