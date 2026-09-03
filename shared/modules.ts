// ── Реестр модулей: чтение. ОБЩИЙ СЛОЙ ──────────────────────────────────────
//
// Источник правды о том, какие модули существуют в продукте, как они
// называются, каким значком рисуются, куда ведут и на каком праве стоят, —
// таблица `public.modules` (миграция 0110). Читают ОБА приложения.
//
// ЧТО ЭТО УБРАЛО ИЗ КОДА. До 0110 те же сведения лежали копиями:
// `MODULE_LABELS`, `DEFAULT_MODULES` и массивы `TABS`/`MENU` в оболочке.
// Завести модуль стоило восьми правок в трёх местах, и любая забытая
// давала не поломку, а МОЛЧАНИЕ: раздел не появлялся, а искали это
// в правах. Мобильное приложение — девятое место, где этот список мог бы
// завестись копией; поэтому оно читает тот же реестр тем же запросом.
//
// ПОЧЕМУ ЗАПРОС, А НЕ КОНСТАНТА. Правило 3 запрещает ходить в базу за
// ПРАВАМИ на пути рендера — права приезжают в токене. Здесь другое:
// реестр не про человека и не про заведение, это девять строк справочника
// продукта, одинаковых для всех.

import type { SupabaseClient } from '@supabase/supabase-js'

export type ModuleRow = {
  code: string
  title: string
  description: string | null
  icon: string | null
  /** Адрес раздела. `null` — у модуля нет своего экрана (витрина, маркетинг). */
  route: string | null
  /** Право, без которого раздел не показывается. `null` — показывать всем. */
  perm: string | null
  inTabs: boolean
  position: number
}

/** Реестр целиком, по порядку. */
export async function fetchModules(sb: SupabaseClient): Promise<ModuleRow[]> {
  const { data } = await sb
    .from('modules')
    .select('code, title, description, icon, route, perm, in_tabs, position')
    .eq('is_active', true)
    .order('position')

  return (data ?? []).map((m) => ({
    code: m.code as string,
    title: m.title as string,
    description: (m.description as string | null) ?? null,
    icon: (m.icon as string | null) ?? null,
    route: (m.route as string | null) ?? null,
    perm: (m.perm as string | null) ?? null,
    inTabs: Boolean(m.in_tabs),
    position: Number(m.position),
  }))
}

/**
 * Адрес раздела в МОБИЛЬНОМ приложении из адреса в реестре.
 *
 * В реестре лежит веб-адрес (`/app/inventory`), потому что реестр старше
 * мобильного приложения и потому что менять его значило бы ломать веб.
 * Берётся последний сегмент: `/app/inventory` → `inventory`.
 *
 * ⚠️ ВТОРОЙ КОЛОНКИ «мобильный адрес» В РЕЕСТРЕ БЫТЬ НЕ ДОЛЖНО. Она
 * разошлась бы с первой ровно так же, как расходились `MODULE_LABELS`
 * с `modules.title`: две записи одного факта, правят одну. Правило
 * «последний сегмент» держится само, пока экран в приложении называется
 * так же, как раздел в вебе, — а называться иначе ему незачем.
 *
 * `null` у модуля без своего экрана (витрина, маркетинг) остаётся `null`:
 * такой модуль в панель не попадает вовсе.
 */
export function mobileRoute(route: string | null): string | null {
  if (!route) return null
  const last = route.split('/').filter(Boolean).pop()
  return last ?? null
}
