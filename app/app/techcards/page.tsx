import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { currentMembership } from '@/lib/tenant'
import { AppShell } from '@/components/shell'
import { TechCardsClient } from './techcards-client'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Техкарти обробки' }

// Технологические карты (ТЗ 3.4). Отдельного пункта меню нет —
// экран открывается ссылкой из журналов, поэтому подсветка остаётся там.
export default async function TechCardsPage() {
  const m = await currentMembership()
  if (!m) redirect('/register/seller')
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Карт мало по природе (регламент салона — это единицы документов),
  // поэтому забираем сразу все версии и группируем на клиенте:
  // без этого нельзя показать историю, а история здесь и есть смысл таблицы.
  const [{ data: cards, error: cardsError }, { data: services }] = await Promise.all([
    supabase.from('tech_cards')
      .select('id, title, version, steps, is_active, offering_id, created_at, offerings(title)')
      .eq('tenant_id', m.tenantId)
      .order('title')
      .order('version', { ascending: false })
      .limit(300),
    supabase.from('offerings')
      .select('id, title')
      .eq('tenant_id', m.tenantId)
      .eq('kind', 'service')
      .order('title')
      .limit(200),
  ])

  return (
    <AppShell modules={m.modules} active="/app/journals" title="Техкарти обробки">
      <TechCardsClient
        tenantId={m.tenantId}
        userId={user!.id}
        loadError={cardsError?.message ?? ''}
        cards={(cards ?? []).map((c) => ({
          id: c.id,
          title: c.title,
          version: c.version,
          steps: c.steps,
          isActive: c.is_active,
          offeringId: c.offering_id,
          offeringTitle: (c.offerings as unknown as { title: string } | null)?.title ?? null,
          createdAt: c.created_at,
        }))}
        services={(services ?? []).map((s) => ({ id: s.id, title: s.title }))}
      />
    </AppShell>
  )
}
