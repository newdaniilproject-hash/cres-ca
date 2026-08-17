import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isPlatformStaff } from '@/lib/tenant'
import { PlatformAccessClient } from './access-client'
import { getT } from '@/lib/i18n/server'

export const dynamic = 'force-dynamic'

export async function generateMetadata() {
  const t = await getT()
  return { title: t('platform.access.meta.title') }
}

// Экран выдачи доступа сотруднику платформы (0093).
//
// ПОЧЕМУ 404, А НЕ РЕДИРЕКТ И НЕ «НЕТ ПРАВ». Существование служебного
// адреса — это сведения. Человеку, который не сотрудник платформы, страница
// не должна отвечать ничем, кроме «такой страницы нет»: иначе перебором
// находится сам факт, что механика доступа существует и где она живёт.
//
// ЧТО ЭТА ПРОВЕРКА НЕ ДЕЛАЕТ. Она не открывает доступ и не является
// границей доверия: признак читается из токена и живёт до его обновления.
// Настоящая проверка — в роуте выдачи, там `profiles.is_staff` спрашивается
// у базы, и в политиках, где `has_platform_access()` требует ещё и грант.
export default async function PlatformAccessPage() {
  if (!(await isPlatformStaff())) notFound()

  const supabase = await createClient()

  // Свои гранты. Политика `platform_access_read` (0093) отдаёт сотруднику
  // ровно его строки, поэтому фильтра по staff_user_id здесь нет: он был бы
  // повтором того, что и так делает база, и разошёлся бы с ней при правке.
  //
  // Название заведения приходит связью: без него список — это набор UUID,
  // по которому нельзя понять, что отзываешь.
  const { data: grants } = await supabase
    .from('platform_access_grants')
    .select('id, tenant_id, reason, granted_at, expires_at, revoked_at, tenants(name, slug)')
    .order('granted_at', { ascending: false })
    .limit(100)

  // Связанное заведение приезжает массивом даже при связи «многие к одному»
  // — так типизирует вложенный select клиент Supabase. Разворачиваем ЗДЕСЬ,
  // один раз, а не приведением типа на экране: приведение молча переживёт
  // день, когда связь действительно станет множественной.
  const rows = (grants ?? []).map((g) => {
    const rel = g.tenants as unknown as { name: string; slug: string }[] | { name: string; slug: string } | null
    return { ...g, tenants: Array.isArray(rel) ? (rel[0] ?? null) : rel }
  })

  return <PlatformAccessClient grants={rows} />
}
