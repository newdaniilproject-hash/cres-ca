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
    }
  | {
      kind: 'journal.cleaning'
      tenantId: string
      taskId: string
      note?: string | null
    }
  | {
      kind: 'journal.sterilization'
      tenantId: string
      device: string
      temperatureC: number
      durationMinutes: number
      indicatorOk: boolean
      note?: string | null
    }
  | {
      kind: 'journal.solution'
      tenantId: string
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
  /** Что показать человеку в списке ожидающих. */
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
    const { error } = await supabase
      .from('material_containers')
      .update({ status: a.status })
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
      p_reference_type: 'offline',
      p_reference_id: null,
      p_receipt_id: null,
      p_count_id: null,
      p_note: a.note ?? null,
      // Тот самый ключ: повтор не спишет второй раз.
      p_idempotency_key: rec.id,
    })
    if (error) throw new Error(error.message)
    return
  }
  if (a.kind === 'journal.cleaning') {
    const { error } = await supabase.from('cleaning_entries').insert({
      tenant_id: a.tenantId,
      task_id: a.taskId,
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
