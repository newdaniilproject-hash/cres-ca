import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Обмен кода на сессию: письма (вход по ссылке, подтверждение почты,
// восстановление пароля) и возврат от внешнего провайдера (Google).
// Провайдер отдаёт отказ теми же query-параметрами (error, error_description),
// поэтому разбор ошибки живёт здесь, а понятный текст собирает /login.
export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const next = safeNext(url.searchParams.get('next'))
  const denied = url.searchParams.get('error_description') ?? url.searchParams.get('error')

  if (denied) return toLogin(url, denied)

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(new URL(next, url.origin))
    }
    return toLogin(url, error.message)
  }

  return toLogin(url, null)
}

// Только внутренний путь: «//evil.com» и абсолютный адрес new URL() принял бы
// как чужой origin — это открытый редирект прямо на странице входа.
function safeNext(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/account'
  return value
}

function toLogin(url: URL, reason: string | null) {
  const target = new URL('/login', url.origin)
  if (reason) target.searchParams.set('error', reason)
  return NextResponse.redirect(target)
}
