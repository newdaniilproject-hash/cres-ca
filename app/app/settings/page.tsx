import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { currentMembership, can } from '@/lib/tenant'
import { AppShell } from '@/components/shell'
import { SettingsClient } from './settings-client'
import { getT } from '@/lib/i18n/server'

export const dynamic = 'force-dynamic'

// Заголовок вкладки браузера — строка интерфейса, поэтому из словаря.
// Разбор решения — в `app/app/journals/page.tsx`.
export async function generateMetadata() {
  const t = await getT()
  return { title: t('settings.meta.title') }
}

export default async function SettingsPage() {
  const m = await currentMembership()
  if (!m) redirect('/register/seller')
  // Право на ВХОД, а не только на правку. `can(m,'settings.write')` ниже
  // управляет режимом «только чтение» — это про кнопки, а не про доступ.
  // Пока проверки на входе не было, `/app/settings` открывался прямым
  // адресом у operator, accountant, viewer и inspector: меню пункт прячет,
  // но спрятанный пункт ничего не запрещает. Человек видел карточку
  // закладу и список команды с именами и почтами — то есть экран, которого
  // ему видеть не положено (RLS на `tenants` пускает любого участника).
  if (!can(m, 'settings.read')) redirect('/app')

  // Состав команды — ВТОРОЕ право, а не то же самое. На экран пускает
  // `settings.read`, а имена и почты отдаёт `team_overview` по `team.read`
  // (0082). Совпадают они только в готовых ролях (owner, admin, manager);
  // точечное снятие права у участника (`permissions` в `tenant_members`,
  // 0077) разводит их немедленно — проверено на бою: менеджер с
  // `{"team.read": false}` держит `settings.read` и получает от
  // `team_overview` ноль строк.
  //
  // Пустой список в этом случае был бы третьим за проект молчаливым
  // враньём («в закладі ви один»), поэтому наружу уезжает признак:
  // список не показан, потому что нет права, — и клиент это говорит.
  const canSeeTeam = can(m, 'team.read')

  const supabase = await createClient()

  const [{ data: shop }, team] = await Promise.all([
    supabase.from('tenants')
      .select('id, name, slug, tagline, description, kind, status, storefront_enabled, city, address, contact_phone')
      .eq('id', m.tenantId).single(),
    // Была вложенная связь `profiles!tenant_members_user_id_fkey(...)`.
    // Политика `profiles_self_read` (0001) отдаёт профиль ТОЛЬКО про себя,
    // а связь к закрытой таблице возвращает `null`, а не отказ, — поэтому
    // экран с самого начала показывал имя и почту одной строки, своей,
    // и «Без імені» у всех остальных. Это видел и владелец.
    canSeeTeam
      ? supabase.rpc('team_overview', { p_tenant_id: m.tenantId })
      : null,
  ])

  if (!shop) redirect('/register/seller')

  type TeamRow = {
    user_id: string; full_name: string | null; email: string | null
    role: string; blocked_at: string | null
  }

  return (
    <AppShell modules={m.modules} perms={m.perms}>
      <SettingsClient
        shop={shop}
        canWrite={can(m, 'settings.write')}
        canSeeTeam={canSeeTeam}
        team={((team?.data ?? []) as TeamRow[]).map((t) => ({
          userId: t.user_id, role: t.role,
          name: t.full_name, email: t.email,
          // `blocked_at` после 0082 означает ровно «немає доступу»
          // (карточка мастера «не працює» живёт отдельно в `staff_*`).
          // Человек без доступа в списке команды без пометки — тот же
          // молчаливый обман, только про состав.
          blocked: t.blocked_at != null,
        }))}
      />
    </AppShell>
  )
}
