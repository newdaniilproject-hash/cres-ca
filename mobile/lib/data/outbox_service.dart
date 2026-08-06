// Очередь исходящих: как действие мастера доезжает до базы.
//
// Экран НИКОГДА не пишет в Supabase напрямую. Он зовёт метод отсюда,
// действие ложится в локальную очередь и сразу считается сделанным
// для интерфейса. Дальше очередь разбирается сама — при появлении сети,
// при запуске приложения, при возврате его из фона.
//
// Почему так, а не «попробовать сеть, при ошибке сохранить»: во втором
// случае у приложения два разных поведения, и офлайн-путь проверяется
// только когда о нём вспомнят. Здесь путь ровно один, поэтому он
// не может «сломаться незаметно» — он работает всегда.
//
// Три правила слияния, которые делают синхронизацию безопасной. Они
// не изобретены здесь, а уже заложены в базе (проверено 05.08.2026):
//
//  1. Остаток нельзя записать. Только record_stock_movement(...)
//     с ключом идемпотентности. Прямой update блокирует триггер
//     guard_stock_columns.
//  2. Санитарные журналы только добавляются. UPDATE и DELETE запрещены
//     триггером journal_guard — значит конфликта правок не существует
//     по построению.
//  3. Ключ идемпотентности рождается на телефоне в момент нажатия
//     и не меняется при повторах. Обрыв связи после того, как сервер
//     принял операцию, но до ответа — самый частый случай в подвале;
//     повтор с тем же ключом не спишет товар дважды.

import 'dart:async';
import 'dart:convert';
import 'dart:io' show SocketException;

import 'package:drift/drift.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:uuid/uuid.dart';

import 'local_db.dart';

const _uuid = Uuid();

/// Чем закончилась попытка отправить одну операцию.
enum _Verdict {
  /// Доехало.
  ok,

  /// Сети нет или сервер недоступен — операция остаётся в очереди
  /// и уйдёт позже. Это НЕ ошибка мастера, показывать её не нужно.
  retry,

  /// Сервер отверг по существу: нет прав, сторож не пустил, данные
  /// не сходятся. Повторять бессмысленно — надо показать человеку.
  reject,
}

class OutboxService {
  OutboxService(this._db, this._sb);

  final LocalDb _db;
  final SupabaseClient _sb;

  bool _draining = false;

  // ── Постановка в очередь ──────────────────────────────────────────

  /// Общая точка входа. Возвращает ключ идемпотентности — по нему
  /// экран может найти свою запись, если понадобится.
  Future<String> _enqueue({
    required String kind,
    required Map<String, dynamic> payload,
    required String label,
    String? blockKey,
  }) async {
    final key = _uuid.v4();
    await _db.into(_db.outbox).insert(
          OutboxCompanion.insert(
            idempotencyKey: key,
            kind: kind,
            payload: jsonEncode(payload),
            label: label,
            // Время нажатия, а не отправки: в журнал уборки должно
            // попасть, когда мастер реально протёр стол.
            happenedAt: DateTime.now().toUtc(),
            blockKey: Value(blockKey),
          ),
        );
    // Пробуем сразу — если сеть есть, мастер не заметит очереди вовсе.
    unawaited(drain());
    return key;
  }

  /// Сменить статус ёмкости: открыть, закончить, списать.
  /// blockKey — id ёмкости: операции по одной банке идут строго
  /// по порядку, иначе «списать» может обогнать «открыть».
  Future<String> setContainerStatus({
    required String containerId,
    required String code,
    required String status,
    required String label,
  }) =>
      _enqueue(
        kind: 'container.status',
        payload: {'id': containerId, 'status': status, 'code': code},
        label: '$label · $code',
        blockKey: containerId,
      );

  /// Движение по складу. Единственный законный способ изменить остаток.
  Future<String> recordStockMovement({
    required String tenantId,
    required String movementType,
    required double quantity,
    String? materialId,
    String? variantId,
    String? referenceType,
    String? referenceId,
    String? note,
    required String label,
  }) =>
      _enqueue(
        kind: 'stock.movement',
        payload: {
          'p_tenant_id': tenantId,
          'p_movement_type': movementType,
          'p_quantity': quantity,
          'p_material_id': materialId,
          'p_variant_id': variantId,
          'p_reference_type': referenceType,
          'p_reference_id': referenceId,
          'p_note': note,
        },
        label: label,
        blockKey: materialId ?? variantId,
      );

  /// Запись в санитарный журнал. Таблица задаётся вызывающим:
  /// cleaning_logs / solution_logs / sterilization_logs.
  ///
  /// performed_by / prepared_by обязательны в базе — без исполнителя
  /// журнал инспектору не нужен, и вставка упадёт. На этом уже
  /// обожглись в веб-версии: очередь отправляла записи без исполнителя,
  /// и каждая досылка гарантированно падала.
  Future<String> addJournalEntry({
    required String table,
    required Map<String, dynamic> row,
    required String label,
  }) {
    final userId = _sb.auth.currentUser?.id;
    if (userId == null) {
      throw StateError('Немає сесії: запис журналу неможливий');
    }
    return _enqueue(
      kind: 'journal.insert',
      payload: {'table': table, 'row': row, 'user_id': userId},
      label: label,
    );
  }

  // ── Разбор очереди ────────────────────────────────────────────────

  /// Отправить всё, что ждёт. Безопасно звать сколько угодно раз:
  /// повторный вызов во время работы ничего не делает.
  Future<void> drain() async {
    if (_draining) return;
    _draining = true;
    try {
      final pending = await (_db.select(_db.outbox)
            ..where((o) => o.state.equals('pending'))
            // Строго по времени добавления — порядок операций важен.
            ..orderBy([(o) => OrderingTerm(expression: o.id)]))
          .get();

      // Объекты, по которым уже случилась ошибка в этом проходе.
      // Дальнейшие операции по ним пропускаем, чтобы не перепутать
      // порядок: списание не должно уехать раньше открытия.
      final blocked = <String>{};

      for (final item in pending) {
        final bk = item.blockKey;
        if (bk != null && blocked.contains(bk)) continue;

        final verdict = await _send(item);

        switch (verdict) {
          case _Verdict.ok:
            await (_db.update(_db.outbox)..where((o) => o.id.equals(item.id)))
                .write(const OutboxCompanion(state: Value('sent')));
          case _Verdict.retry:
            await (_db.update(_db.outbox)..where((o) => o.id.equals(item.id)))
                .write(OutboxCompanion(attempts: Value(item.attempts + 1)));
            // Сети нет — дальше по очереди идти бессмысленно.
            return;
          case _Verdict.reject:
            await (_db.update(_db.outbox)..where((o) => o.id.equals(item.id)))
                .write(OutboxCompanion(
              state: const Value('failed'),
              attempts: Value(item.attempts + 1),
            ));
            if (bk != null) blocked.add(bk);
        }
      }
    } finally {
      _draining = false;
    }
  }

  Future<_Verdict> _send(OutboxData item) async {
    final payload = jsonDecode(item.payload) as Map<String, dynamic>;
    try {
      switch (item.kind) {
        case 'container.status':
          await _sb
              .from('material_containers')
              .update({'status': payload['status']})
              .eq('id', payload['id'] as String);

        case 'stock.movement':
          await _sb.rpc('record_stock_movement', params: {
            ...payload,
            // Ключ из очереди, а не новый: в этом весь смысл.
            'p_idempotency_key': item.idempotencyKey,
          });

        case 'journal.insert':
          final row = Map<String, dynamic>.from(payload['row'] as Map);
          final userId = payload['user_id'] as String;
          final table = payload['table'] as String;
          // Исполнитель и время нажатия проставляются здесь, а не при
          // отправке: иначе в журнал попадёт момент появления сети.
          row.putIfAbsent(
            table == 'solution_logs' ? 'prepared_by' : 'performed_by',
            () => userId,
          );
          row.putIfAbsent(
            'performed_at',
            () => item.happenedAt.toIso8601String(),
          );
          await _sb.from(table).insert(row);

        default:
          return _Verdict.reject;
      }
      return _Verdict.ok;
    } on PostgrestException catch (e) {
      // Ответ от базы получен — значит сеть есть, а операция не годится.
      // Повторять нечего, надо показать человеку.
      await (_db.update(_db.outbox)..where((o) => o.id.equals(item.id)))
          .write(OutboxCompanion(error: Value(e.message)));
      return _Verdict.reject;
    } catch (e) {
      // Всё остальное считаем сетью. Ошибиться в эту сторону безопасно:
      // операция просто полежит в очереди и уйдёт позже. Ошибиться
      // в другую — потерять запись журнала.
      return _isNetworkError(e) ? _Verdict.retry : _Verdict.reject;
    }
  }

  /// Отличить «нет сети» от «данные не годятся».
  ///
  /// Правило то же, что в веб-версии: сомнение трактуем в пользу
  /// повторной отправки. Лишний повтор безвреден — он идемпотентен;
  /// потерянная запись санитарного журнала безвредной не бывает.
  static bool _isNetworkError(Object e) {
    if (e is SocketException || e is TimeoutException) return true;
    final s = e.toString().toLowerCase();
    return s.contains('socket') ||
        s.contains('failed host lookup') ||
        s.contains('network') ||
        s.contains('connection') ||
        s.contains('timed out') ||
        s.contains('unreachable');
  }
}
