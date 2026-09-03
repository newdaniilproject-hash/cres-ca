import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { fetchModules, type ModuleRow } from '@/shared/modules'

// ── Реестр модулей: чтение (веб) ────────────────────────────────────────────
//
// ⚠️ САМ ЗАПРОС И ФОРМА СТРОКИ ЖИВУТ В `shared/modules.ts` — их читает
// и мобильное приложение. Здесь остаётся то, что специфично для веба:
// серверный клиент на куках и `cache` из React, который держит реестр
// в пределах одного запроса, чтобы макет кабинета и страницы внутри него
// не ходили в базу дважды.
//
// ЧТО ОСТАЛОСЬ В КОДЕ И ПОЧЕМУ. Значок: `icon` в реестре — это ИМЯ,
// а геометрия значков лежит в `shared/icon-paths.ts` и рисуется каждым
// приложением своими средствами (в вебе — `components/icons.tsx`
// инлайновым SVG, на телефоне — `react-native-svg`). Имя, которому
// не нашлось значка, рисуется нейтральным — молчаливого пустого места
// в навигации быть не должно.

export type { ModuleRow } from '@/shared/modules'

/**
 * Реестр целиком, по порядку. `cache` — на время одного запроса.
 */
export const listModules = cache(async (): Promise<ModuleRow[]> => {
  const supabase = await createClient()
  return fetchModules(supabase)
})

/**
 * Подпись модуля для человека. Пустая строка, если модуля нет в реестре:
 * подставлять сюда код (`inventory`) нельзя — человек прочтёт его как
 * ошибку, а не как название раздела.
 */
export async function moduleTitle(code: string): Promise<string> {
  const rows = await listModules()
  return rows.find((m) => m.code === code)?.title ?? ''
}
