// Адрес проекта и публикуемый ключ.
//
// Эти два значения ПУБЛИЧНЫ по устройству Supabase: они уходят в браузер
// любого посетителя и защитой не являются. Единственная защита данных —
// политики RLS (см. supabase/migrations). Поэтому держать их в репозитории
// нормально, а прятать — самообман, создающий ложное чувство безопасности.
//
// Сервисный ключ (service_role) сюда не попадает НИКОГДА: он обходит RLS
// и живёт только в переменных окружения серверной части. См. CLAUDE.md, правило 3.

export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://jobvstdwoyifspaiwazn.supabase.co'

export const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_9WvSKed5ELlCfrno_L3D-Q_L5rH4Wtk'
