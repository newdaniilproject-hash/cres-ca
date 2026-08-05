import type { SupabaseClient } from '@supabase/supabase-js'

// Куда вести человека после входа. Одно место на всё приложение,
// чтобы экран приветствия и экран кода не расходились в решении.
//
// Нет сессии → приветствие. Есть сессия, но нет заведения → создание.
// Есть заведение → кабинет.
export async function nextRoute(supabase: SupabaseClient): Promise<string> {
  const { data } = await supabase.auth.getSession()
  if (!data.session) return '/m'

  const { data: rows, error } = await supabase
    .from('tenant_members')
    .select('tenant_id')
    .limit(1)

  // Ошибку чтения не превращаем в тупик: пустим в кабинет,
  // он сам разберётся и отправит куда надо.
  if (error) return '/app'
  return rows && rows.length > 0 ? '/app' : '/m/shop'
}
