import { client, type HeaderBag } from './address'
import { LIMITS, scopesFor, type Scope } from './rules'
import { hit } from './store'
import { maskIp } from '@/lib/redact'

// Сама проверка. Два входа: по пути запроса (для `proxy.ts`) и по названному
// смыслу (для серверных действий из `guard.ts`).

export type Denial = {
  scope: Scope
  /** Секунды до конца окна. Уходит в заголовок `Retry-After`. */
  retryAfter: number
}

/**
 * Что серверное действие отвечает форме. Тип живёт здесь, а не рядом
 * с действиями: модуль с `'use server'` отдаёт наружу только функции,
 * и тип из него импортировать неоткуда.
 */
export type GuardResult =
  | { ok: true }
  | { ok: false; retryAfter: number; message: string }

// ── Недоступность хранилища ────────────────────────────────────────────────
//
// Требование шага: «недоступно — пропускаем и пишем предупреждение, а не
// отказываем всем». Хранилище здесь — память, отказать она может разве что
// нехваткой места (это разобрано в `store.ts` и тоже кончается пропуском).
// Но проверка адреса разбирает заголовки, а заголовки приходят снаружи,
// и правило одно: ЛЮБАЯ неожиданность внутри ограничителя означает
// «пропустить и написать в журнал». Ограничитель, который роняет сайт,
// когда сам сломался, вреднее отсутствующего: отказ получают все, включая
// продавца, который в этот момент стоит на складе.
function guarded(run: () => Denial | null): Denial | null {
  try {
    return run()
  } catch (e) {
    console.warn('[ratelimit] проверка не выполнена, запрос пропущен:',
      e instanceof Error ? e.message : String(e))
    return null
  }
}

// Ключ ведра. Смысл в ключе обязателен: без него «вход» и «поиск» с одного
// адреса делили бы один счётчик и первый же поиск съедал бы попытки входа.
const bucketKey = (scope: Scope, addr: string) => `${scope}|${addr}`

function consume(h: HeaderBag, scopes: Scope[]): Denial | null {
  if (scopes.length === 0) return null

  const who = client(h)
  // Адрес не определён — пропускаем. Почему не общий счётчик «неизвестные»:
  // см. `address.ts`.
  if (!who) return null

  let denial: Denial | null = null

  // Тратятся ВСЕ ведра, даже если одно уже отказало. Иначе отказ по узкому
  // пределу становился бы бесплатным по широкому, и перебор пароля не
  // приближал бы отключение по «любому пути» вовсе.
  for (const scope of scopes) {
    const r = hit(bucketKey(scope, who.key), LIMITS[scope])
    if (!r.ok && !denial) {
      denial = { scope, retryAfter: Math.max(1, Math.ceil(r.retryAfterMs / 1000)) }
    }
  }

  if (denial) note(denial, who.key, who.via)

  return denial
}

// Отказ пишется в журнал — иначе про сработавший предел мы узнаём только
// от человека, которому он помешал. `via` здесь главное: если на бою в нём
// стоит `edge`, значит адрес человека до нас не доходит и все посетители
// считаются вместе (см. `address.ts`).
//
// НЕ чаще раза в 10 секунд на смысл: отказ приходит на КАЖДЫЙ запрос сверх
// предела, и полный журнал — это тысячи одинаковых строк за минуту, в которых
// тонет всё остальное. Одной строки достаточно, чтобы увидеть, что предел
// сработал и по какому адресу.
const NOTE_EVERY_MS = 10_000
const noted = new Map<Scope, number>()

function note(denial: Denial, key: string, via: string): void {
  const now = Date.now()
  const at = noted.get(denial.scope)
  if (at !== undefined && now - at < NOTE_EVERY_MS) return
  noted.set(denial.scope, now)
  // Журнал — для того, кто чинит, а не для посетителя: он по-русски,
  // как и остальные служебные записи проекта.
  // Адрес — персональные данные, а журнал хостинга живёт вне нашего
  // контроля и без срока хранения (правило приёмки 14). Обрезанного
  // адреса хватает, чтобы отличить перебор из одной сети от разрозненных
  // попыток, и не хватает, чтобы указать на человека. Полный адрес
  // остаётся там, где он и есть событие, — в `security_events` (0085).
  console.warn(
    `[ratelimit] отказ: ${denial.scope}, ещё ${denial.retryAfter} с,`
    + ` адрес ${maskIp(key) ?? '—'} (${via})`,
  )
}

/** Признак серверного действия Next: POST на адрес самой страницы. */
export function isServerAction(h: HeaderBag): boolean {
  return Boolean(h.get('next-action'))
}

/** Проверка по пути — вход для `proxy.ts`. */
export function checkPath(h: HeaderBag, path: string, method: string): Denial | null {
  return guarded(() => consume(h, scopesFor(path, method, isServerAction(h))))
}

/** Проверка по названному смыслу — вход для серверных действий. */
export function checkScope(h: HeaderBag, scope: Scope): Denial | null {
  return guarded(() => consume(h, [scope]))
}
