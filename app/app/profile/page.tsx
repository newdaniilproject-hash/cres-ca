import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { currentMembership, can } from '@/lib/tenant'
import { AppShell } from '@/components/shell'
import { getT } from '@/lib/i18n/server'
import { ProfileClient } from './profile-client'

export const dynamic = 'force-dynamic'

// Заголовок вкладки браузера — строка интерфейса, поэтому из словаря.
// Разбор решения — в `app/app/journals/page.tsx`.
export async function generateMetadata() {
  const t = await getT()
  return { title: t('profile.meta.title') }
}

// Профиль внутри кабинета.
//
// Раньше пункт «Профіль» вёл на /account — экран ПОКУПАТЕЛЯ: мои заказы,
// мои записи, публичная шапка сайта. Владелец салона попадал из кабинета
// на другой сайт по ощущению: другая шапка, другой набор действий,
// нижняя панель исчезала. Здесь всё, что нужно самому человеку:
// кто он, безопасность входа, вид, заведение и выход.
export default async function ProfilePage() {
  const m = await currentMembership()
  if (!m) redirect('/register/seller')

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: tenant } = await supabase
    .from('tenants').select('name, status').eq('id', m.tenantId).maybeSingle()

  // Имя и телефон — из profiles: шторка «Особисті дані» правит именно
  // эту строку, и после `router.refresh()` экран обязан показать новое
  // значение. Метаданные токена — запасной путь для старых акаунтов,
  // у которых профиль ещё пустой.
  const { data: profile } = await supabase
    .from('profiles').select('full_name, phone, avatar_url').eq('id', user.id).maybeSingle()

  const meta = user.user_metadata ?? {}
  const metaName = ((meta.full_name as string | undefined)
    ?? [meta.first_name, meta.last_name].filter(Boolean).join(' ')).trim()
  const name = (profile?.full_name ?? '').trim() || metaName

  // Когда человек в этом заведении. Единственная величина о нём самом,
  // которой нет больше нигде в кабинете, — поэтому она и стоит в шапке
  // профиля, а не счётчики заказов: те уже названы на «Сьогодні»,
  // и второй их показ был бы повтором (проверка 3).
  const { data: membership } = await supabase
    .from('tenant_members').select('created_at')
    .eq('tenant_id', m.tenantId).eq('user_id', user.id).maybeSingle()

  // Карточка мастера, привязанная к этой учётной записи. Привязка
  // `staff.user_id` ставится извне и у большинства пуста — поэтому
  // числа «мої записи» показываются ТОЛЬКО когда карточка есть.
  // Плитка со счётчиком, за которой нет данных, — это подделка,
  // и не показывать её честнее, чем показать ноль (правило прохода
  // экрана: «этих величин в продукте нет, и подделывать плитку хуже»).
  const { data: staffRow } = await supabase
    .from('staff').select('id')
    .eq('tenant_id', m.tenantId).eq('user_id', user.id).maybeSingle()

  let bookingsToday: number | null = null
  let bookingsWeek: number | null = null
  if (staffRow?.id) {
    // Границы считаются в поясе СЕРВЕРА (UTC), и это осознанное
    // упрощение: величина справочная, а не учётная. Там, где сутки
    // решают (`available_slots`, отпуска мастера), пояс берётся
    // из карточки мастера — здесь этого не требуется.
    const now = new Date()
    const d0 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    const d1 = new Date(d0.getTime() + 864e5)
    const w1 = new Date(d0.getTime() + 7 * 864e5)
    const iso = (d: Date) => d.toISOString()
    const count = async (from: Date, to: Date) => {
      const { count: n } = await supabase
        .from('v_bookings')
        .select('id', { count: 'exact', head: true })
        .eq('staff_id', staffRow.id)
        .neq('status', 'cancelled')
        .filter('period', 'ov', `["${iso(from)}","${iso(to)}")`)
      return n ?? 0
    }
    bookingsToday = await count(d0, d1)
    bookingsWeek = await count(d0, w1)
  }

  return (
    <AppShell modules={m.modules} perms={m.perms}>
      <ProfileClient
        userId={user.id}
        tenantId={m.tenantId}
        email={user.email ?? ''}
        name={name}
        phone={profile?.phone ?? ''}
        avatarPath={profile?.avatar_url ?? ''}
        role={m.role}
        tenantName={tenant?.name ?? ''}
        tenantDraft={tenant?.status === 'draft'}
        joinedAt={membership?.created_at ?? null}
        bookingsToday={bookingsToday}
        bookingsWeek={bookingsWeek}
        // `/app/settings` требует `settings.read` и разворачивает всех
        // остальных на `/app`. Право считается здесь и приезжает пропом:
        // клиент за правами в базу не ходит (правило 3).
        canSettings={can(m, 'settings.read')}
      />
    </AppShell>
  )
}
