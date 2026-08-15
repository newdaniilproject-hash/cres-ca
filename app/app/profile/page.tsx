import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { currentMembership } from '@/lib/tenant'
import { AppShell } from '@/components/shell'
import { ProfileClient } from './profile-client'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Профіль' }

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
    <AppShell modules={m.modules} active="/app/profile" title="Профіль"
              subtitle="Обліковий запис, безпека та вихід">
      <ProfileClient
        email={user.email ?? ''}
        name={name}
        role={m.role}
        tenantName={tenant?.name ?? ''}
        tenantDraft={tenant?.status === 'draft'}
      />
    </AppShell>
  )
}
