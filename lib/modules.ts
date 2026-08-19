import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'

// ── Реестр модулей: чтение ──────────────────────────────────────────────────
//
// Источник правды о том, какие модули существуют в продукте, как они
// называются, каким значком рисуются, куда ведут и на каком праве стоят, —
// таблица `public.modules` (миграция 0110).
//
// ЧТО ЭТО УБРАЛО ИЗ КОДА. До 0110 те же сведения лежали копиями:
// `MODULE_LABELS` (подписи, захардкоженные по-украински мимо словаря),
// `DEFAULT_MODULES` (копия умолчания из миграции) и массивы `TABS`/`MENU`
// в оболочке. Завести модуль стоило восьми правок в трёх местах сразу,
// и любая забытая давала не поломку, а МОЛЧАНИЕ: раздел не появлялся,
// а искали это в правах.
//
// ПОЧЕМУ ЗАПРОС, А НЕ КОНСТАНТА. Правило 3 запрещает ходить в базу за
// ПРАВАМИ на пути рендера — права приезжают в токене. Здесь другое:
// реестр не про человека и не про заведение, это девять строк справочника
// продукта, одинаковых для всех. Он читается один раз на отрисовку
// кабинета (`cache` из React держит его в пределах запроса) и не зависит
// ни от арендатора, ни от роли.
//
// ЧТО ОСТАЛОСЬ В КОДЕ И ПОЧЕМУ. Значок: `icon` в реестре — это ИМЯ,
// а сами значки живут в `components/icons.tsx` инлайновым SVG (не шрифт
// и не пакет). Имя, которому не нашлось значка, рисуется нейтральным —
// молчаливого пустого места в навигации быть не должно.

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

/**
 * Реестр целиком, по порядку. `cache` — на время одного запроса: макет
 * кабинета и страницы внутри него получат один и тот же массив без
 * повторного похода в базу.
 */
export const listModules = cache(async (): Promise<ModuleRow[]> => {
  const supabase = await createClient()
  const { data } = await supabase
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
