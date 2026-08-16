import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { currentMembership, can, hasModule } from '@/lib/tenant'
import { ModuleOff } from '@/components/module-gate'
import { CountDetail } from './count-detail'
import { getT } from '@/lib/i18n/server'

export const dynamic = 'force-dynamic'
// Заголовок вкладки — тем же ключом, что и заголовок экрана
// в оболочке (`components/app-shell.tsx`).
export async function generateMetadata() {
  const t = await getT()
  return { title: t('app.screen.inventory.count.title') }
}

export default async function CountPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const m = await currentMembership()
  if (!m) redirect('/register/seller')
  // Документ перерахунку — `stock_counts_read` (0003), то же
  // `stock.read`, что и перечень. Без него страница отдавала notFound,
  // и человек искал «пропавший» документ вместо ответа про доступ.
  if (!can(m, 'stock.read')) redirect('/app')
  if (!hasModule(m, 'inventory')) return <ModuleOff m={m} module="inventory" />

  const { id } = await params
  const supabase = await createClient()
  const t = await getT()

  // Фильтр по арендатору стоит рядом с фильтром по id намеренно: RLS отсечёт
  // чужой документ и без него, но так запрос честно описывает, что мы ищем.
  const { data: count, error } = await supabase
    .from('stock_counts')
    .select('id, status, note, started_at, applied_at')
    .eq('id', id)
    .eq('tenant_id', m.tenantId)
    .maybeSingle()

  if (error) {
    // Текст отказа базы — её слова, а не наши: в словарь он не едет.
    return (
      <p className="field-error rise">
        {t('inventory.count.openError')}: {error.message}
      </p>
    )
  }
  if (!count) notFound()

  // Строка документа целится ровно в одно: либо товар, либо расходник
  // (ограничение stock_count_lines_one_target). Тянем обе связи разом
  // и разбираем на месте — второй запрос ради второго вида позиций
  // удвоил бы время экрана, который открывают у полки.
  const { data: lines, error: linesError } = await supabase
    .from('stock_count_lines')
    .select(`id, variant_id, material_id, expected_qty, counted_qty,
             offering_variants(name, unit, offerings(title)),
             materials(name, unit, category)`)
    .eq('count_id', count.id)

  return (
    <CountDetail
      tenantId={m.tenantId}
      canWrite={can(m, 'stock.write')}
      loadError={linesError?.message ?? ''}
      count={{
        id: count.id as string,
        status: count.status as string,
        note: (count.note as string | null) ?? null,
        startedAt: count.started_at as string,
        appliedAt: (count.applied_at as string | null) ?? null,
      }}
      lines={(lines ?? []).map((l) => {
        const v = l.offering_variants as unknown as
          { name: string; unit: string; offerings: { title: string } | null } | null
        const mat = l.materials as unknown as
          { name: string; unit: string; category: string | null } | null
        const isMaterial = l.material_id != null
        return {
          id: l.id as string,
          kind: (isMaterial ? 'material' : 'variant') as 'material' | 'variant',
          // targetId — то, чем строка ищется сканером: у товара это вариант,
          // у расходника — сам расходник. Одно поле вместо двух развилок.
          targetId: (isMaterial ? l.material_id : l.variant_id) as string,
          title: isMaterial
            ? (mat?.name ?? '')
            : `${v?.offerings?.title ?? ''} · ${v?.name ?? ''}`,
          subtitle: isMaterial ? (mat?.category ?? '') : '',
          unit: (isMaterial ? mat?.unit : v?.unit) ?? '',
          expected: Number(l.expected_qty),
          counted: l.counted_qty != null ? Number(l.counted_qty) : null,
        }
      })
        // Порядок строк — как на полке ищут глазами: сначала расходники
        // (у салона это весь склад), внутри — по названию. База отдаёт их
        // одной вставкой, то есть с одинаковым created_at, и без явной
        // сортировки порядок был бы случайным.
        .sort((a, b) => (a.kind === b.kind
          ? a.title.localeCompare(b.title, 'uk')
          : a.kind === 'material' ? -1 : 1))}
    />
  )
}
