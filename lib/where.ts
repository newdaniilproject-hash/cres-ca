import type { SupabaseClient } from '@supabase/supabase-js'

// Куда вести человека после входа. Одно место на всё приложение,
// чтобы экран приветствия и экран кода не расходились в решении.
//
// Нет сессии → приветствие. Есть сессия, но нет заведения → создание.
// Есть заведение → кабинет.
//
// CRESKO — склад для мастеров: КАЖДЫЙ, кто регистрируется, регистрируется
// как бизнес. Поэтому «нет заведения» ведёт на его создание, а не
// в покупательский кабинет /account: тот остаётся доступен по прямой
// ссылке, но точкой приземления после входа не является.
//
// Поверхностей две — веб и приложение (/m), — и различаются они ТОЛЬКО
// адресами: решение («нет сессии / нет заведения / есть заведение»)
// у них общее. Поэтому здесь таблица адресов, а не вторая копия функции:
// правило «не забудь продублировать» — признак отсутствующей архитектуры.
const ROUTES = {
  web: { anon: '/login', shop: '/register/seller', app: '/app' },
  m: { anon: '/m', shop: '/m/shop', app: '/app' },
} as const

export type Surface = keyof typeof ROUTES

export async function nextRoute(
  supabase: SupabaseClient,
  // По умолчанию — приложение: так эту функцию звали до появления веба,
  // и все вызовы из /m остаются без аргумента.
  surface: Surface = 'm',
): Promise<string> {
  const routes = ROUTES[surface]

  const { data } = await supabase.auth.getSession()
  if (!data.session) return routes.anon

  const { data: rows, error } = await supabase
    .from('tenant_members')
    .select('tenant_id')
    .limit(1)

  // Ошибку чтения не превращаем в тупик: пустим в кабинет,
  // он сам разберётся и отправит куда надо (app/app/page.tsx
  // без членства делает redirect на создание заведения).
  if (error) return routes.app
  return rows && rows.length > 0 ? routes.app : routes.shop
}
