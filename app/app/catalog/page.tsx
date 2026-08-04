import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { currentMembership } from '@/lib/tenant'
import { AppShell } from '@/components/shell'
import { CatalogClient } from './catalog-client'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Каталог' }

type MediaRow = { path: string; position: number }
type VariantRow = { id: string; price: number | null }

// Обложка и число вариантов приходят вложенными выборками, а не отдельными
// запросами: список каталога открывают чаще любого другого экрана кабинета,
// и три поездки в базу вместо одной здесь заметны (правило 6).
export default async function CatalogPage() {
  const m = await currentMembership()
  if (!m) redirect('/register/seller')
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('offerings')
    .select(
      `id, kind, status, title, subtitle, price, currency, slug, listed,
       offering_media(path, position), offering_variants(id, price)`,
    )
    .eq('tenant_id', m.tenantId)
    .order('updated_at', { ascending: false })
    .limit(200)

  return (
    <AppShell active="/app/catalog" title="Каталог">
      <CatalogClient
        error={error?.message ?? null}
        items={(data ?? []).map((o) => {
          const media = ([...((o.offering_media ?? []) as MediaRow[])])
            .sort((a, b) => a.position - b.position)
          const variants = (o.offering_variants ?? []) as VariantRow[]
          // Цена-витрина заполнена не всегда. Тогда показываем минимальную
          // по вариантам — ровно то число, которое увидит покупатель.
          const fromVariants = variants
            .map((v) => (v.price == null ? null : Number(v.price)))
            .filter((p): p is number => p !== null)

          return {
            id: o.id as string,
            kind: o.kind as 'product' | 'service',
            status: o.status as string,
            title: o.title as string,
            subtitle: (o.subtitle ?? null) as string | null,
            slug: o.slug as string,
            listed: o.listed as boolean,
            currency: o.currency as string,
            price: o.price != null
              ? Number(o.price)
              : fromVariants.length > 0 ? Math.min(...fromVariants) : null,
            variants: variants.length,
            cover: media[0]?.path ?? null,
          }
        })}
      />
    </AppShell>
  )
}
