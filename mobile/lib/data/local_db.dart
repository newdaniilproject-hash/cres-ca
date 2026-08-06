// Локальная база приложения. Она НЕ кэш «на всякий случай» — это
// единственный источник, из которого читают экраны. И офлайн, и онлайн.
//
// Смысл решения: если экран умеет читать только из сети, офлайн-режим
// становится особым случаем, который забывают проверять. Здесь особого
// случая нет — сеть лишь обновляет то, что уже лежит в телефоне.
//
// Схема повторяет боевые таблицы Supabase (проект jobvstdwoyifspaiwazn),
// снятые напрямую 05.08.2026, а не по памяти. Отличия от Postgres
// сознательные и перечислены:
//   • uuid → text. SQLite своего типа не имеет, а сравнение строк
//     работает так же.
//   • date → text в формате YYYY-MM-DD. Дата срока годности — это
//     календарный день, а не момент времени; превращать её в DateTime
//     значит однажды получить сдвиг на сутки из-за часового пояса.
//   • timestamptz → DateTime (drift хранит как unix-время, UTC).
//   • numeric → real. Остаток на складе салона — граммы и штуки,
//     точности double хватает с запасом. Источник правды всё равно
//     сервер: расхождение лечится обновлением зеркала, а не подгонкой
//     локального числа.
//
// Правило 5 проекта здесь тоже действует: current_stock ниже — ЗЕРКАЛО
// серверного кэша, считать по нему ничего нельзя и писать в него
// вручную нельзя. Любое изменение остатка идёт через очередь исходящих
// (outbox.dart) в функцию record_stock_movement.

import 'package:drift/drift.dart';
import 'package:drift_flutter/drift_flutter.dart';

part 'local_db.g.dart';

/// Расходники и товары. Зеркало `public.materials`.
class Materials extends Table {
  TextColumn get id => text()();
  TextColumn get tenantId => text()();
  TextColumn get name => text()();
  TextColumn get unit => text()();
  TextColumn get category => text().nullable()();

  /// Зеркало серверного кэша остатка. НЕ ИЗМЕНЯТЬ локально:
  /// правда — журнал движений, см. шапку файла.
  RealColumn get currentStock => real().withDefault(const Constant(0))();
  RealColumn get minStockThreshold => real().withDefault(const Constant(0))();
  RealColumn get costPerUnit => real().nullable()();

  TextColumn get sku => text().nullable()();
  TextColumn get brand => text().nullable()();
  TextColumn get countryOfOrigin => text().nullable()();
  TextColumn get inci => text().nullable()();

  /// Код нотификации МОЗ. Вводится руками — открытого реестра нет,
  /// автосверку обещать нельзя (записано в аудите ТЗ).
  TextColumn get notificationCode => text().nullable()();

  /// Срок после вскрытия, месяцев. Из него сервер считает use_by.
  IntColumn get paoMonths => integer().nullable()();
  BoolColumn get isCosmetic => boolean().withDefault(const Constant(false))();
  BoolColumn get isActive => boolean().withDefault(const Constant(true))();

  TextColumn get supplierId => text().nullable()();
  TextColumn get locationId => text().nullable()();

  DateTimeColumn get createdAt => dateTime()();
  DateTimeColumn get updatedAt => dateTime()();

  @override
  Set<Column> get primaryKey => {id};
}

/// Партии. Зеркало `public.material_batches`.
/// Строки не меняются после создания — дельта тянется по created_at.
class MaterialBatches extends Table {
  TextColumn get id => text()();
  TextColumn get tenantId => text()();
  TextColumn get materialId => text()();
  TextColumn get batchNumber => text()();

  /// YYYY-MM-DD, см. шапку про даты.
  TextColumn get expiryDate => text()();
  TextColumn get receivedAt => text()();

  TextColumn get supplierId => text().nullable()();
  TextColumn get note => text().nullable()();
  TextColumn get createdBy => text()();
  DateTimeColumn get createdAt => dateTime()();

  @override
  Set<Column> get primaryKey => {id};
}

/// Ёмкости (банки, дозаторы). Зеркало `public.material_containers`.
///
/// use_by считает и запирает триггер на сервере: меньшее из срока партии
/// и «дата открытия + PAO». Локально это поле только читается —
/// пересчитывать его на телефоне значит спорить с базой и однажды
/// показать мастеру срок, которого нет в отчёте для проверки.
class MaterialContainers extends Table {
  TextColumn get id => text()();
  TextColumn get tenantId => text()();
  TextColumn get materialId => text()();
  TextColumn get batchId => text().nullable()();

  /// Код с QR-наклейки — по нему ищет сканер.
  TextColumn get code => text()();
  TextColumn get parentId => text().nullable()();

  RealColumn get volume => real().nullable()();
  TextColumn get unit => text().nullable()();

  /// enum на сервере: sealed / opened / finished / disposed.
  /// Хранится строкой — значения приходят из базы как есть.
  TextColumn get status => text()();

  DateTimeColumn get openedAt => dateTime().nullable()();
  TextColumn get openedBy => text().nullable()();
  IntColumn get paoMonths => integer().nullable()();

  /// YYYY-MM-DD. Считается сервером, локально только читается.
  TextColumn get useBy => text().nullable()();

  DateTimeColumn get disposedAt => dateTime().nullable()();
  TextColumn get disposedBy => text().nullable()();
  TextColumn get note => text().nullable()();

  TextColumn get createdBy => text()();
  DateTimeColumn get createdAt => dateTime()();
  DateTimeColumn get updatedAt => dateTime()();

  @override
  Set<Column> get primaryKey => {id};
}

/// Очередь исходящих действий — сердце офлайна.
///
/// Сюда попадает КАЖДОЕ действие мастера, независимо от наличия сети.
/// Экран не спрашивает «есть ли интернет»: он кладёт запись сюда
/// и сразу показывает результат. Разбирает очередь sync-слой.
///
/// Почему очередь, а не «попробовать и при ошибке сохранить»: во втором
/// случае поведение приложения зависит от сети, и офлайн-путь проверяется
/// только когда о нём вспомнят. Здесь путь один.
class Outbox extends Table {
  IntColumn get id => integer().autoIncrement()();

  /// Ключ идемпотентности, сгенерированный НА ТЕЛЕФОНЕ в момент действия
  /// и неизменный при повторах. Ради него в базе у record_stock_movement
  /// есть параметр p_idempotency_key. Смысл: связь оборвалась после того,
  /// как сервер принял списание, но до того, как ответил — повтор придёт
  /// с тем же ключом и товар не спишется дважды.
  TextColumn get idempotencyKey => text()();

  /// Что делаем: 'container.status', 'stock.movement', 'journal.cleaning',
  /// 'journal.solution', 'journal.sterilization'. Разбор — в outbox.dart.
  TextColumn get kind => text()();

  /// Параметры действия, JSON.
  TextColumn get payload => text()();

  /// Человеческая подпись для полосы «N записів чекають мережі»:
  /// «Відкрити банку · B-124». Мастер должен видеть, что именно висит.
  TextColumn get label => text()();

  /// Время НАЖАТИЯ, а не отправки. В журнал уборки должно попасть
  /// время, когда мастер реально протёр стол, а не когда в подвале
  /// появился интернет. Это прямо влияет на проверку.
  DateTimeColumn get happenedAt => dateTime()();

  /// Ключ блокировки порядка: операции с одним объектом уходят строго
  /// по очереди. «Открыть банку» и «списать из неё» местами меняться
  /// не должны. Обычно это id ёмкости или материала.
  TextColumn get blockKey => text().nullable()();

  IntColumn get attempts => integer().withDefault(const Constant(0))();

  /// pending — ждёт отправки; sent — доехало; failed — сервер отверг
  /// по существу (нет прав, сторож не пустил). failed НЕ удаляется молча:
  /// потерянная запись санитарного журнала — это штраф у клиента.
  TextColumn get state => text().withDefault(const Constant('pending'))();
  TextColumn get error => text().nullable()();

  // primaryKey здесь не объявляется намеренно: autoIncrement() уже
  // делает id первичным ключом, а явный override drift запрещает.
}

/// Отметки времени последней успешной синхронизации по таблицам.
/// По ним тянется дельта: `updated_at > lastSyncedAt`.
class SyncState extends Table {
  /// Не `tableName`: у drift этим геттером переопределяют имя самой
  /// таблицы, и колонка с таким именем не компилируется. В SQLite
  /// колонка по-прежнему называется `table_name`.
  TextColumn get tableKey => text().named('table_name')();
  DateTimeColumn get lastSyncedAt => dateTime().nullable()();

  @override
  Set<Column> get primaryKey => {tableKey};
}

@DriftDatabase(
  tables: [Materials, MaterialBatches, MaterialContainers, Outbox, SyncState],
)
class LocalDb extends _$LocalDb {
  LocalDb() : super(_open());

  LocalDb.forTesting(super.connection);

  @override
  int get schemaVersion => 1;

  static QueryExecutor _open() => driftDatabase(name: 'cresca_local');

  // ── Чтение для экранов ────────────────────────────────────────────

  /// Активные расходники, по алфавиту. Экран склада читает это —
  /// и с сетью, и без неё.
  Future<List<Material>> activeMaterials() =>
      (select(materials)
            ..where((m) => m.isActive.equals(true))
            ..orderBy([(m) => OrderingTerm(expression: m.name)]))
          .get();

  /// То же, но потоком: экран сам перерисуется, когда синхронизация
  /// обновит зеркало. Ручное «потяните, чтобы обновить» остаётся,
  /// но не является единственным способом увидеть свежие данные.
  Stream<List<Material>> watchActiveMaterials() =>
      (select(materials)
            ..where((m) => m.isActive.equals(true))
            ..orderBy([(m) => OrderingTerm(expression: m.name)]))
          .watch();

  /// Поиск ёмкости по коду с наклейки — то, что делает сканер.
  /// Работает без сети: коды уже лежат в телефоне.
  Future<MaterialContainer?> containerByCode(String code) =>
      (select(materialContainers)
            ..where((c) => c.code.equals(code.trim().toUpperCase()))
            ..limit(1))
          .getSingleOrNull();

  /// Сколько действий ждёт отправки — для полосы состояния.
  Stream<int> watchPendingCount() {
    final q = selectOnly(outbox)
      ..addColumns([outbox.id.count()])
      ..where(outbox.state.equals('pending'));
    return q.map((r) => r.read(outbox.id.count()) ?? 0).watchSingle();
  }

  /// Действия, отвергнутые сервером. Экран обязан их показать:
  /// молча потерянный журнал — это штраф у клиента.
  Stream<List<OutboxData>> watchFailed() =>
      (select(outbox)..where((o) => o.state.equals('failed'))).watch();
}
