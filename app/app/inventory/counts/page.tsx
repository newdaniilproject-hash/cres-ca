import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { currentMembership, can, hasModule } from '@/lib/tenant'
import { ModuleOff } from '@/components/module-gate'
import { CountsClient } from './counts-client'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Інвентаризація' }

// Пересчёт — документ, а не правка остатка. Снимок «сколько было» снимает
// сама база (start_stock_count), расхождение проводит движением 'adjustment'
// (apply_stock_count). Приложение не трогает stock_qty ни в одном месте —
// это запрещено триггером-охранником (CLAUDE.md, правило 5).
//
// Оболочку рисует app/app/layout.tsx, заголовок берётся из адреса —
// поэтому здесь только содержимое.
export default async function CountsPage() {
  const m = await currentMembership()
  if (!m) redirect('/register/seller')
  // `stock_counts_read` (0003) — на `stock.read`.
  if (!can(m, 'stock.read')) redirect('/app')
  if (!hasModule(m, 'inventory')) return <ModuleOff m={m} module="inventory" />

  const supabase = await createClient()

  // auth.getUser() здесь сознательно не вызывается: started_by документа
  // ставит сама функция из auth.uid(), а строки вставляет она же. Своим
  // идентификатором приложению на этом экране писать нечего.

  const [{ data: counts, error }, { data: variants }, { data: materials }] = await Promise.all([
    supabase.from('stock_counts')
      .select('id, status, note, started_at, applied_at')
      .eq('tenant_id', m.tenantId)
      .order('started_at', { ascending: false })
      .limit(60),
    // Вариант без учёта остатка пересчитывать нечего: у услуги stock_qty
    // всегда 0, и строка документа была бы пустым обещанием.
    supabase.from('offering_variants')
      .select('id, name, unit, stock_qty, offerings(title)')
      .eq('tenant_id', m.tenantId)
      .eq('is_active', true)
      .eq('track_stock', true)
      .order('created_at')
      .limit(300),
    // Расходники — то, ради чего экран вообще существует у салона: товаров
    // у него ноль, а полки полные. До 0066 их нельзя было пересчитать вовсе.
    supabase.from('materials')
      .select('id, name, unit, category, current_stock')
      .eq('tenant_id', m.tenantId)
      .eq('is_active', true)
      .order('name')
      .limit(500),
  ])

  // Прогресс документа виден только по его строкам, поэтому тянем их
  // отдельным запросом по уже отобранным документам: «начали и бросили»
  // и «посчитали всё» должны различаться в списке, а не после открытия.
  const ids = (counts ?? []).map((c) => c.id as string)
  const lineRows = ids.length > 0
    ? await supabase.from('stock_count_lines')
      .select('count_id, counted_qty, expected_qty, material_id').in('count_id', ids)
    : null
  const lines = (lineRows?.data ?? []) as {
    count_id: string
    counted_qty: number | null
    expected_qty: number
    material_id: string | null
  }[]

  return (
    <CountsClient
      tenantId={m.tenantId}
      canWrite={can(m, 'stock.write')}
      error={error?.message ?? ''}
      counts={(counts ?? []).map((c) => {
        const own = lines.filter((l) => l.count_id === c.id)
        const done = own.filter((l) => l.counted_qty != null)
        return {
          id: c.id as string,
          status: c.status as string,
          note: (c.note as string | null) ?? null,
          startedAt: c.started_at as string,
          appliedAt: (c.applied_at as string | null) ?? null,
          total: own.length,
          filled: done.length,
          // Расхождения показываем прямо в списке: «проведено» само по себе
          // не говорит, сошлось у мастера или разъехалось на десять позиций.
          mismatches: done.filter((l) => Number(l.counted_qty) !== Number(l.expected_qty)).length,
          materials: own.filter((l) => l.material_id != null).length,
        }
      })}
      variants={(variants ?? []).map((v) => ({
        id: v.id as string,
        title: `${(v.offerings as unknown as { title: string } | null)?.title ?? ''} · ${v.name}`,
        unit: v.unit as string,
        stock: Number(v.stock_qty),
      }))}
      materials={(materials ?? []).map((x) => ({
        id: x.id as string,
        title: x.name as string,
        unit: x.unit as string,
        category: (x.category as string | null) ?? '',
        stock: Number(x.current_stock),
      }))}
    />
  )
}
