import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { currentMembership, can } from '@/lib/tenant'
import { AppShell } from '@/components/shell'
import { MaterialCard } from './material-card'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Картка засобу' }

// Карточка засоба — экран 2 макета и пункт 3.1 ТЗ.
//
// До неё в реестре нельзя было исправить ни одного поля: форма
// существовала только для заведения. Здесь и просмотр, и правка,
// и вход в документы и в контроль вскрытия — два подэкрана рядом.
export default async function MaterialPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const m = await currentMembership()
  if (!m) redirect('/register/seller')

  const { id } = await params
  const supabase = await createClient()

  const { data: material, error } = await supabase
    .from('materials')
    .select(`id, name, unit, category, sku, brand, country_of_origin, inci,
             notification_code, notification_url, notification_date,
             pao_months, is_cosmetic, current_stock, min_stock_threshold,
             cost_per_unit, supplier_id, location_id, is_active`)
    .eq('id', id)
    .eq('tenant_id', m.tenantId)
    .maybeSingle()

  if (error) {
    return (
      <AppShell active="/app/inventory" title="Картка засобу" back="/app/inventory">
        <p className="field-error rise">Не вдалося відкрити картку: {error.message}</p>
      </AppShell>
    )
  }
  if (!material) notFound()

  const [
    { data: batches }, { data: containers }, { count: docs },
    { data: suppliers }, { data: locations },
  ] = await Promise.all([
    supabase.from('material_batches')
      .select('id, batch_number, manufactured_date, expiry_date, received_at, supplier_id')
      .eq('tenant_id', m.tenantId).eq('material_id', id)
      .order('expiry_date', { ascending: true }).limit(100),
    supabase.from('material_containers')
      .select('id, code, status, volume, unit, opened_at, use_by, decanted_at, parent_id')
      .eq('tenant_id', m.tenantId).eq('material_id', id)
      .in('status', ['sealed', 'opened'])
      .order('use_by', { ascending: true, nullsFirst: false }).limit(100),
    supabase.from('material_documents')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', m.tenantId).eq('material_id', id),
    supabase.from('suppliers').select('id, name')
      .eq('tenant_id', m.tenantId).eq('is_active', true).order('name').limit(200),
    supabase.from('storage_locations').select('id, name')
      .eq('tenant_id', m.tenantId).eq('is_active', true).order('position').limit(200),
  ])

  return (
    <AppShell active="/app/inventory" title="Картка засобу"
              back="/app/inventory" modules={m.modules}>
      <MaterialCard
        tenantId={m.tenantId}
        canWrite={can(m, 'stock.write')}
        docsCount={docs ?? 0}
        material={{
          id: material.id,
          name: material.name,
          unit: material.unit,
          sku: material.sku,
          category: material.category,
          threshold: Number(material.min_stock_threshold),
          cost: material.cost_per_unit != null ? Number(material.cost_per_unit) : null,
          supplierId: material.supplier_id,
          locationId: material.location_id,
          isCosmetic: material.is_cosmetic,
          brand: material.brand,
          country: material.country_of_origin,
          inci: material.inci,
          notificationCode: material.notification_code,
          notificationUrl: material.notification_url,
          notificationDate: material.notification_date,
          paoMonths: material.pao_months,
        }}
        stock={Number(material.current_stock)}
        batches={(batches ?? []).map((b) => ({
          id: b.id, number: b.batch_number,
          made: b.manufactured_date, expiry: b.expiry_date,
          received: b.received_at, supplierId: b.supplier_id,
        }))}
        containers={(containers ?? []).map((c) => ({
          id: c.id, code: c.code, status: c.status,
          volume: c.volume != null ? Number(c.volume) : null, unit: c.unit,
          openedAt: c.opened_at, useBy: c.use_by,
          decantedAt: c.decanted_at, parentId: c.parent_id,
        }))}
        suppliers={suppliers ?? []}
        locations={locations ?? []}
      />
    </AppShell>
  )
}
