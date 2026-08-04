import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { currentMembership } from '@/lib/tenant'
import { AppShell } from '@/components/shell'
import { InventoryClient } from './inventory-client'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Склад' }

// Склад: сканер сверху (главный жест мастера), ниже — ёмкости,
// расходники и товары. Все данные грузим на сервере параллельно.
export default async function InventoryPage() {
  const m = await currentMembership()
  if (!m) redirect('/register/seller')
  const supabase = await createClient()
  // created_by у партии и ёмкости обязателен и сверяется политикой RLS
  // с auth.uid() — без этого id форма не сможет ничего записать.
  const { data: { user } } = await supabase.auth.getUser()

  const [
    { data: containers }, { data: materials }, { data: variants }, { data: value },
    { data: suppliers }, { data: locations }, { data: batches },
  ] =
    await Promise.all([
      supabase.from('material_containers')
        .select('id, code, status, use_by, opened_at, volume, unit, materials(name)')
        .eq('tenant_id', m.tenantId)
        .in('status', ['sealed', 'opened'])
        .order('use_by', { ascending: true, nullsFirst: false })
        .limit(100),
      supabase.from('materials')
        .select('id, name, unit, current_stock, min_stock_threshold, is_cosmetic, pao_months, brand')
        .eq('tenant_id', m.tenantId)
        .eq('is_active', true)
        .order('name').limit(200),
      supabase.from('offering_variants')
        .select('id, name, stock_qty, reserved_qty, min_stock_threshold, unit, track_stock, offerings(title)')
        .eq('tenant_id', m.tenantId)
        .eq('is_active', true)
        .order('created_at').limit(200),
      supabase.from('stock_value_view').select('*').eq('tenant_id', m.tenantId).maybeSingle(),
      // Справочники для выпадающих списков форм.
      supabase.from('suppliers')
        .select('id, name').eq('tenant_id', m.tenantId)
        .eq('is_active', true).order('name').limit(200),
      supabase.from('storage_locations')
        .select('id, name').eq('tenant_id', m.tenantId)
        .eq('is_active', true).order('position').limit(200),
      // Партии нужны только чтобы привязать банку, поэтому берём самые
      // свежие по сроку — просроченные в новую банку не наливают.
      supabase.from('material_batches')
        .select('id, material_id, batch_number, expiry_date')
        .eq('tenant_id', m.tenantId)
        .order('expiry_date', { ascending: false }).limit(200),
    ])

  return (
    <AppShell modules={m.modules} active="/app/inventory" title="Склад">
      <InventoryClient
        tenantId={m.tenantId}
        userId={user!.id}
        containers={(containers ?? []).map((c) => ({
          id: c.id, code: c.code, status: c.status,
          useBy: c.use_by, openedAt: c.opened_at,
          volume: c.volume != null ? Number(c.volume) : null, unit: c.unit,
          material: (c.materials as unknown as { name: string })?.name ?? '',
        }))}
        materials={(materials ?? []).map((mt) => ({
          id: mt.id, name: mt.name, unit: mt.unit,
          stock: Number(mt.current_stock), threshold: Number(mt.min_stock_threshold),
          cosmetic: mt.is_cosmetic, pao: mt.pao_months, brand: mt.brand,
        }))}
        variants={(variants ?? []).map((v) => ({
          id: v.id, name: v.name,
          title: (v.offerings as unknown as { title: string })?.title ?? '',
          stock: v.stock_qty, reserved: v.reserved_qty,
          threshold: v.min_stock_threshold, unit: v.unit, tracked: v.track_stock,
        }))}
        suppliers={suppliers ?? []}
        locations={locations ?? []}
        batches={(batches ?? []).map((b) => ({
          id: b.id, materialId: b.material_id,
          number: b.batch_number, expiry: b.expiry_date,
        }))}
        totals={value ? {
          units: Number(value.units ?? 0),
          cost: Number(value.cost_value ?? 0),
          retail: Number(value.retail_value ?? 0),
        } : null}
      />
    </AppShell>
  )
}
