// Обновление зеркала: как данные с сервера попадают в телефон.
//
// Направление строго одно: сервер → локальная база. Обратное
// направление — дело очереди исходящих (outbox_service.dart), и мешать
// их нельзя: у записи свои правила (функции с ключом идемпотентности),
// у чтения свои.
//
// Когда обновляемся:
//   • при запуске приложения;
//   • когда появилась сеть;
//   • когда мастер потянул список вниз;
//   • после того, как очередь исходящих что-то успешно отправила —
//     иначе экран покажет остаток до списания.
//
// Как обновляемся. У materials и material_containers есть updated_at —
// тянем только изменившееся. У material_batches есть только created_at,
// но строки партий после создания не меняются, поэтому дельта по нему
// корректна. Объём всё равно крошечный: склад одного салона — сотни
// строк, а не миллионы. Из-за этого здесь нет ни разрешения конфликтов,
// ни хитрых курсоров: их сложность окупается на других порядках.

import 'dart:async';

import 'package:drift/drift.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'local_db.dart';

class SyncService {
  SyncService(this._db, this._sb);

  final LocalDb _db;
  final SupabaseClient _sb;

  bool _running = false;

  /// Подтянуть свежее. Возвращает true, если прошло без ошибок сети.
  /// Безопасно звать часто: повторный вызов во время работы игнорируется.
  Future<bool> refresh() async {
    if (_running) return true;
    _running = true;
    try {
      await _pullMaterials();
      await _pullBatches();
      await _pullContainers();
      return true;
    } catch (_) {
      // Сети нет — не беда: экраны читают из локальной базы и работают
      // дальше на том, что уже есть. Молчим сознательно, красную плашку
      // «ошибка обновления» мастеру в подвале показывать незачем.
      return false;
    } finally {
      _running = false;
    }
  }

  // ── Отметки времени ───────────────────────────────────────────────

  Future<DateTime?> _since(String table) async {
    final row = await (_db.select(_db.syncState)
          ..where((s) => s.tableKey.equals(table)))
        .getSingleOrNull();
    return row?.lastSyncedAt;
  }

  /// Отметку ставим ПОСЛЕ успешной записи в локальную базу.
  /// Если поставить раньше и упасть на записи, дельта будет
  /// пропущена навсегда — строки не вернутся никогда.
  Future<void> _mark(String table, DateTime at) => _db
      .into(_db.syncState)
      .insertOnConflictUpdate(
        SyncStateCompanion.insert(
          tableKey: table,
          lastSyncedAt: Value(at),
        ),
      );

  // ── Таблицы ───────────────────────────────────────────────────────

  Future<void> _pullMaterials() async {
    const table = 'materials';
    final since = await _since(table);
    final now = DateTime.now().toUtc();

    var q = _sb.from(table).select();
    if (since != null) {
      q = q.gt('updated_at', since.toIso8601String());
    }
    final rows = (await q) as List<dynamic>;
    if (rows.isEmpty) {
      await _mark(table, now);
      return;
    }

    await _db.batch((b) {
      for (final r in rows.cast<Map<String, dynamic>>()) {
        b.insert(
          _db.materials,
          MaterialsCompanion.insert(
            id: r['id'] as String,
            tenantId: r['tenant_id'] as String,
            name: r['name'] as String,
            unit: r['unit'] as String,
            category: Value(r['category'] as String?),
            currentStock: Value(_num(r['current_stock'])),
            minStockThreshold: Value(_num(r['min_stock_threshold'])),
            costPerUnit: Value(_numOrNull(r['cost_per_unit'])),
            sku: Value(r['sku'] as String?),
            brand: Value(r['brand'] as String?),
            countryOfOrigin: Value(r['country_of_origin'] as String?),
            inci: Value(r['inci'] as String?),
            notificationCode: Value(r['notification_code'] as String?),
            paoMonths: Value(r['pao_months'] as int?),
            isCosmetic: Value(r['is_cosmetic'] as bool? ?? false),
            isActive: Value(r['is_active'] as bool? ?? true),
            supplierId: Value(r['supplier_id'] as String?),
            locationId: Value(r['location_id'] as String?),
            createdAt: _ts(r['created_at']),
            updatedAt: _ts(r['updated_at']),
          ),
          mode: InsertMode.insertOrReplace,
        );
      }
    });
    await _mark(table, now);
  }

  Future<void> _pullBatches() async {
    const table = 'material_batches';
    final since = await _since(table);
    final now = DateTime.now().toUtc();

    var q = _sb.from(table).select();
    if (since != null) {
      // Партии после создания не меняются — дельта по created_at честна.
      q = q.gt('created_at', since.toIso8601String());
    }
    final rows = (await q) as List<dynamic>;
    if (rows.isEmpty) {
      await _mark(table, now);
      return;
    }

    await _db.batch((b) {
      for (final r in rows.cast<Map<String, dynamic>>()) {
        b.insert(
          _db.materialBatches,
          MaterialBatchesCompanion.insert(
            id: r['id'] as String,
            tenantId: r['tenant_id'] as String,
            materialId: r['material_id'] as String,
            batchNumber: r['batch_number'] as String,
            expiryDate: _date(r['expiry_date']),
            receivedAt: _date(r['received_at']),
            supplierId: Value(r['supplier_id'] as String?),
            note: Value(r['note'] as String?),
            createdBy: r['created_by'] as String,
            createdAt: _ts(r['created_at']),
          ),
          mode: InsertMode.insertOrReplace,
        );
      }
    });
    await _mark(table, now);
  }

  Future<void> _pullContainers() async {
    const table = 'material_containers';
    final since = await _since(table);
    final now = DateTime.now().toUtc();

    var q = _sb.from(table).select();
    if (since != null) {
      q = q.gt('updated_at', since.toIso8601String());
    }
    final rows = (await q) as List<dynamic>;
    if (rows.isEmpty) {
      await _mark(table, now);
      return;
    }

    await _db.batch((b) {
      for (final r in rows.cast<Map<String, dynamic>>()) {
        b.insert(
          _db.materialContainers,
          MaterialContainersCompanion.insert(
            id: r['id'] as String,
            tenantId: r['tenant_id'] as String,
            materialId: r['material_id'] as String,
            batchId: Value(r['batch_id'] as String?),
            code: r['code'] as String,
            parentId: Value(r['parent_id'] as String?),
            volume: Value(_numOrNull(r['volume'])),
            unit: Value(r['unit'] as String?),
            status: r['status'] as String,
            openedAt: Value(_tsOrNull(r['opened_at'])),
            openedBy: Value(r['opened_by'] as String?),
            paoMonths: Value(r['pao_months'] as int?),
            useBy: Value(_dateOrNull(r['use_by'])),
            disposedAt: Value(_tsOrNull(r['disposed_at'])),
            disposedBy: Value(r['disposed_by'] as String?),
            note: Value(r['note'] as String?),
            createdBy: r['created_by'] as String,
            createdAt: _ts(r['created_at']),
            updatedAt: _ts(r['updated_at']),
          ),
          mode: InsertMode.insertOrReplace,
        );
      }
    });
    await _mark(table, now);
  }

  // ── Разбор значений ───────────────────────────────────────────────
  // Postgres отдаёт numeric строкой, а не числом — прямой каст падает.

  static double _num(Object? v) => _numOrNull(v) ?? 0;

  static double? _numOrNull(Object? v) => switch (v) {
        null => null,
        final num n => n.toDouble(),
        final String s => double.tryParse(s),
        _ => null,
      };

  static DateTime _ts(Object? v) =>
      _tsOrNull(v) ?? DateTime.fromMillisecondsSinceEpoch(0, isUtc: true);

  static DateTime? _tsOrNull(Object? v) =>
      v is String ? DateTime.tryParse(v)?.toUtc() : null;

  /// Дату оставляем строкой YYYY-MM-DD — см. шапку local_db.dart:
  /// срок годности это календарный день, а не момент времени.
  static String _date(Object? v) => _dateOrNull(v) ?? '';

  static String? _dateOrNull(Object? v) {
    if (v is! String || v.isEmpty) return null;
    return v.length >= 10 ? v.substring(0, 10) : v;
  }
}
