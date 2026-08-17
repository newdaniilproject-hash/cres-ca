import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '@/lib/supabase/config'
import { LANG_COOKIE, resolveLang } from '@/lib/i18n/cookie'
import { checkPath } from '@/lib/ratelimit/check'
import { tooMany } from '@/lib/ratelimit/deny'

// Обновление сессии на каждом запросе — стандартный контур @supabase/ssr.
// Токен с правами (см. Auth Hook) живёт час; middleware продлевает его
// прозрачно, чтобы продавец не вылетал посреди приёмки.
export async function proxy(request: NextRequest) {
  // Ограничение частоты — ПЕРВЫМ действием, до обновления сессии.
  //
  // Порядок не косметический: `supabase.auth.getUser()` ниже — это обращение
  // по сети к Supabase в Ирландии (замер — в `lib/ratelimit/store.ts`).
  // Проверив предел после него, мы платили бы полную цену запроса как раз
  // за те обращения, которые собрались не обслуживать, и ограничитель
  // защищал бы от нагрузки, создавая её.
  //
  // Сама проверка не ходит никуда: счётчики в памяти экземпляра. Причина,
  // почему не в Postgres, и чего это НЕ даёт — в `lib/ratelimit/store.ts`.
  const denial = checkPath(request.headers, request.nextUrl.pathname, request.method)
  if (denial) {
    // Язык берём из той же куки, что и остальной интерфейс. `rsc` в
    // заголовках означает, что Next ждёт не страницу, а полезную нагрузку
    // навигации: страницу отказа туда отдавать нельзя, уходит JSON.
    const lang = resolveLang(request.cookies.get(LANG_COOKIE)?.value)
    const wantsHtml = Boolean(request.headers.get('accept')?.includes('text/html'))
      && !request.headers.get('rsc')
    return tooMany(denial, lang, wantsHtml)
  }

  let response = NextResponse.next({ request })

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        )
      },
    },
  })

  const { data: { user } } = await supabase.auth.getUser()

  const path = request.nextUrl.pathname
  const needsAuth = path.startsWith('/app') || path.startsWith('/account')
  if (needsAuth && !user) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('next', path)
    return NextResponse.redirect(url)
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp)).*)'],
}
