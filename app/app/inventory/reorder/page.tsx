import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { currentMembership, can, hasModule } from '@/lib/tenant'
import { ModuleOff } from '@/components/module-gate'
import { AppShell } from '@/components/shell'
import { ReorderClient } from './reorder-client'
import { getT } from '@/lib/i18n/server'
import { dbErrorText } from '@/lib/errors/db'

export const dynamic = 'force-dynamic'
// Заголовок вкладки — тем же ключом, что и заголовок экрана
// в оболочке (`components/app-shell.tsx`).
export async function generateMetadata() {
  const t = await getT()
  return { title: t('app.screen.inventory.reorder.title') }
}

// Экран отвечает на один вопрос: что заканчивается и у кого это брать.
// Считает представление stock_low_view (0009_warehouse_plus.sql) —
// с security_invoker, поэтому RLS применяется к смотрящему, а не к автору
// представления, и отдельной проверки арендатора в коде не требуется.
export default async function ReorderPage() {
  const m = await currentMembership()
  if (!m) redirect('/register/seller')
  // `stock_low_view` идёт с security_invoker, то есть RLS применяется
  // к смотрящему: без `stock.read` представление честно отдаёт ноль
  // строк, и экран говорит «запасів достатньо» тому, кто просто
  // не имеет права их видеть. Это худший вид пустого экрана — он врёт.
  if (!can(m, 'stock.read')) redirect('/app')
  if (!hasModule(m, 'inventory')) return <ModuleOff m={m} module="inventory" />

  const supabase = await createClient()

  // auth.getUser() здесь не нужен: экран ничего не пишет — только читает
  // представление и складывает текст заказа в буфер обмена.

  const { data, error } = await supabase
    .from('stock_low_view')
    .select('kind, id, title, unit, stock_qty, threshold, to_order, supplier')
    .eq('tenant_id', m.tenantId)
    .limit(300)

  // Отказ базы переводится ЗДЕСЬ, а не в клиенте: сырой текст Postgres
  // печатает значения полей (М25), человеку уходит только своя подпись.
  const t = await getT()

  return (
    <AppShell>
      <ReorderClient
        error={error ? dbErrorText(t, error) : ''}
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
