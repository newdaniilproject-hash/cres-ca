import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { currentMembership, can, hasModule, currentUserId } from '@/lib/tenant'
import { ModuleOff } from '@/components/module-gate'
import { AppShell } from '@/components/shell'
import { getT } from '@/lib/i18n/server'
import { InventoryClient } from './inventory-client'

export const dynamic = 'force-dynamic'

// Заголовок вкладки — из словаря, тем же ключом, что и заголовок экрана
// в оболочке (`components/app-shell.tsx`). Функцией, а не константой:
// константа не может позвать переводчик, а он читает куку языка.
export async function generateMetadata() {
  const t = await getT()
  return { title: t('app.screen.inventory.title') }
}

// Склад: счётчики сверху, быстрые действия, сканер, ниже — расходники,
// ёмкости и товары. Все данные грузим на сервере параллельно.
export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ scan?: string }>
}) {
  // Сканер живёт в верхней строке оболочки и приходит сюда адресом
  // (?scan=1): значок работает с любого экрана, а склад открывается уже
  // с включённой камерой.
  //
  // Параметра `?q=` здесь больше НЕТ. Поиск стал один на весь кабинет
  // и живёт в шапке (`components/global-search.tsx`, решение владельца
  // 19.08.2026): он ищет сразу по расходникам, каталогу, клиентам
  // и заказам, и приводить его результат к адресу одного экрана незачем —
  // найденное открывается своей карточкой.
  const sp = await searchParams
  const m = await currentMembership()
  if (!m) redirect('/register/seller')
  // `materials`, `suppliers`, `storage_locations`, `stock_value_view` —
  // все на `stock.read` (0003, 0009). Без права экран рисовал счётчики
  // из нулей и три пустых списка: человек решал, что склад сломан.
  if (!can(m, 'stock.read')) redirect('/app')
  // Вторая ось доступа — модуль заведения. Меню прячет раздел, которого
  // нет в `modules`, а прямой адрес его открывал: экран отказа объясняет,
  // что это не про права человека (CLAUDE.md → «Доступ: роли и модули»).
  if (!hasModule(m, 'inventory')) return <ModuleOff m={m} module="inventory" />

  const supabase = await createClient()
  // created_by у партии и ёмкости обязателен и сверяется политикой RLS
  // с auth.uid() — без этого id форма не сможет ничего записать.
  const userId = await currentUserId()

  const [
    { data: containers }, { data: materials }, { data: variants }, { data: value },
    { data: suppliers }, { data: locations }, { data: batches },
  ] =
    await Promise.all([
      supabase.from('material_containers')
        .select('id, code, status, use_by, opened_at, volume, unit, material_id, materials(name)')
        .eq('tenant_id', m.tenantId)
        .in('status', ['sealed', 'opened'])
        .order('use_by', { ascending: true, nullsFirst: false })
        .limit(100),
      supabase.from('materials')
        .select('id, name, unit, current_stock, min_stock_threshold, is_cosmetic, pao_months, brand, sku, image_path')
        .eq('tenant_id', m.tenantId)
        .eq('is_active', true)
        .order('name').limit(200),
      supabase.from('offering_variants')
        .select('id, name, stock_qty, reserved_qty, min_stock_threshold, unit, track_stock, offering_id, offerings(title)')
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
      // По возрастанию срока: первая непросроченная партия материала —
      // и есть действующая, её номер и дату показывает список и карточка.
      supabase.from('material_batches')
        .select('id, material_id, batch_number, expiry_date')
        .eq('tenant_id', m.tenantId)
        .order('expiry_date', { ascending: true }).limit(500),
    ])

  // Действующая партия на материал. Считаем один раз здесь, а не на
  // клиенте в каждой строке: иначе список из двухсот засобів перебирает
  // пятьсот партий на каждую перерисовку поиска.
  const today = new Date().toISOString().slice(0, 10)
  const activeBatch = new Map<string, { number: string; expiry: string }>()
  for (const b of batches ?? []) {
    const cur = activeBatch.get(b.material_id)
    // Партии уже отсортированы по возрастанию срока: первая подходящая
    // и есть ближайшая. Непросроченная всегда вытесняет просроченную.
    if (!cur) { activeBatch.set(b.material_id, { number: b.batch_number, expiry: b.expiry_date }) }
    else if (cur.expiry < today && b.expiry_date >= today) {
      activeBatch.set(b.material_id, { number: b.batch_number, expiry: b.expiry_date })
    }
  }

  return (
    <AppShell modules={m.modules} perms={m.perms}>
      <InventoryClient
        initialScan={sp.scan === '1'}
        tenantId={m.tenantId}
        userId={userId ?? ''}
        containers={(containers ?? []).map((c) => ({
          id: c.id, code: c.code, status: c.status,
          useBy: c.use_by, openedAt: c.opened_at,
          volume: c.volume != null ? Number(c.volume) : null, unit: c.unit,
          materialId: c.material_id,
          material: (c.materials as unknown as { name: string })?.name ?? '',
        }))}
        materials={(materials ?? []).map((mt) => ({
          id: mt.id, name: mt.name, unit: mt.unit,
          stock: Number(mt.current_stock), threshold: Number(mt.min_stock_threshold),
          cosmetic: mt.is_cosmetic, pao: mt.pao_months, brand: mt.brand, sku: mt.sku,
          batch: activeBatch.get(mt.id)?.number ?? null,
          expiry: activeBatch.get(mt.id)?.expiry ?? null,
          // Фото банки в списке: мастер ищет её глазами, а не по названию —
          // у засобів имена различаются одним словом (0111).
          imagePath: mt.image_path,
        }))}
        variants={(variants ?? []).map((v) => ({
          id: v.id, name: v.name,
          // Позиция каталога, к которой относится вариант. Нужна затем,
          // чтобы строка товара ВЕЛА в карточку: до 19.08.2026 товар был
          // единственным элементом склада без входа — строка выглядела
          // как остальные, но не открывалась ничем.
          offeringId: v.offering_id,
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
