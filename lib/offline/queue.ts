'use client'

import type { SupabaseClient } from '@supabase/supabase-js'

// Очередь действий на время без сети.
//
// Зачем вообще. Салон в подвале, склад за железной дверью, телефон
// показывает одну палку — и это не редкий случай, а обычный рабочий день
// мастера. ТЗ прямо требует офлайн-режим с последующей синхронизацией.
// Без очереди мастер нажимает «Відкрити банку», видит ошибку и не знает,
// записалось оно или нет. Непонятное состояние здесь дороже, чем
// потерянное действие: в журнале появится дыра, а её потом покажут
// проверяющему.
//
// Почему это безопасно. Списание остатка проходит через
// record_stock_movement, у которой есть ключ идемпотентности: повтор
// того же ключа не спишет товар дважды. Ключ генерируется здесь,
// в момент нажатия кнопки, и хранится вместе с действием — поэтому
// сколько бы раз ни повторилась отправка, движение будет одно.
//
// Чего очередь НЕ делает: не откладывает то, что требует ответа сервера
// прямо сейчас (сканирование, поиск, отчёты). Такие действия честно
// говорят «немає мережі», а не делают вид, что сработали.

const DB_NAME = 'cres-offline'
const DB_VERSION = 1
const STORE = 'queue'

export type QueuedAction =
  | {
      kind: 'container.status'
      containerId: string
      status: 'opened' | 'finished' | 'disposed'
    }
  | {
      kind: 'stock.movement'
      tenantId: string
      movementType: string
      quantity: number
      materialId?: string | null
      variantId?: string | null
      note?: string | null
      /**
       * Ключ, СГЕНЕРИРОВАННЫЙ ЭКРАНОМ до первой попытки отправки.
       *
       * Без него офлайн-путь ломает ровно ту гарантию, ради которой
       * очередь существует. Сеть рвётся и ПОСЛЕ того, как база записала
       * движение: транзакция прошла, ответ не доехал. Экран видит
       * «ошибку сети», кладёт действие в очередь — и если ключ здесь
       * новый, досылка спишет остаток второй раз. Тот же ключ, что
       * ушёл в неудавшемся вызове, делает повтор безвредным.
       */
      idempotencyKey?: string
      /** Откуда пришло движение. По умолчанию 'offline'. */
      referenceType?: string
    }
  | {
      // Факт с полки в документе инвентаризации. Пересчёт ведут в том
      // самом подвале, где сети нет, и потерянная строка означает поход
      // к полке заново. Повтор безвреден: это не движение, а одно поле,
      // и последняя запись побеждает.
      kind: 'count.line'
      lineId: string
      countedQty: number | null
    }
  | {
      /**
       * Розлив из большой ёмкости в рабочий дозатор (ТЗ, 3.2).
       *
       * ⚠️ КЛЮЧ ЗДЕСЬ ОБЯЗАТЕЛЕН, И ЭТО НЕ ПЕРЕСТРАХОВКА. Розлив не просто
       * уменьшает объём родителя — он ЗАВОДИТ НОВУЮ ЁМКОСТЬ со своим кодом,
       * сроком и наклейкой. Сеть рвётся и после того, как база записала
       * действие; без ключа досылка отлила бы второй раз, и в реестре
       * соответствия появилась бы банка, которой нет на полке. Ключ
       * генерирует ЭКРАН до первой попытки — тот же самый уезжает сюда
       * (0100 хранит его в material_containers.idempotency_key).
       */
      kind: 'container.decant'
      parentId: string
      volume: number
      note?: string | null
      idempotencyKey: string
    }
  | {
      kind: 'journal.cleaning'
      tenantId: string
      taskId: string
      // Кто выполнил. В колонке performed_by стоит NOT NULL без
      // default — без этого поля досылка падала бы на каждой записи.
      userId: string
      note?: string | null
    }
  | {
      kind: 'journal.sterilization'
      tenantId: string
      userId: string
      device: string
      temperatureC: number
      durationMinutes: number
      indicatorOk: boolean
      note?: string | null
    }
  | {
      kind: 'journal.solution'
      tenantId: string
      userId: string
      agentName: string
      registration?: string | null
      concentration?: string | null
      volume?: number | null
      unit?: string | null
      expiresAt?: string | null
    }

export type QueuedRecord = {
  id: string
  at: number
  tries: number
  lastError: string | null
  /**
   * Что показать человеку в списке ожидающих.
   *
   * ── ЭТО СНИМОК МОМЕНТА, И ЭТО РЕШЕНО, А НЕ ЗАБЫТО (16.08.2026) ──────────
   *
   * Подпись собирает ЭКРАН в момент нажатия и кладёт сюда уже готовой
   * строкой. Значит отметка, поставленная при русском интерфейсе,
   * останется русской и после переключения на украинский. Второй вариант —
   * хранить ключ словаря и подстановки, а собирать подпись при отрисовке —
   * рассмотрен и отклонён по трём причинам.
   *
   * 1. Запись переживает словарь. Она лежит в IndexedDB на телефоне
   *    мастера и ждёт связи сколько угодно — а ключ, на который она бы
   *    ссылалась, живёт в `uk.json` и переименовывается при первой же
   *    переделке экрана (ключ называет смысл, но смысл тоже правят).
   *    Ссылка из ПОСТОЯННОГО хранилища в файл, который меняется каждый
   *    выпуск, — это внешний ключ без миграции: после обновления мастер
   *    увидит в очереди `inventory.count.queue.fact` вместо текста.
   *    Снимок самодостаточен и переживает любую правку словаря.
   *
   * 2. Половина подписи всё равно не переводится. В ней имя засоба, код
   *    банки, название прибора, имя строки пересчёта — это данные
   *    арендатора. «Перевод» подписи дал бы «Відкрити банку · БАНКА-17»
   *    вместо «Открыть банку · БАНКА-17», то есть сменил бы язык двух
   *    слов из четырёх.
   *
   * 3. Цена. `flush` собирает из подписи текст отказа (`errors`), а он
   *    уходит в уведомление; с ключом вместо строки этому модулю
   *    понадобился бы переводчик, то есть язык — и очередь, сегодня
   *    свободная и от React, и от словаря, стала бы зависеть от обоих.
   *
   * Что здесь ВАЖНО и что не должно измениться: подпись — только для
   * глаз. Ни одно решение — ни повтор, ни сверка, ни разбор ошибки —
   * на неё не смотрит; смотрят на `action`, где лежат значения, а не
   * текст. Пока это так, устаревший язык подписи стоит ровно столько,
   * сколько строчка в списке ожидающих, и не больше.
   */
  label: string
  action: QueuedAction
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode)
        const req = run(t.objectStore(STORE))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
        t.oncomplete = () => db.close()
      }),
  )
}

function newId(): string {
  // crypto.randomUUID есть везде, где есть service worker, но на старых
  // сборках WebView его может не быть — тогда обычный случайный ключ.
  const c = globalThis.crypto as Crypto | undefined
  if (c && 'randomUUID' in c) return c.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Ключ повтора для действия, которое экран собирается отправить.
 *
 * ⚠️ ЗОВЁТСЯ ДО ПЕРВОЙ ПОПЫТКИ, А НЕ В ОБРАБОТЧИКЕ ОШИБКИ. В этом весь
 * смысл: сеть рвётся и ПОСЛЕ того, как база записала действие — транзакция
 * прошла, ответ не доехал. Ключ, придуманный в момент досылки, был бы
 * новым, и повтор выполнился бы вторым разом.
 *
 * Живёт здесь, а не на экранах, чтобы у правила было одно место:
 * `crypto.randomUUID` есть не в каждом веб-вью, и запасной путь не должен
 * переписываться заново в каждой кнопке.
 */
export function newKey(): string {
  return newId()
}

// «Это сеть упала или я сделал что-то не то?» — вопрос, от которого
// зависит всё поведение кнопки. Ошибка сети → действие в очередь,
// человек работает дальше. Ошибка данных → показать текст и НЕ прятать
// в очередь: она не отправится никогда и застрянет там навечно.
//
// navigator.onLine ловит явный офлайн, тексты — случай «wifi есть,
// интернета нет»: Chrome говорит "Failed to fetch", Safari — "Load
// failed", остальное — вариации со словом network.
export function isNetworkError(e: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true
  const m = e instanceof Error ? e.message : String(e ?? '')
  return /failed to fetch|load failed|network|fetch failed|ERR_INTERNET|ERR_NETWORK/i.test(m)
}

export async function enqueue(label: string, action: QueuedAction): Promise<QueuedRecord> {
  const record: QueuedRecord = {
    id: newId(),
    at: Date.now(),
    tries: 0,
    lastError: null,
    label,
    action,
  }
  await tx('readwrite', (s) => s.add(record))
  notify()
  return record
}

export async function list(): Promise<QueuedRecord[]> {
  const all = await tx<QueuedRecord[]>('readonly', (s) => s.getAll() as IDBRequest<QueuedRecord[]>)
  return all.sort((a, b) => a.at - b.at)
}

export async function drop(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id) as unknown as IDBRequest<undefined>)
  notify()
}

async function update(record: QueuedRecord): Promise<void> {
  await tx('readwrite', (s) => s.put(record))
  notify()
}

// Подписка на изменения очереди: значок «чекають надсилання» должен
// обновляться сам, без перезагрузки страницы.
const EVENT = 'cres:offline-queue'
export function notify() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT))
}
export function onQueueChange(fn: () => void): () => void {
  window.addEventListener(EVENT, fn)
  return () => window.removeEventListener(EVENT, fn)
}

/** Отправка одного отложенного действия. Бросает — значит не удалось. */
async function send(supabase: SupabaseClient, rec: QueuedRecord): Promise<void> {
  const a = rec.action
  if (a.kind === 'container.status') {
    const update: Record<string, unknown> = { status: a.status }
    // Дата вскрытия — момент нажатия кнопки, а не момент, когда
    // очередь наконец доехала до сервера. containers_guard()
    // на сервере принимает переданное значение как есть и не
    // трогает его, если оно уже задано (0014_compliance.sql) —
    // не передать его значит однажды посчитать use_by от даты
    // разбора очереди, а не от даты фактического вскрытия.
    if (a.status === 'opened') {
      update.opened_at = new Date(rec.at).toISOString()
    }
    const { error } = await supabase
      .from('material_containers')
      .update(update)
      .eq('id', a.containerId)
    if (error) throw new Error(error.message)
    return
  }
  if (a.kind === 'stock.movement') {
    const { error } = await supabase.rpc('record_stock_movement', {
      p_tenant_id: a.tenantId,
      p_movement_type: a.movementType,
      p_quantity: a.quantity,
      p_variant_id: a.variantId ?? null,
      p_material_id: a.materialId ?? null,
      p_reference_type: a.referenceType ?? 'offline',
      p_reference_id: null,
      p_receipt_id: null,
      p_count_id: null,
      p_note: a.note ?? null,
      // Тот самый ключ: повтор не спишет второй раз. Берём ключ экрана,
      // если он есть — см. комментарий у поля idempotencyKey.
      p_idempotency_key: a.idempotencyKey ?? rec.id,
    })
    if (error) throw new Error(error.message)
    return
  }
  if (a.kind === 'container.decant') {
    // Наклейку досылка НЕ печатает и печатать не должна: код ёмкости
    // выдаёт счётчик базы, а человек в этот момент уже занят другим.
    // Наклейка берётся с экрана списка розливов, когда она понадобится.
    const { error } = await supabase.rpc('decant_container', {
      p_parent_id: a.parentId,
      p_volume: a.volume,
      p_note: a.note ?? null,
      p_idempotency_key: a.idempotencyKey,
    })
    if (error) throw new Error(error.message)
    return
  }
  if (a.kind === 'count.line') {
    const { error } = await supabase.from('stock_count_lines')
      .update({ counted_qty: a.countedQty }).eq('id', a.lineId)
    if (error) throw new Error(error.message)
    return
  }
  if (a.kind === 'journal.cleaning') {
    const { error } = await supabase.from('cleaning_entries').insert({
      tenant_id: a.tenantId,
      task_id: a.taskId,
      performed_by: a.userId,
      note: a.note ?? null,
      // Время выполнения — когда мастер нажал кнопку, а не когда
      // появилась сеть. Иначе журнал врёт проверяющему.
      performed_at: new Date(rec.at).toISOString(),
    })
    if (error) throw new Error(error.message)
    return
  }
  if (a.kind === 'journal.sterilization') {
    const { error } = await supabase.from('sterilization_cycles').insert({
      tenant_id: a.tenantId,
      performed_by: a.userId,
      device: a.device,
      temperature_c: a.temperatureC,
      duration_minutes: a.durationMinutes,
      indicator_ok: a.indicatorOk,
      note: a.note ?? null,
      performed_at: new Date(rec.at).toISOString(),
    })
    if (error) throw new Error(error.message)
    return
  }
  if (a.kind === 'journal.solution') {
    const { error } = await supabase.from('sanitation_solutions').insert({
      tenant_id: a.tenantId,
      prepared_by: a.userId,
      agent_name: a.agentName,
      registration: a.registration ?? null,
      concentration: a.concentration ?? null,
      volume: a.volume ?? null,
      unit: a.unit ?? null,
      expires_at: a.expiresAt ?? null,
      prepared_at: new Date(rec.at).toISOString(),
    })
    if (error) throw new Error(error.message)
    return
  }
  // Строка украинская и из словаря НЕ берётся — по той же причине, что
  // и подпись выше: этот модуль не знает языка и знать не должен. Сюда
  // попадает только запись, положенную версией НОВЕЕ установленной
  // (человек обновил вкладку, а на телефоне остался старый бандл), —
  // то есть отказ, которого в норме не бывает.
  throw new Error('невідома дія в черзі')
}

export type FlushResult = { sent: number; failed: number; errors: string[] }

/**
 * Пытается отправить всё отложенное. Вызывается при появлении сети,
 * при открытии вкладки и по кнопке «Надіслати зараз».
 */
export async function flush(supabase: SupabaseClient): Promise<FlushResult> {
  const items = await list()
  let sent = 0
  let failed = 0
  const errors: string[] = []

  for (const rec of items) {
    try {
      await send(supabase, rec)
      await drop(rec.id)
      sent++
    } catch (e) {
      failed++
      const message = e instanceof Error ? e.message : String(e)
      errors.push(`${rec.label}: ${message}`)
      await update({ ...rec, tries: rec.tries + 1, lastError: message })
      // Дальше не останавливаемся: одно испорченное действие не должно
      // держать очередь. Мастер увидит его отдельно и решит, что делать.
    }
  }
  return { sent, failed, errors }
}
