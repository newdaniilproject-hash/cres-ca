// Адрес проекта и публикуемый ключ. ОДИН источник на оба приложения.
//
// Эти два значения ПУБЛИЧНЫ по устройству Supabase: они уходят в браузер
// любого посетителя и в бандл мобильного приложения, и защитой не являются.
// Единственная защита данных — политики RLS (см. supabase/migrations).
// Поэтому держать их в репозитории нормально, а прятать — самообман,
// создающий ложное чувство безопасности.
//
// Сервисный ключ (service_role) сюда не попадает НИКОГДА: он обходит RLS
// и живёт только в переменных окружения серверной части. См. CLAUDE.md, правило 3.
//
// ПОЧЕМУ ДВА ПРЕФИКСА. Сборщики подставляют значения переменных в код на
// этапе сборки, и каждый признаёт только свой префикс: Next — `NEXT_PUBLIC_`,
// Expo — `EXPO_PUBLIC_`. Тот, что не его, остаётся `undefined` и молча
// пропускается. Это не два источника правды: значение одно, читается оно
// в одном файле, а строк две ровно потому, что бандлера два.

export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  process.env.EXPO_PUBLIC_SUPABASE_URL ??
  'https://jobvstdwoyifspaiwazn.supabase.co'

export const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  'sb_publishable_9WvSKed5ELlCfrno_L3D-Q_L5rH4Wtk'
