import type { SupabaseClient } from '@supabase/supabase-js'

// Вход паролем — один путь на веб и на мобильный экран.
//
// CLAUDE.md, «Общий слой вместо паритета»: веб-админка и мобильная не
// пишутся параллельно. Раньше обе формы звали `signInWithPassword` сами,
// и «не забудь продублировать» было единственным, что держало их вместе.
// Теперь обе зовут ЭТУ функцию, а она — серверный роут `/api/auth/sign-in`.
// Зачем роут вообще — написано в его шапке и повторять здесь незачем.
//
// Что делает форма после успеха: `supabase.auth.setSession(res.session)`.
// Куки пишет тот же браузерный клиент, что и раньше, — второго писателя
// хранилища сессии в проекте нет.

/** «Заперто / до какого времени / сколько попыток» — ответ record_failed_login. */
export type SignInLock = {
  locked: boolean
  /** ISO-время снятия замка. `null`, если база его не назвала. */
  until: string | null
  attempts: number
}

export type SignInResult =
  | { ok: true; session: { access_token: string; refresh_token: string } }
  /**
   * `limited` — наш ограничитель частоты, текст уже человеческий и переведён.
   * `locked`  — учётная запись заперта базой на 15 хвилин.
   * `failed`  — всё остальное; `message` это ОТВЕТ СЕРВЕРА по-английски,
   *             и переводит его вызывающий через `humanAuthError`.
   */
  | { ok: false; kind: 'limited' | 'locked' | 'failed'; message: string
      status?: number; lock: SignInLock | null }

export async function signInWithPassword(
  email: string, password: string,
): Promise<SignInResult> {
  let res: Response
  try {
    res = await fetch('/api/auth/sign-in', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim(), password }),
    })
  } catch {
    // Сети нет. Сообщение узнаваемо для `humanAuthError` (offline-ветки
    // у него нет, и заводить её ради одной формы незачем — общий отказ
    // здесь честен: мы действительно не знаем, верен ли пароль).
    return { ok: false, kind: 'failed', message: 'network error', lock: null }
  }

  let body: {
    ok?: boolean
    session?: { access_token?: string; refresh_token?: string }
    error?: string
    status?: number
    limited?: boolean
    lock?: SignInLock | null
  }
  try {
    body = await res.json()
  } catch {
    return { ok: false, kind: 'failed', message: `sign_in ${res.status}`, lock: null }
  }

  if (res.ok && body.ok && body.session?.access_token && body.session?.refresh_token) {
    return {
      ok: true,
      session: {
        access_token: body.session.access_token,
        refresh_token: body.session.refresh_token,
      },
    }
  }

  const lock = body.lock ?? null
  const kind = body.limited ? 'limited' : lock?.locked ? 'locked' : 'failed'
  return {
    ok: false,
    kind,
    message: body.error ?? `sign_in ${res.status}`,
    status: body.status ?? res.status,
    lock,
  }
}

/**
 * Положить сессию туда же, куда её клал прямой вызов Supabase.
 *
 * Отдельной строкой, а не внутри `signInWithPassword`: файл читают и там,
 * где клиента Supabase нет (роут), — тащить его импортом ради двух строк
 * значит тянуть библиотеку в чужой бандл.
 */
export async function applySession(
  supabase: SupabaseClient, session: { access_token: string; refresh_token: string },
): Promise<string | null> {
  const { error } = await supabase.auth.setSession(session)
  return error ? error.message : null
}
