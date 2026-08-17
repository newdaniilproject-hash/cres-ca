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

  const meta = user.user_metadata ?? {}
  const name = ((meta.full_name as string | undefined)
    ?? [meta.first_name, meta.last_name].filter(Boolean).join(' ')).trim()

  return (
    <AppShell modules={m.modules} perms={m.perms}>
      <ProfileClient
        email={user.email ?? ''}
        name={name}
        role={m.role}
        tenantName={tenant?.name ?? ''}
        tenantDraft={tenant?.status === 'draft'}
        // `/app/settings` требует `settings.read` и разворачивает всех
        // остальных на `/app`. Право считается здесь и приезжает пропом:
        // клиент за правами в базу не ходит (правило 3).
        canSettings={can(m, 'settings.read')}
      />
    </AppShell>
  )
}
