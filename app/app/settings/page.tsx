import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { currentMembership, can, hasModule } from '@/lib/tenant'
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

  // Готові набори довідників (0122). Список пресетів — це ПРОДУКТ, а не
  // дані закладу: у нього немає `tenant_id`, і читає його будь-хто вошедший.
  // Тягнемо на сервері, щоб клієнт не ходив за списком сам.
  // Відтінок бренду закладу (0123): один рядок, читається тим самим
  // правом, що й решта налаштувань.
  const { data: brandRow } = await supabase
    .from('tenant_branding').select('brand_color')
    .eq('tenant_id', m.tenantId).maybeSingle()

  // Налаштування сповіщень (0129). Рядка може не бути — і це нормальний
  // стан: доки заклад нічого не міняв, діють умовчання, зашиті
  // в `enqueue_expiry_for`. Екран показує їх як обране, щоб людина бачила,
  // що система робить сьогодні, а не порожні поля.
  const { data: notifyRow } = await supabase
    .from('notification_settings')
    .select('expiry_email, expiry_push, expiry_recipients')
    .eq('tenant_id', m.tenantId).maybeSingle()

  const { data: presetRows } = await supabase
    .from('presets')
    .select('code, title, description, kind, position')
    .eq('is_active', true)
    .order('position')

  type PresetRow = {
    code: string; title: string; description: string | null
    kind: string | null; position: number
  }

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
        // ⚠️ ЭТОТ ПРИЗНАК НЕ ПЕРЕДАВАЛСЯ ВОВСЕ, и умолчание `false`
        // в клиенте молча прятало публичную ссылку У ВСЕХ — включая
        // заклады с модулем `storefront`. То есть адреса, который кладут
        // в шапку Instagram, на экране «Магазин» не было ни у кого,
        // и починка описана прямо в комментарии к пропу: «одна строка
        // в page.tsx». Вот она.
        hasStorefront={hasModule(m, 'storefront')}
        // Пресет пропонується тільки той, що підходить виду закладу:
        // салону не потрібен набір категорій магазину товарів. `kind: null`
        // — підходить будь-якому.
        brand={(brandRow as { brand_color: string | null } | null)?.brand_color ?? null}
        notify={notifyRow
          ? {
            expiryEmail: (notifyRow as { expiry_email: boolean }).expiry_email,
            expiryPush: (notifyRow as { expiry_push: boolean }).expiry_push,
            recipients: (notifyRow as { expiry_recipients: string }).expiry_recipients,
          }
          : null}
        presets={((presetRows ?? []) as PresetRow[])
          .filter((p) => p.kind == null || p.kind === shop.kind)
          .map((p) => ({ code: p.code, title: p.title, description: p.description }))}
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
