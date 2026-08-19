import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { currentMembership, can, hasModule } from '@/lib/tenant'
import { ModuleOff } from '@/components/module-gate'
import { AppShell } from '@/components/shell'
import { RecipeBlock } from './recipe-block'
import { getT } from '@/lib/i18n/server'
import {
  OfferingForm,
  type CategoryRow, type LocationRow, type MediaRow,
  type OfferingRow, type VariantRow,
} from '../offering-form'

export const dynamic = 'force-dynamic'

// Заголовок вкладки браузера — строка интерфейса, поэтому из словаря.
// Разбор решения — в `app/app/journals/page.tsx`.
export async function generateMetadata() {
  const t = await getT()
  return { title: t('catalog.item.meta.title') }
}

// Фильтр по tenant_id стоит рядом с фильтром по id намеренно: RLS отсечёт
// чужую позицию и без него, но тогда экран упадёт в notFound без объяснения,
// а так запрос честно описывает, что мы ищем.
export default async function OfferingPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const m = await currentMembership()
  if (!m) redirect('/register/seller')
  // Карточка позиции — тот же `catalog.read`, что и список: без права
  // `offerings_read` не отдаст строку, и человек получал бы notFound
  // вместо честного «розділ не ваш».
  if (!can(m, 'catalog.read')) redirect('/app')
  // Карточка закрывается модулем до чтения позиции: иначе при выключенном
  // каталоге экран отвечал бы `notFound()` или, наоборот, показывал бы
  // товар из раздела, которого у заведения нет.
  if (!hasModule(m, 'catalog')) return <ModuleOff m={m} module="catalog" />

  const { id } = await params
  const supabase = await createClient()

  const [{ data: offering }, { data: variants }, { data: media },
         { data: categories }, { data: locations },
         { data: recipeMaterials }] = await Promise.all([
    supabase.from('offerings')
      .select(`id, kind, status, category_id, sku, slug, title, subtitle, description,
               price, compare_at, currency, tags, listed, published_at,
               deposit_percent, cancel_window_hours, booking_horizon_days`)
      .eq('id', id).eq('tenant_id', m.tenantId).maybeSingle(),
    supabase.from('offering_variants')
      .select(`id, name, sku, price, compare_at, cost, track_stock, stock_qty,
               reserved_qty, weight_g, barcode, position, is_active, location_id,
               min_stock_threshold, unit, duration_minutes, buffer_minutes`)
      .eq('offering_id', id).order('position'),
    supabase.from('offering_media')
      .select('id, path, position')
      .eq('offering_id', id).order('position'),
    supabase.from('categories')
      .select('id, name, kind').eq('is_active', true)
      .order('position').order('name').limit(300),
    supabase.from('storage_locations')
      .select('id, name').eq('tenant_id', m.tenantId)
      .eq('is_active', true).order('position'),
    // Расходники для рецептуры. Запрос уходит всегда: отсутствие права
    // `stock.read` выражается пустым ответом, а не веткой в коде —
    // то же правило, что в карточке засоба.
    supabase.from('materials')
      .select('id, name, unit')
      .eq('tenant_id', m.tenantId).eq('is_active', true)
      .order('name').limit(300),
  ])

  if (!offering) notFound()

  // Рецептура этой позиции. Отдельным запросом ПОСЛЕ вариантов: у таблицы
  // `variant_materials` нет своей колонки арендатора (её арендатор —
  // арендатор варианта), поэтому фильтр идёт по списку вариантов,
  // а не по `tenant_id`.
  const variantIds = (variants ?? []).map((v) => v.id as string)
  const { data: recipeLines } = variantIds.length > 0
    ? await supabase.from('variant_materials')
        .select('variant_id, material_id, quantity_per_unit')
        .in('variant_id', variantIds)
    : { data: [] }

  // ── Сколько услуг провели и сколько на них ушло ──────────────────────
  //
  // Требование владельца: «сколько услуг было проведено, сколько
  // расходников было истрачено». Считается по ФАКТУ, а не умножением
  // рецепта на число записей: журнал движений — единственный источник
  // правды об остатке (правило 5), и рецепт мог меняться между визитами.
  //
  // Два запроса вместо соединения: у `stock_movements` нет ссылки
  // на вариант, связь идёт через `reference_id` записи.
  const { data: doneBookings } = variantIds.length > 0
    ? await supabase.from('bookings')
        .select('id, variant_id')
        .in('variant_id', variantIds)
        .eq('status', 'completed')
        .limit(1000)
    : { data: [] }

  const bookingIds = (doneBookings ?? []).map((b) => b.id as string)
  const { data: usedMoves } = bookingIds.length > 0
    ? await supabase.from('stock_movements')
        .select('material_id, quantity, reference_id')
        .eq('reference_type', 'booking')
        .in('reference_id', bookingIds)
        .limit(5000)
    : { data: [] }

  // Проведено — по вариантам; израсходовано — по расходникам.
  const doneByVariant = new Map<string, number>()
  for (const b of doneBookings ?? []) {
    const k = b.variant_id as string
    doneByVariant.set(k, (doneByVariant.get(k) ?? 0) + 1)
  }
  const usedByMaterial = new Map<string, number>()
  for (const mv of usedMoves ?? []) {
    const k = mv.material_id as string
    // Списание лежит в журнале отрицательным числом — показываем модуль.
    usedByMaterial.set(k, (usedByMaterial.get(k) ?? 0) + Math.abs(Number(mv.quantity)))
  }

  const row = offering as unknown as OfferingRow

  return (
    <AppShell>
      <OfferingForm
        tenantId={m.tenantId}
        // Карточка открыта по `catalog.read`, а меняется по `catalog.write`:
        // `operator`, `accountant` и `viewer` читают её и видят отметку
        // «лише перегляд» вместо отказа политики на «Зберегти».
        canWrite={can(m, 'catalog.write')}
        canStock={can(m, 'stock.read')}
        // См. `../new/page.tsx`: витрина и записи — соседние модули,
        // и их поля в форме позиции держатся на них, а не на правах.
        hasStorefront={hasModule(m, 'storefront')}
        hasBookings={hasModule(m, 'bookings')}
        categories={(categories ?? []) as CategoryRow[]}
        locations={(locations ?? []) as LocationRow[]}
        offering={{
          ...row,
          // numeric приходит из PostgREST строкой — форма ждёт число.
          price: row.price != null ? Number(row.price) : null,
          compare_at: row.compare_at != null ? Number(row.compare_at) : null,
          tags: row.tags ?? [],
        }}
        variants={(variants ?? []).map((v) => ({
          id: v.id as string,
          name: v.name as string,
          sku: (v.sku ?? null) as string | null,
          price: v.price != null ? Number(v.price) : null,
          compare_at: v.compare_at != null ? Number(v.compare_at) : null,
          cost: v.cost != null ? Number(v.cost) : null,
          track_stock: v.track_stock as boolean,
          stock_qty: Number(v.stock_qty),
          reserved_qty: Number(v.reserved_qty),
          weight_g: v.weight_g != null ? Number(v.weight_g) : null,
          barcode: (v.barcode ?? null) as string | null,
          position: Number(v.position),
          is_active: v.is_active as boolean,
          location_id: (v.location_id ?? null) as string | null,
          min_stock_threshold: Number(v.min_stock_threshold),
          unit: v.unit as string,
          duration_minutes: v.duration_minutes != null ? Number(v.duration_minutes) : null,
          buffer_minutes: Number(v.buffer_minutes),
        })) as VariantRow[]}
        media={(media ?? []) as MediaRow[]}
      />

      {/* ── Витратники на послугу ─────────────────────────────────
          Только у услуг: у товара расход по рецептуре тоже возможен,
          но списывается он в другой момент (при продаже, а не при
          выполнении), и подключать его тем же блоком значило бы обещать
          списание, которого не произойдёт. Названо, а не забыто.

          Блок стоит ПОСЛЕ формы позиции, а не внутри неё: рецепт — это
          отдельная сущность со своими строками, и класть его в форму
          значило бы связать сохранение позиции с сохранением рецепта.

          ДВА ПРАВА, И ОНИ РАЗНЫЕ. Показ стоит на `stock.read`, а правка —
          на `catalog.write`, потому что политики `variant_materials`
          (0075) написаны именно на `catalog.*`: рецепт принадлежит
          услуге, а не складу. Без `stock.read` блока нет вовсе, а не
          «пусто»: имена засобів пришли бы пустым списком, и УЖЕ
          заведённые строки нарисовались бы голыми идентификаторами. */}
      {row.kind === 'service' && can(m, 'stock.read') && (
        <RecipeBlock
          canWrite={can(m, 'catalog.write')}
          variants={(variants ?? []).map((v) => ({
            id: v.id as string, name: v.name as string,
          }))}
          materials={(recipeMaterials ?? []).map((mm) => ({
            id: mm.id as string, name: mm.name as string, unit: mm.unit as string,
          }))}
          lines={(recipeLines ?? []).map((l) => ({
            variantId: l.variant_id as string,
            materialId: l.material_id as string,
            quantityPerUnit: Number(l.quantity_per_unit),
          }))}
          doneByVariant={Object.fromEntries(doneByVariant)}
          usedByMaterial={Object.fromEntries(usedByMaterial)}
        />
      )}
    </AppShell>
  )
}
