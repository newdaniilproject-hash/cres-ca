import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'supabase_config.dart';
import 'theme.dart';

/// Маркет — приложение мастера: склад, журналы, учёт.
///
/// Приложение работает поверх ТОЙ ЖЕ базы, что и веб: склад с партиями,
/// расчёт срока вскрытой ёмкости, неизменяемые журналы, роли и RLS,
/// модули арендатора, очередь уведомлений — всё это Postgres. Приложение
/// не повторяет логику, оно рисует другие экраны. Отсюда правило: любое
/// действие идёт через те же функции базы (`record_stock_movement`,
/// `set_order_status`, …), а не мимо них «потому что здесь удобнее».
///
/// Почему отдельное приложение, а не обёртка вокруг сайта: обёртка
/// не выполняла пункт ТЗ об офлайне (без сети на старте показывала
/// системный экран ошибки вместо кабинета) и 05.08.2026 перестала
/// открываться во всех сборках. PWA офлайн тоже не решает: кэшируются
/// только просмотренные страницы, внести журнал или движение склада
/// без сети нельзя. Подробности — CLAUDE.md, раздел «Мобильная версия».
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Именно publishableKey, а не anonKey: последний объявлен устаревшим
  // и будет убран. Ключ у нас как раз нового вида — `sb_publishable_…`.
  await Supabase.initialize(
    url: SupabaseConfig.url,
    publishableKey: SupabaseConfig.publishableKey,
  );

  runApp(const MarketApp());
}

class MarketApp extends StatelessWidget {
  const MarketApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Маркет',
      // Тёмная тема — основной вид, а не «ночной режим»: системную тему
      // приложение намеренно не слушает, ровно как веб.
      theme: T.dark,
      debugShowCheckedModeBanner: false,
      home: const HealthScreen(),
    );
  }
}

/// Проверка связи — первый и пока единственный экран.
///
/// Он не продуктовый и не претендует им быть: экраны склада и журналов
/// строятся по спецификации из проекта Claude «Маркетплейс»
/// (`МОБИЛЬНОЕ-ПРИЛОЖЕНИЕ-FLUTTER-РЕШЕНИЕ.md`), и придумывать их вперёд
/// спецификации — как раз то, чего делать нельзя.
///
/// Польза у него ровно одна, зато настоящая: он проходит всю цепочку
/// целиком — сеть → Supabase → RLS → данные — и показывает, где именно
/// она рвётся. `active_cities()` выбрана потому, что это одна из восьми
/// функций, осознанно открытых анониму (CLAUDE.md, правило 7): она
/// отвечает без входа, поэтому проверяет связь, а не логин.
class HealthScreen extends StatefulWidget {
  const HealthScreen({super.key});

  @override
  State<HealthScreen> createState() => _HealthScreenState();
}

class _HealthScreenState extends State<HealthScreen> {
  late Future<int> _cities;

  @override
  void initState() {
    super.initState();
    _cities = _load();
  }

  Future<int> _load() async {
    final rows = await Supabase.instance.client.rpc('active_cities');
    return (rows as List).length;
  }

  @override
  Widget build(BuildContext context) {
    final session = Supabase.instance.client.auth.currentSession;

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: FutureBuilder<int>(
              future: _cities,
              builder: (context, snap) {
                if (snap.connectionState != ConnectionState.done) {
                  return const CircularProgressIndicator(color: T.accent);
                }

                final failed = snap.hasError;
                return Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text('Маркет', style: T.heading(28)),
                    const SizedBox(height: 8),
                    Text(
                      failed
                          ? 'Немає звʼязку з базою'
                          : 'База відповідає: міст — ${snap.data}',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 14,
                        height: 1.5,
                        color: failed ? T.danger : T.muted,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      session == null ? 'Не увійшли' : 'Сесія активна',
                      style: const TextStyle(fontSize: 13, color: T.faint),
                    ),
                    if (failed) ...[
                      const SizedBox(height: 20),
                      FilledButton(
                        onPressed: () => setState(() => _cities = _load()),
                        child: const Text('Спробувати ще раз'),
                      ),
                    ],
                  ],
                );
              },
            ),
          ),
        ),
      ),
    );
  }
}
