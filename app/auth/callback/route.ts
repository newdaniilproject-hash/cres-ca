import { NextResponse } from 'next/server'

// Возврат от Apple и Google.
//
// Обмен кода на сессию делает НЕ этот роут, а `/auth/finish` на клиенте:
// PKCE-верификатор Supabase кладёт в куки браузера при нажатии кнопки,
// и код, обменянный где-то ещё, просто не сойдётся.
//
// Раньше здесь была вторая ветка — `native=1`, — которая отдавала код
// обратно в приложение ссылкой схемы `cresca://`. Она была нужна, пока
// приложение было обёрткой вокруг этого сайта: страницу открывал
// системный браузер, кук веб-вью он не видел, и завершить вход на месте
// было нельзя. Обёртки больше нет (CLAUDE.md → «Мобильная версия»),
// приложение на Flutter ведёт свой вход, поэтому ветка удалена по
// правилу 8 вместе со страницей-пересадкой.
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const err =
    url.searchParams.get('error_description') ??
    url.searchParams.get('error') ??
    null
  const next = url.searchParams.get('next') || ''

  const finish = new URL('/auth/finish', url.origin)
  if (code) finish.searchParams.set('code', code)
  if (err) finish.searchParams.set('error', err)
  if (next) finish.searchParams.set('next', next)
  return NextResponse.redirect(finish)
}
