// ── Каталог: типы и запрос. ОБЩИЙ СЛОЙ ──────────────────────────────────────
//
// Товары и услуги — ОДНА модель (правило 4): различается только
// представление в интерфейсе, а не таблица и не запрос. Поэтому здесь
// один тип и один вызов на оба вида, а `kind` — просто колонка.
//
// Набор колонок УЖЕ веб-экрана намеренно: телефон не показывает ни
// вложенные варианты, ни рецептуру, ни медиа-галерею, и тащить их
// в список — это лишние килобайты на мобильной сети при каждом открытии
// вкладки. Когда появится карточка позиции, она добавит СВОЙ запрос
// по одной строке, а не расширит этот.

import type { SupabaseClient } from '@supabase/supabase-js'

export type OfferingRow = {
  id: string
  kind: string
  status: string
  title: string
  subtitle: string | null
  price: number | null
  currency: string | null
  /** Показывается ли позиция на витрине. Не то же самое, что `status`. */
  listed: boolean | null
}

export async function fetchOfferings(
  sb: SupabaseClient,
  tenantId: string,
): Promise<OfferingRow[]> {
  const { data } = await sb
    .from('offerings')
    .select('id, kind, status, title, subtitle, price, currency, listed')
    .eq('tenant_id', tenantId)
    .order('updated_at', { ascending: false })
    .limit(200)
  return (data ?? []) as OfferingRow[]
}
