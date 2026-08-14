import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { currentMembership, can } from '@/lib/tenant'
import { AppShell } from '@/components/shell'
import { CountsClient } from './counts-client'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Інвентаризація' }

// Пересчёт — документ, а не правка остатка. Снимок «сколько было» снимает
// сама база (start_stock_count), расхождение проводит движением 'adjustment'
// (apply_stock_count). Приложение не трогает stock_qty ни в одном месте —
// это запрещено триггером-охранником (CLAUDE.md, правило 5).
export default async function CountsPage() {
  const m = await currentMembership()
  if (!m) redirect('/register/seller')
  const supabase = await createClient()

  // auth.getUser() здесь сознательно не вызывается: started_by документа
  // ставит сама функция из auth.uid(), а строки вставляет она же. Своим
  // идентификатором приложению на этом экране писать нечего.

  const [{ data: counts, error }, { data: variants }] = await Promise.all([
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
  ])

  // Прогресс документа виден только по его строкам, поэтому тянем их
  // отдельным запросом по уже отобранным документам: «начали и бросили»
  // и «посчитали всё» должны различаться в списке, а не после открытия.
  const ids = (counts ?? []).map((c) => c.id as string)
  const lineRows = ids.length > 0
    ? await supabase.from('stock_count_lines')
      .select('count_id, counted_qty').in('count_id', ids)
    : null
  const lines = (lineRows?.data ?? []) as { count_id: string; counted_qty: number | null }[]

  return (
    <AppShell modules={m.modules} active="/app/inventory" title="Інвентаризація">
      <CountsClient
        tenantId={m.tenantId}
        canWrite={can(m, 'stock.write')}
        error={error?.message ?? ''}
        counts={(counts ?? []).map((c) => {
          const own = lines.filter((l) => l.count_id === c.id)
          return {
            id: c.id as string,
            status: c.status as string,
            note: (c.note as string | null) ?? null,
            startedAt: c.started_at as string,
            appliedAt: (c.applied_at as string | null) ?? null,
            total: own.length,
            filled: own.filter((l) => l.counted_qty != null).length,
          }
        })}
        variants={(variants ?? []).map((v) => ({
          id: v.id as string,
          title: `${(v.offerings as unknown as { title: string } | null)?.title ?? ''} · ${v.name}`,
          unit: v.unit as string,
          stock: Number(v.stock_qty),
        }))}
      />
    </AppShell>
  )
}
