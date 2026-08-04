import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config'

// Клиент для серверных компонентов и серверных действий.
// Работает от имени вошедшего пользователя: его роль читается из JWT,
// а RLS ограничивает выдачу. Сервисный ключ здесь не используется —
// это прямое следствие правила 3 из CLAUDE.md.
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          )
        } catch {
          // Вызов из серверного компонента: куки уже отправлены.
          // Обновление сессии делает middleware — это ожидаемо, не ошибка.
        }
      },
    },
  })
}
