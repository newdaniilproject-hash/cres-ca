import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { currentMembership, can } from '@/lib/tenant'
import { AppShell } from '@/components/shell'
import { SettingsClient } from './settings-client'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Магазин' }

export default async function SettingsPage() {
  const m = await currentMembership()
  if (!m) redirect('/register/seller')
  const supabase = await createClient()

  const [{ data: shop }, { data: team }] = await Promise.all([
    supabase.from('tenants')
      .select('id, name, slug, tagline, description, kind, status, storefront_enabled, city, address, contact_phone')
      .eq('id', m.tenantId).single(),
    supabase.from('tenant_members')
      .select('user_id, role, profiles!tenant_members_user_id_fkey(full_name, email)')
      .eq('tenant_id', m.tenantId),
  ])

  if (!shop) redirect('/register/seller')

  return (
    <AppShell active="/app/settings" title="Магазин">
      <SettingsClient
        shop={shop}
        canWrite={can(m, 'settings.write')}
        team={(team ?? []).map((t) => ({
          userId: t.user_id, role: t.role,
          name: (t.profiles as unknown as { full_name: string | null })?.full_name ?? null,
          email: (t.profiles as unknown as { email: string | null })?.email ?? null,
        }))}
      />
    </AppShell>
  )
}
