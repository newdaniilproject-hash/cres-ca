import { createClient } from '@/lib/supabase/server'

export type Membership = { tenantId: string; role: string; perms: string[] }

// Членства читаются из JWT — ни одного запроса к базе (правило 3).
export async function getMemberships(): Promise<Membership[]> {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return []
  const meta = (session.user.app_metadata ?? {}) as {
    memberships?: Record<string, string>
    perms?: Record<string, string[]>
  }
  return Object.entries(meta.memberships ?? {}).map(([tenantId, role]) => ({
    tenantId,
    role,
    perms: meta.perms?.[tenantId] ?? [],
  }))
}

export function can(m: Membership | undefined, permission: string): boolean {
  if (!m) return false
  return m.perms.includes('*') || m.perms.includes(permission)
}

// Первый магазин пользователя — рабочий контекст кабинета.
// Переключатель нескольких магазинов появится вместе со вторым клиентом,
// у которого их два (не раньше — см. CLAUDE.md про паритет).
export async function currentMembership(): Promise<Membership | null> {
  const list = await getMemberships()
  return list[0] ?? null
}
