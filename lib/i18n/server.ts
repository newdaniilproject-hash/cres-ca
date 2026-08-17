import { cookies } from 'next/headers'
import type { Lang } from './dict'
import { LANG_COOKIE, resolveLang } from './cookie'
import { createT, type T } from './translate'

// Язык для СЕРВЕРНЫХ компонентов. Отдельный файл, а не общий вход:
// `next/headers` в клиентском бандле не собирается, и один барьер на весь
// каркас дешевле, чем разбор ошибки сборки на чужом экране.
//
// `cookies()` делает страницу динамической. Для кабинета это ничего не
// меняет: каждая его страница и так `force-dynamic` (роль читается из токена
// на каждый запрос). Для витрины — меняет, и поэтому там языка из куки нет
// (см. `lib/i18n/cookie.ts`).

export async function getLang(): Promise<Lang> {
  const store = await cookies()
  return resolveLang(store.get(LANG_COOKIE)?.value)
}

/** Переводчик на сервере: `const t = await getT()`. */
export async function getT(): Promise<T> {
  return createT(await getLang())
}
