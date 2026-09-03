// ── Санитарные журналы: типы и запросы. ОБЩИЙ СЛОЙ ──────────────────────────
//
// Три журнала Техрегламента №65: дезрастворы, уборка, стерилизация.
// Заполняются каждый день, и ради них «Журнали» стоят в нижней панели —
// это то, между чем мастер прыгает за смену.
//
// ⚠️ ЧИТАТЬ — ТОЛЬКО ЧЕРЕЗ ЭТИ ЗАПРОСЫ, ПИСАТЬ — ТОЛЬКО ФУНКЦИЯМИ БАЗЫ.
// У журналов нет политик UPDATE и DELETE, и сверх того стоит триггер,
// безусловно роняющий любую попытку правки. Это не перестраховка:
// журнал, который можно переписать задним числом, не имеет доказательной
// силы на проверке, ради которой он и ведётся.
//
// Список задач уборки и отметки за СЕГОДНЯ приходят отдельно, а не одной
// выборкой с join: задачи — справочник заведения (их десяток и они
// меняются раз в год), отметки — сегодняшние строки журнала. Свести их
// в одну поездку значит перечитывать справочник при каждом обновлении
// экрана.

import type { SupabaseClient } from '@supabase/supabase-js'

export type SolutionRow = {
  id: string
  agent_name: string
  registration: string | null
  concentration: string | null
  volume: number | null
  unit: string | null
  prepared_at: string
  expires_at: string | null
}

export type CleaningTask = {
  id: string
  name: string
  schedule: string | null
}

export type CleaningEntry = {
  task_id: string
  performed_at: string
}

export type SterilizationRow = {
  id: string
  device: string | null
  temperature_c: number | null
  duration_minutes: number | null
  indicator_ok: boolean | null
  performed_at: string
}

export type JournalsOverview = {
  solutions: SolutionRow[]
  tasks: CleaningTask[]
  /** Отметки об уборке за сегодня. Пусто — значит за сегодня не убирали. */
  doneToday: CleaningEntry[]
  cycles: SterilizationRow[]
}

/**
 * Начало сегодняшнего дня в ЛОКАЛЬНОМ времени устройства.
 *
 * Именно локальное, а не UTC: «убрано сегодня» для мастера — это его
 * сегодня. В Украине летом разница с UTC три часа, и по UTC уборка,
 * сделанная в 01:30 ночи, попала бы во вчерашний день.
 */
function startOfToday(): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

export async function fetchJournals(
  sb: SupabaseClient,
  tenantId: string,
): Promise<JournalsOverview> {
  const [solutions, tasks, done, cycles] = await Promise.all([
    sb.from('sanitation_solutions')
      .select('id, agent_name, registration, concentration, volume, unit, prepared_at, expires_at')
      .eq('tenant_id', tenantId)
      .order('prepared_at', { ascending: false })
      .limit(30),
    sb.from('cleaning_tasks')
      .select('id, name, schedule')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .order('position'),
    sb.from('cleaning_entries')
      .select('task_id, performed_at')
      .eq('tenant_id', tenantId)
      .gte('performed_at', startOfToday()),
    sb.from('sterilization_cycles')
      .select('id, device, temperature_c, duration_minutes, indicator_ok, performed_at')
      .eq('tenant_id', tenantId)
      .order('performed_at', { ascending: false })
      .limit(30),
  ])

  return {
    solutions: (solutions.data ?? []) as SolutionRow[],
    tasks: (tasks.data ?? []) as CleaningTask[],
    doneToday: (done.data ?? []) as CleaningEntry[],
    cycles: (cycles.data ?? []) as SterilizationRow[],
  }
}
