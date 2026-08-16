import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { currentMembership, can } from '@/lib/tenant'
import { AppShell } from '@/components/shell'
import { TeamClient } from './team-client'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Команда' }

// Экран команды. Ролей и функций под него было шесть штук с 0050 по 0079,
// а входа к ним не существовало ни одного: приглашение сотрудника
// оформлялось «напишите мне, я заведу руками».
//
// Всё читается ЗДЕСЬ, на сервере, и уходит вниз готовым. Причина не
// в моде на серверные компоненты: `team_overview` и `team_sessions` —
// SECURITY DEFINER, они отдают почту и адреса сеансов, и их результат
// не должен лежать в клиентском кэше дольше одного отрисовывания.
export default async function TeamPage() {
  const m = await currentMembership()
  if (!m) redirect('/register/seller')
  if (!can(m, 'team.read')) redirect('/app')

  const supabase = await createClient()

  const [{ data: members }, { data: invites }, { data: sessions },
         { data: templates }, { data: grants }, { data: caps }, { data: me }] =
    await Promise.all([
      supabase.rpc('team_overview', { p_tenant_id: m.tenantId }),
      supabase.from('invitations')
        .select('id, email, role, status, created_at, expires_at, access_days')
        .eq('tenant_id', m.tenantId).eq('status', 'pending')
        .order('created_at', { ascending: false }),
      supabase.rpc('team_sessions', { p_tenant_id: m.tenantId }),
      supabase.from('permission_templates')
        .select('id, name, role, permissions, cap_pct')
        .eq('tenant_id', m.tenantId).order('name'),
      // Справочник прав: перечень берётся из role_grants, а не из списка
      // в коде. Право, заведённое миграцией, появляется на экране само —
      // иначе новый пункт доступа надо помнить продублировать здесь.
      supabase.from('role_grants').select('role, permission'),
      supabase.from('role_discount_caps').select('role, cap_pct'),
      supabase.auth.getUser(),
    ])

  const { data: shop } = await supabase.from('tenants')
    .select('name').eq('id', m.tenantId).single()

  return (
    <AppShell modules={m.modules} active="/app/team" title="Команда">
      <TeamClient
        tenantId={m.tenantId}
        shopName={shop?.name ?? ''}
        myUserId={me?.user?.id ?? ''}
        myRole={m.role}
        canWrite={can(m, 'team.write')}
        members={members ?? []}
        invites={invites ?? []}
        sessions={sessions ?? []}
        templates={templates ?? []}
        grants={grants ?? []}
        caps={caps ?? []}
      />
    </AppShell>
  )
}
