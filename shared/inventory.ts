// ── Склад: типы строк и запросы. ОБЩИЙ СЛОЙ ─────────────────────────────────
//
// Читают оба приложения. Здесь только форма данных и сами запросы —
// ни одного элемента интерфейса: веб рисует таблицу, мобильное рисует
// список, а спрашивают они базу ОДНИМ кодом.
//
// ПОЧЕМУ КЛИЕНТ ПЕРЕДАЁТСЯ ПАРАМЕТРОМ, А НЕ ИМПОРТИРУЕТСЯ. У веба клиент
// серверный и живёт на куках, у мобильного — на AsyncStorage; общего
// клиента у них быть не может. Зато при передаче параметром этот файл
// не имеет НИ ОДНОЙ зависимости времени выполнения (`import type`
// стирается при сборке) — значит, его одинаково видят и Next, и Metro,
// и ни один из них не тянет сюда чужой node_modules.
//
// Правило 5 «Восьми правил» соблюдается само собой: здесь только чтение.
// Остаток меняется исключительно функциями базы из `0003_inventory.sql`,
// и списка их тут нет намеренно — чтобы не появилось соблазна собрать
// «удобный» UPDATE в обход журнала.

import type { SupabaseClient } from '@supabase/supabase-js'

/** Расходник (засіб). Набор колонок тот же, что читает экран склада в вебе. */
export type MaterialRow = {
  id: string
  name: string
  unit: string
  current_stock: number | null
  min_stock_threshold: number | null
  is_cosmetic: boolean | null
  pao_months: number | null
  brand: string | null
  sku: string | null
  category: string | null
  cost_per_unit: number | null
  location_id: string | null
}

/** Ёмкость: вскрытая или запечатанная банка. Срок считает база, не клиент. */
export type ContainerRow = {
  id: string
  code: string | null
  status: string
  use_by: string | null
  opened_at: string | null
  volume: number | null
  unit: string | null
  material_id: string | null
}

/** Итог по стоимости запаса — представление `stock_value_view`. */
export type StockValue = {
  total_value: number | null
  positions: number | null
}

export type InventoryOverview = {
  materials: MaterialRow[]
  containers: ContainerRow[]
  value: StockValue | null
}

/**
 * Всё, что нужно первому экрану склада, одним заходом.
 *
 * Читается по праву `stock.read` (0003, 0009) — отдельного права у этого
 * запроса нет и быть не должно. Отсекает чужое не фильтр `tenant_id`
 * ниже, а RLS: фильтр здесь для того, чтобы не тащить лишнее, когда
 * у человека несколько заведений.
 */
export async function fetchInventoryOverview(
  sb: SupabaseClient,
  tenantId: string,
): Promise<InventoryOverview> {
  const [materials, containers, value] = await Promise.all([
    sb.from('materials')
      .select('id, name, unit, current_stock, min_stock_threshold, is_cosmetic, pao_months, brand, sku, category, cost_per_unit, location_id')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .order('name')
      .limit(200),
    // По возрастанию срока: то, что горит, — сверху. `nullsFirst: false`
    // держит банки без срока в конце, иначе они займут весь первый экран.
    sb.from('material_containers')
      .select('id, code, status, use_by, opened_at, volume, unit, material_id')
      .eq('tenant_id', tenantId)
      .in('status', ['sealed', 'opened'])
      .order('use_by', { ascending: true, nullsFirst: false })
      .limit(100),
    sb.from('stock_value_view').select('*').eq('tenant_id', tenantId).maybeSingle(),
  ])

  return {
    materials: (materials.data ?? []) as MaterialRow[],
    containers: (containers.data ?? []) as ContainerRow[],
    value: (value.data ?? null) as StockValue | null,
  }
}

/**
 * Заканчивается ли расходник. Порог — колонка строки, а не общее число:
 * у краски и у перчаток «мало» — это разные величины.
 *
 * Ноль порога считается «порог не задан», а не «сообщать всегда»: иначе
 * список «потребує уваги» заполняется целиком в первый же день.
 */
export function isLowStock(m: MaterialRow): boolean {
  const min = m.min_stock_threshold ?? 0
  if (min <= 0) return false
  return (m.current_stock ?? 0) <= min
}
