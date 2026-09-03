import { createClient } from '@/lib/supabase/server'
import {
  isStaffFromToken, parseMemberships, userIdFromToken,
  type Membership,
} from '@/shared/access'

// Модули — что арендатор купил и видит. Не путать с правами: право
// отвечает «что этому человеку можно», модуль — «что этот бизнес взял».
// См. supabase/migrations/0020_modules.sql.
//
// ⚠️ РАЗБОР ТОКЕНА ЗДЕСЬ БОЛЬШЕ НЕ ЖИВЁТ. Он переехал в `shared/access.ts`,
// потому что ровно тот же разбор делает мобильное приложение, а две копии
// проверки прав — это гарантированное расхождение: одно приложение
// покажет раздел, который база не отдаст, второе спрячет оплаченный.
// Здесь остаётся только то, что специфично для ВЕБА: получение сессии
// серверным клиентом на куках.
//
// Что отсюда УДАЛЕНО 19.08.2026 и не возвращать:
//   • `DEFAULT_MODULES` — копия умолчания из миграции. Умолчание считает
//     триггер `tenants_default_modules` из реестра (`is_default`);
//   • `MODULE_LABELS` — подписи, захардкоженные по-украински мимо словаря.
//     Подпись лежит в `modules.title` и читается через `lib/modules.ts`.
export type { KnownModule, Membership, TenantModule } from '@/shared/access'
export { can, hasModule } from '@/shared/access'

/**
 * Идентификатор вошедшего — из УЖЕ РАЗОБРАННОГО токена, без сети.
 *
 * Зачем понадобилось. Экраны кабинета брали его через
 * `supabase.auth.getUser()`, а это ОБРАЩЕНИЕ ПО СЕТИ к серверу
 * авторизации: он сверяет подпись у себя. На каждый серверный рендер
 * получался лишний круг к Ирландии — и это при том, что на той же
 * странице `currentMembership()` уже прочитал тот же самый токен
 * локально. Замер держится в `docs/PERFORMANCE.md`.
 *
 * Почему это не ослабление. Значение идёт в формы как `created_by`,
 * то есть УЖЕ приходит от клиента и уже может быть подделано в запросе.
 * Отсекает подделку не оно, а политика RLS, сверяющая `created_by`
 * с `auth.uid()` внутри базы. Прочитать id из токена ровно так же
 * безопасно, как спросить его у сервера, — граница доверия в обоих
 * случаях одна и та же и лежит не здесь.
 *
 * `getUser()` остаётся уместным там, где решение принимается ПО ФАКТУ
 * существования пользователя и цена ошибки — доступ (серверные роуты,
 * запись сервисным ключом). Для «подставь id в скрытое поле» он
 * избыточен.
 */
export async function currentUserId(): Promise<string | null> {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return null
  return userIdFromToken(session.access_token)
}

export async function getMemberships(): Promise<Membership[]> {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return []
  return parseMemberships(session.access_token)
}

// Первый магазин пользователя — рабочий контекст кабинета.
// Переключатель нескольких магазинов появится вместе со вторым клиентом,
// у которого их два (не раньше — см. CLAUDE.md про паритет).
export async function currentMembership(): Promise<Membership | null> {
  const list = await getMemberships()
  return list[0] ?? null
}

/**
 * Сотрудник платформы — это НЕ роль в заведении, а признак человека
 * (`profiles.is_staff`), который хук кладёт в токен рядом с членствами.
 *
 * ⚠️ ЭТА ПРОВЕРКА НИЧЕГО НЕ ОТКРЫВАЕТ. С 0093 признак сам по себе не даёт
 * доступа ни к одной чужой строке: нужен ещё действующий грант на конкретное
 * заведение, с причиной и сроком, и его проверяет `has_platform_access()`
 * внутри политик. Здесь признак решает ровно один вопрос — рисовать ли
 * человеку экран выдачи доступа. Граница доверия, как и везде, — RLS
 * и серверный роут, а не этот вызов.
 *
 * Читается из разобранного токена по той же причине, что и членства
 * (правило 3): запрос к базе на каждый рендер меню недопустим. Плата —
 * признак вступает в силу с обновлением токена; для служебного экрана,
 * который открывают раз в месяц, это ничего не значит.
 */
export async function isPlatformStaff(): Promise<boolean> {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return false
  return isStaffFromToken(session.access_token)
}
