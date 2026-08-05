/// Адрес проекта и публикуемый ключ.
///
/// Эти два значения ПУБЛИЧНЫ по устройству Supabase: в вебе они уходят
/// в браузер любого посетителя, в приложении — лежат в бинаре, который
/// распаковывается за минуту. Защитой они не являются ни там, ни там.
/// Единственная защита данных — политики RLS (см. `supabase/migrations`).
/// Поэтому держать их в репозитории нормально, а прятать — самообман.
///
/// Ровно то же решение и та же причина, что в `lib/supabase/config.ts`
/// у веба: два клиента ходят в одну базу и живут по одним правилам.
///
/// Сервисный ключ (service_role) сюда не попадает НИКОГДА: он обходит RLS.
/// В приложении ему места нет в принципе — у него нет серверной части,
/// куда его можно было бы спрятать. См. CLAUDE.md, правило 3.
///
/// Значения перекрываются при сборке, если понадобится другой стенд:
///   flutter run --dart-define=SUPABASE_URL=... --dart-define=SUPABASE_KEY=...
class SupabaseConfig {
  const SupabaseConfig._();

  static const url = String.fromEnvironment(
    'SUPABASE_URL',
    defaultValue: 'https://jobvstdwoyifspaiwazn.supabase.co',
  );

  static const publishableKey = String.fromEnvironment(
    'SUPABASE_KEY',
    defaultValue: 'sb_publishable_9WvSKed5ELlCfrno_L3D-Q_L5rH4Wtk',
  );
}
