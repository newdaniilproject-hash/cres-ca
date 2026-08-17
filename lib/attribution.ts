// Атрибуция на стороне браузера: «откуда пришёл этот покупатель».
//
// Живёт в `localStorage`, а не в куке: cookie логичнее для серверного
// чтения, но здесь источник читает только браузер — сам `create_order`/
// `create_booking` вызывается из клиента (0105 добавляет туда три
// параметра, а не читает заголовки запроса). Второго пути к данным
// не заводим.
//
// Значение НИКОГДА не валидируется здесь строго: сервер (`attribution_resolve`,
// 0105) не бросает исключений ни на что — та же философия и в клиенте:
// испорченное значение просто не сохранится значимым образом, но не уронит
// ничего. Единственная защита — окно 30 дней и предел числа записей,
// чтобы `localStorage` не пух до бесконечности у человека, зашедшего
// на десятки витрин.
const KEY = 'cres_attr'
const WINDOW_DAYS = 30
const MAX_ENTRIES = 20

type Stored = { source: string; label: string | null; at: number }
type Store = Record<string, Stored>

function readStore(): Store {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Store) : {}
  } catch {
    return {}
  }
}

function prune(store: Store): Store {
  const cutoff = Date.now() - WINDOW_DAYS * 864e5
  const fresh = Object.fromEntries(
    Object.entries(store).filter(([, v]) => v.at >= cutoff),
  )
  const entries = Object.entries(fresh).sort((a, b) => b[1].at - a[1].at)
  return Object.fromEntries(entries.slice(0, MAX_ENTRIES))
}

/**
 * Запомнить переход по ссылке для заведения. Последний переход побеждает —
 * повторный вызов для того же `tenantId` просто перезаписывает запись.
 * `from` пустой или отсутствует — ничего не делает.
 */
export function captureAttribution(tenantId: string, from: string | null | undefined) {
  if (typeof window === 'undefined' || !from) return
  try {
    const store = prune(readStore())
    store[tenantId] = { source: from, label: null, at: Date.now() }
    window.localStorage.setItem(KEY, JSON.stringify(store))
  } catch {
    // localStorage бывает недоступен (приватный режим, квота) — атрибуция
    // не тот случай, ради которого стоит показывать ошибку человеку.
  }
}

/** Атрибуция для заведения, если она есть и не старше 30 дней. */
export function readAttribution(tenantId: string): {
  source: string; label: string | null; at: string
} | null {
  const entry = prune(readStore())[tenantId]
  if (!entry) return null
  return { source: entry.source, label: entry.label, at: new Date(entry.at).toISOString() }
}
