import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { currentMembership } from '@/lib/tenant'
import { AppShell } from '@/components/shell'
import { ReorderClient } from './reorder-client'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Пора замовити' }

// Экран отвечает на один вопрос: что заканчивается и у кого это брать.
// Считает представление stock_low_view (0009_warehouse_plus.sql) —
// с security_invoker, поэтому RLS применяется к смотрящему, а не к автору
// представления, и отдельной проверки арендатора в коде не требуется.
export default async function ReorderPage() {
  const m = await currentMembership()
  if (!m) redirect('/register/seller')
  const supabase = await createClient()

  // auth.getUser() здесь не нужен: экран ничего не пишет — только читает
  // представление и складывает текст заказа в буфер обмена.

  const { data, error } = await supabase
    .from('stock_low_view')
    .select('kind, id, title, unit, stock_qty, threshold, to_order, supplier')
    .eq('tenant_id', m.tenantId)
    .limit(300)

  return (
    <AppShell modules={m.modules} active="/app/inventory" title="Пора замовити">
      <ReorderClient
        error={error?.message ?? ''}
        items={(data ?? []).map((r) => ({
          kind: r.kind as string,
          id: r.id as string,
          title: r.title as string,
          unit: (r.unit as string | null) ?? '',
          stock: Number(r.stock_qty),
          threshold: Number(r.threshold),
          toOrder: Number(r.to_order),
          // У товаров поставщик в представлении всегда пустой: он живёт
          // на приёмке, а не на варианте. У расходников — из справочника.
          supplier: (r.supplier as string | null) ?? null,
        }))}
      />
    </AppShell>
  )
}
