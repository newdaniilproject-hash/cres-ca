import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { currentMembership } from '@/lib/tenant'
import { AppShell } from '@/components/shell'
import { JournalsClient } from './journals-client'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Санітарні журнали' }

export default async function JournalsPage() {
  const m = await currentMembership()
  if (!m) redirect('/register/seller')
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const [{ data: solutions }, { data: tasks }, { data: entries }, { data: cycles }] =
    await Promise.all([
      supabase.from('sanitation_solutions')
        .select('id, agent_name, concentration, volume, unit, prepared_at, expires_at')
        .eq('tenant_id', m.tenantId).order('prepared_at', { ascending: false }).limit(30),
      supabase.from('cleaning_tasks')
        .select('id, name, schedule').eq('tenant_id', m.tenantId)
        .eq('is_active', true).order('position'),
      supabase.from('cleaning_entries')
        .select('task_id, performed_at').eq('tenant_id', m.tenantId)
        .gte('performed_at', new Date(new Date().setHours(0, 0, 0, 0)).toISOString()),
      supabase.from('sterilization_cycles')
        .select('id, device, temperature_c, duration_minutes, indicator_ok, performed_at')
        .eq('tenant_id', m.tenantId).order('performed_at', { ascending: false }).limit(30),
    ])

  return (
    <AppShell modules={m.modules} active="/app/journals" title="Санітарні журнали">
      <JournalsClient
        tenantId={m.tenantId}
        userId={user!.id}
        solutions={solutions ?? []}
        tasks={(tasks ?? []).map((t) => ({
          ...t,
          doneToday: (entries ?? []).some((e) => e.task_id === t.id),
        }))}
        cycles={cycles ?? []}
      />
    </AppShell>
  )
}
