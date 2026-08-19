import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { currentMembership, can, hasModule } from '@/lib/tenant'
import { ModuleOff } from '@/components/module-gate'
import { AppShell } from '@/components/shell'
import { RecipesClient } from './recipes-client'
import { getT } from '@/lib/i18n/server'
import { dbErrorText } from '@/lib/errors/db'

export const dynamic = 'force-dynamic'
// Заголовок вкладки — тем же ключом, что и заголовок экрана
// в оболочке (`components/app-shell.tsx`).
export async function generateMetadata() {
  const t = await getT()
  return { title: t('app.screen.inventory.recipes.title') }
}

// Рецепт (variant_materials) — это ответ на вопрос «що йде на одну послугу».
// Он не списывает ничего сам: списание делает consume_materials_for_variant
// в момент, когда запись переводят в «виконано» (0010_bookings.sql).
export default async function RecipesPage() {
  const m = await currentMembership()
  if (!m) redirect('/register/seller')
  // Экран стоит на ДВУХ зонах сразу и без любой из них наполовину пуст:
  // варианты услуг читаются по `catalog.read` (`offerings_read`, 0004,
  // на него же опирается `variant_materials_read` через владельца
  // варианта), а список засобів — по `stock.read` (`materials_member_read`,
  // 0003). У accountant есть только первое, и он видел услуги без единого
  // матеріалу — рецепт составить не из чего.
  if (!can(m, 'stock.read') || !can(m, 'catalog.read')) redirect('/app')
  // Два модуля, как и два права выше: рецептура связывает засоби склада
  // с позициями каталога и без любой из половин бессмысленна.
  if (!hasModule(m, 'inventory')) return <ModuleOff m={m} module="inventory" />
  if (!hasModule(m, 'catalog')) return <ModuleOff m={m} module="catalog" />

  const supabase = await createClient()

  // auth.getUser() здесь не нужен: в variant_materials нет created_by —
  // строка рецепта принадлежит варианту, а не тому, кто её вписал.
  // Права на неё RLS проверяет через владельца варианта (catalog.write).

  const [{ data: variants, error }, { data: materials }] = await Promise.all([
    supabase.from('offering_variants')
      .select('id, name, unit, position, offerings(title, kind)')
      .eq('tenant_id', m.tenantId)
      .eq('is_active', true)
      .order('position')
      .limit(300),
    supabase.from('materials')
      .select('id, name, unit, cost_per_unit')
      .eq('tenant_id', m.tenantId)
      .eq('is_active', true)
      .order('name')
      .limit(300),
  ])

  // Строки рецептов тянем одним запросом по уже отобранным вариантам:
  // у variant_materials нет tenant_id (её арендатор — арендатор варианта),
  // поэтому отбор идёт по списку id, а не по .eq('tenant_id', …).
  const ids = (variants ?? []).map((v) => v.id as string)
  const rowsRes = ids.length > 0
    ? await supabase.from('variant_materials')
      .select('variant_id, material_id, quantity_per_unit, materials(name, unit, cost_per_unit)')
      .in('variant_id', ids)
    : null

  const rows = (rowsRes?.data ?? []).map((r) => {
    const mt = r.materials as unknown as
      { name: string; unit: string; cost_per_unit: number | null } | null
    return {
      variantId: r.variant_id as string,
      materialId: r.material_id as string,
      quantity: Number(r.quantity_per_unit),
      name: mt?.name ?? '—',
      unit: mt?.unit ?? '',
      cost: mt?.cost_per_unit != null ? Number(mt.cost_per_unit) : null,
    }
  })

  // Отказ базы переводится ЗДЕСЬ, а не в клиенте: сырой текст Postgres
  // печатает значения полей (М25), человеку уходит только своя подпись.
  const t = await getT()

  return (
    <AppShell>
      <RecipesClient
        canWrite={can(m, 'catalog.write')}
        error={error ? dbErrorText(t, error) : ''}
        loadError={rowsRes?.error ? dbErrorText(t, rowsRes.error) : ''}
        materials={(materials ?? []).map((mt) => ({
          id: mt.id as string,
          name: mt.name as string,
          unit: mt.unit as string,
          cost: mt.cost_per_unit != null ? Number(mt.cost_per_unit) : null,
        }))}
        variants={(variants ?? [])
          .map((v) => {
            const o = v.offerings as unknown as { title: string; kind: string } | null
            return {
              id: v.id as string,
              // Услуга и товар различаются только значением offerings.kind —
              // модель у них одна (CLAUDE.md, правило 4).
              service: o?.kind === 'service',
              title: o?.title ?? '',
              name: v.name as string,
              unit: v.unit as string,
              lines: rows.filter((r) => r.variantId === v.id),
            }
          })
          // Услуги первыми: рецепт заводят ради них — товар расходников
          // обычно не тратит.
          .sort((a, b) => Number(b.service) - Number(a.service)
            || a.title.localeCompare(b.title, 'uk')
            || a.name.localeCompare(b.name, 'uk'))}
      />
    </AppShell>
  )
}
