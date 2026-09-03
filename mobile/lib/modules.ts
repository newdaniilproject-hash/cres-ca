// Реестр модулей на телефоне.
//
// Запрос и форма строки — в `shared/modules.ts`, общие с вебом. Здесь
// только хранение на время жизни экрана и правило, по которому раздел
// попадает в нижнюю панель.
//
// Реестр читается ОДИН раз за запуск и кладётся в кеш модуля: это девять
// строк справочника продукта, одинаковых для всех, и перечитывать их при
// каждом переключении вкладки незачем. Обновится он при следующем запуске
// приложения — для справочника, который меняется вместе с выкатом новой
// функции, этого достаточно.

import { useEffect, useState } from 'react'
import { can, hasModule, type Membership } from '../../shared/access'
import { fetchModules, mobileRoute, type ModuleRow } from '../../shared/modules'
import { supabase } from './supabase'

let cached: ModuleRow[] | null = null

export function useModules(): ModuleRow[] | null {
  const [rows, setRows] = useState<ModuleRow[] | null>(cached)

  useEffect(() => {
    if (cached) return
    let alive = true
    fetchModules(supabase)
      .then((r) => { cached = r; if (alive) setRows(r) })
      .catch(() => { if (alive) setRows([]) })
    return () => { alive = false }
  }, [])

  return rows
}

/**
 * Виден ли раздел этому человеку. ОБЕ оси, как и в вебе: право сотрудника
 * и модуль заведения.
 *
 * ⚠️ Это только РАСКЛАДКА. Граница доступа — RLS и проверки на самих
 * экранах; панель, спрятавшая пункт, не мешает открыть его по глубокой
 * ссылке, и именно поэтому обе проверки стоят ещё и на странице.
 */
export function moduleVisible(m: Membership | null, row: ModuleRow): boolean {
  if (!mobileRoute(row.route)) return false
  if (row.perm && !can(m, row.perm)) return false
  return hasModule(m, row.code)
}

/** Строка реестра по адресу экрана: `inventory` → её модуль. */
export function moduleByRoute(rows: ModuleRow[] | null, route: string): ModuleRow | null {
  return rows?.find((r) => mobileRoute(r.route) === route) ?? null
}
