import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '@/lib/supabase/config'
import { LANG_COOKIE, resolveLang } from '@/lib/i18n/cookie'
import { checkPath } from '@/lib/ratelimit/check'
import { tooMany } from '@/lib/ratelimit/deny'

// Сторож входа в кабинет и продление сессии.
//
// Стандартный контур @supabase/ssr обновляет сессию на КАЖДОМ запросе;
// здесь он сужен до защищённых адресов — разбор ниже, у самой проверки.
// Токен с правами (см. Auth Hook) живёт час; продлевается он на первом же
// переходе в кабинет, чтобы продавец не вылетал посреди приёмки.
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

  const path = request.nextUrl.pathname

  // ── СПРАШИВАЕМ Supabase О ПОЛЬЗОВАТЕЛЕ ТОЛЬКО ТАМ, ГДЕ РЕШАЕМ ПО НЕМУ ──
  //
  // `supabase.auth.getUser()` — это не чтение куки, а обращение ПО СЕТИ:
  // сервер Supabase сверяет подпись у себя. Middleware выполняется на КРАЮ
  // сети, рядом с человеком, поэтому его круг до Ирландии самый дорогой
  // во всём переходе.
  //
  // А звался он на КАЖДОМ запросе, который ловит matcher, — то есть и на
  // главной, и на витрине, и на входе, и на регистрации, и на экранах `/m`,
  // и на каждой полезной нагрузке навигации RSC. Результат при этом
  // использовался ровно в одном месте: «пускать ли на /app и /account».
  // На всех остальных адресах мы платили полный круг по сети за значение,
  // которое тут же выбрасывали.
  //
  // Замер владельца 18.08.2026 на `/m/login` — странице, которой не нужны
  // ни данные, ни сессия: TTFB 0,45–0,50 с в прогретом состоянии.
  //
  // Что НЕ изменилось: на `/app` и `/account` вызов остался ровно тем же.
  // Граница входа не сдвинута ни на шаг — сдвинуто только место, где мы
  // за неё платим.
  //
  // Продление сессии тоже не потеряно: его делает тот же `getUser()`, и он
  // случается на первом же защищённом переходе. Человек, который ходит
  // только по витрине, в продлении и не нуждается — за него это делает
  // браузерный клиент Supabase, у него свой таймер.
  const needsAuth = path.startsWith('/app') || path.startsWith('/account')
  if (!needsAuth) return NextResponse.next({ request })

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

  // ── ДЕЙСТВУЮЩИЙ ТОКЕН ПРОПУСКАЕМ БЕЗ СЕТИ ────────────────────────────
  //
  // Отзыв владельца 18.08.2026: «инста быстрее переключается». Разбор
  // показал последнее место, где кабинет платит целый круг по сети ДО того,
  // как начнётся отрисовка страницы, — вот этот `getUser()`. Он стоит на
  // пути КАЖДОГО запроса к `/app`, включая четыре упреждающих запроса,
  // которыми панель греет вкладки: то есть цена платится не один раз,
  // а пять при каждом открытии приложения.
  //
  // Дороже он всего именно здесь: middleware выполняется на краю сети,
  // рядом с человеком, а сервер авторизации — в Ирландии. Страница потом
  // ходит в базу из Дублина, то есть в своём же регионе; этот круг —
  // единственный трансконтинентальный на всём переходе.
  //
  // `getSession()` берёт токен ИЗ КУКИ и никуда не ходит. Если он ещё
  // действует — пропускаем и не спрашиваем никого. Просрочен или его нет —
  // падаем в `getUser()`, как и раньше: он и проверит, и продлит сеанс.
  // Минута запаса нужна, чтобы токен не истёк между этой проверкой
  // и концом отрисовки страницы.
  //
  // ⚠️ ЧЕМ ЭТО ОТЛИЧАЕТСЯ ПО СМЫСЛУ, а не только по скорости. Подпись
  // токена здесь больше не сверяется. Поддельная кука теперь не будет
  // развёрнута на входе — она дойдёт до страницы, и человек увидит ПУСТОЙ
  // кабинет вместо переброса на вход: ни одной строки такой токен
  // не получит, потому что RLS сверяет подпись внутри базы, а `tenant_can`
  // и `tenants_with` разбирают тот же токен уже проверенным.
  //
  // Это не ослабление границы, это её прежнее место. Правило 3 проекта
  // ровно об этом: граница доверия — RLS, а не серверный код; та же
  // причина записана у `currentUserId()` и `isPlatformStaff()`, которые
  // читают токен локально с 17.08.2026. Middleware был и остаётся
  // УДОБСТВОМ — «не показывай кабинет тому, кто не вошёл», — а не замком.
  const { data: { session } } = await supabase.auth.getSession()
  const alive = session != null
    && (session.expires_at ?? 0) * 1000 > Date.now() + 60_000

  if (!alive) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      const url = request.nextUrl.clone()
      url.pathname = '/login'
      url.searchParams.set('next', path)
      return NextResponse.redirect(url)
    }
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp)).*)'],
}
