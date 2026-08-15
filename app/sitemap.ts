import type { MetadataRoute } from 'next'
import { createClient } from '@/lib/supabase/server'
import { abs } from '@/lib/site'

// Карта сайта. Пересобирается раз в час: витрины появляются и скрываются
// сами (владелец нажал «зняти з публікації»), и суточная карта успевала бы
// звать бота на страницу, которой уже нет.
export const revalidate = 3600

// Опубликованные витрины берём через `map_tenants` — единственную функцию,
// которой анониму РАЗРЕШЕНО отдавать список магазинов и которая сама
// отсекает неопубликованное (`status = 'active' and storefront_enabled`).
//
// Своей выборкой из `tenants` здесь ходить нельзя дважды: во-первых, это
// был бы второй экземпляр правила «что считается опубликованным», и он
// однажды разойдётся с первым; во-вторых, обход политик ради карты сайта —
// именно тот случай, когда в индекс утекает черновик заведения.
//
// ⚠ Ограничение, которое надо знать: `map_tenants` требует координат
// (она про карту). Витрина без адреса на карте существует и открывается,
// но в эту карту сайта не попадёт. Расширять список анонимных точек ради
// этого — отдельное решение владельца, а не побочный эффект (правило 7).
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date()

  const staticPages: MetadataRoute.Sitemap = [
    { url: abs('/'), lastModified: now, changeFrequency: 'daily', priority: 1 },
    { url: abs('/search'), lastModified: now, changeFrequency: 'daily', priority: 0.8 },
    { url: abs('/map'), lastModified: now, changeFrequency: 'weekly', priority: 0.7 },
    { url: abs('/terms'), lastModified: now, changeFrequency: 'yearly', priority: 0.2 },
    { url: abs('/privacy'), lastModified: now, changeFrequency: 'yearly', priority: 0.2 },
    { url: abs('/cookies'), lastModified: now, changeFrequency: 'yearly', priority: 0.2 },
  ]

  try {
    const supabase = await createClient()
    const { data } = await supabase.rpc('map_tenants')
    const shops = (data ?? []) as { slug: string }[]

    return [
      ...staticPages,
      ...shops.map((s) => ({
        url: abs(`/t/${s.slug}`),
        lastModified: now,
        changeFrequency: 'weekly' as const,
        priority: 0.9,
      })),
    ]
  } catch {
    // База недоступна — отдаём хотя бы постоянные адреса. Пустая карта
    // сайта хуже короткой: бот воспримет её как «сайта больше нет».
    return staticPages
  }
}
