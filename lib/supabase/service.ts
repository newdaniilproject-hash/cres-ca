import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_URL } from './config'

// Сервисный клиент. Обходит RLS — по правилу 3 из CLAUDE.md используется
// ТОЛЬКО в фоновых задачах (сейчас — единственная: обработчик очереди
// уведомлений app/api/cron/notifications). Никогда не импортировать
// этот файл из серверного компонента, действия или API-роута,
// который выполняется на пути обычного пользовательского запроса.
//
// SUPABASE_SERVICE_ROLE_KEY — секрет. Живёт только в переменных окружения
// Vercel (Production/Preview), в репозитории его нет и быть не должно.
export function createServiceClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY не задан — обработчик уведомлений не может подключиться к базе.',
    )
  }
  return createSupabaseClient(SUPABASE_URL, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
