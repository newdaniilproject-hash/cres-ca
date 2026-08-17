import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_URL } from './config'

// Сервисный клиент. Обходит RLS — по правилу 3 из CLAUDE.md он допустим
// только там, где иначе нельзя, и каждое такое место названо здесь поимённо.
// Их три, и ни одно не лежит на пути обычного пользовательского рендера:
//
//   app/api/cron/notifications  — фоновая задача, вызывается расписанием;
//   app/api/auth/sign-in        — журнал неудачных входов пишется ДО того,
//                                 как человек вошёл, то есть сессии ещё нет;
//   app/api/platform/access     — выдача доступа сотруднику платформы (0093).
//                                 На platform_access_grants намеренно нет
//                                 политик на INSERT и UPDATE: грант выдаёт
//                                 платформа по обращению, а не арендатор.
//
// Четвёртое место добавляется только вместе со строкой в этом списке
// и объяснением, почему обычного клиента там не хватает. «Так проще» —
// не объяснение: сервисный ключ снимает RLS целиком, и ошибка в таком
// коде не ловится ни политикой, ни тестом матрицы прав.
//
// В серверном компоненте и в серверном действии — никогда.
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
