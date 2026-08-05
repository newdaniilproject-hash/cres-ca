import { createClient } from '@/lib/supabase/server'

// Модули — что арендатор купил и видит. Не путать с правами: право
// отвечает «что этому человеку можно», модуль — «что этот бизнес взял».
// Владелец с полными правами всё равно не увидит каталог, если заведение
// подключило только склад. См. supabase/migrations/0020_modules.sql.
export type TenantModule =
  | 'inventory' | 'compliance' | 'bookings' | 'catalog'
  | 'orders' | 'finance' | 'customers' | 'storefront' | 'marketing'

export type Membership = {
  tenantId: string
  role: string
  perms: string[]
  modules: TenantModule[]
}

// Членства, права и модули читаются из JWT — ни одного запроса к базе
// (правило 3). Разворачивает их хук при выдаче токена.
//
// ГРАБЛИ, из-за которых кабинет НИКОГДА не видел заведений и гонял
// человека по кругу «създай заклад → створи ещё раз» до лимита в три
// черновика: данные читались из session.user.app_metadata. Хук кладёт
// членства ВНУТРЬ самого access token — в его полезную нагрузку.
// А session.user — это запись из базы (raw_app_meta_data), какой она
// была при входе: provider, providers и всё. Хук её не трогает вовсе.
//
// Единственное место, где членства существуют, — сам JWT. Поэтому
// расшифровываем его полезную нагрузку руками. Подписи не проверяем
// сознательно: токен уже проверен Supabase на каждом запросе к базе,
// здесь мы только читаем то, что в нём написано, для раскладки меню.
// Граница доверия — RLS, а не эта функция.
function jwtPayload(accessToken: string): Record<string, unknown> {
  try {
    const part = accessToken.split('.')[1] ?? ''
    // base64url: у Node есть родная раскодировка, atob — запасной путь
    // на случай клиентского вызова.
    const json = typeof Buffer !== 'undefined'
      ? Buffer.from(part, 'base64url').toString('utf8')
      : atob(part.replace(/-/g, '+').replace(/_/g, '/'))
    return JSON.parse(json) as Record<string, unknown>
  } catch {
    return {}
  }
}

export async function getMemberships(): Promise<Membership[]> {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return []
  const meta = (jwtPayload(session.access_token).app_metadata ?? {}) as {
    memberships?: Record<string, string>
    perms?: Record<string, string[]>
    modules?: Record<string, TenantModule[]>
  }
  return Object.entries(meta.memberships ?? {}).map(([tenantId, role]) => ({
    tenantId,
    role,
    perms: meta.perms?.[tenantId] ?? [],
    modules: meta.modules?.[tenantId] ?? [],
  }))
}

export function can(m: Membership | undefined, permission: string): boolean {
  if (!m) return false
  return m.perms.includes('*') || m.perms.includes(permission)
}

export function hasModule(m: Membership | undefined, module: TenantModule): boolean {
  if (!m) return false
  return m.modules.includes(module)
}

// Первый магазин пользователя — рабочий контекст кабинета.
// Переключатель нескольких магазинов появится вместе со вторым клиентом,
// у которого их два (не раньше — см. CLAUDE.md про паритет).
export async function currentMembership(): Promise<Membership | null> {
  const list = await getMemberships()
  return list[0] ?? null
}
