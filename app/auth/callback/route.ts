import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Обмен кода из письма (вход по ссылке, подтверждение почты,
// восстановление пароля) на сессию.
export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const next = url.searchParams.get('next') ?? '/account'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(new URL(next, url.origin))
    }
  }
  return NextResponse.redirect(new URL('/login', url.origin))
}
