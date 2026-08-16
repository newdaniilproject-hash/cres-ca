import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { AcceptClient } from './accept-client'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Запрошення' }

// Приём приглашения.
//
// ⚠️ Токен приходит СЕГМЕНТОМ АДРЕСА, а не строкой запроса. Разница
// не косметическая: строка запроса уезжает в заголовок Referer при
// первом же переходе с этой страницы наружу, а сегмент пути — тоже,
// но здесь наружных ссылок нет вовсе, кроме входа на свой же домен.
// Сам секрет в базе не лежит: хранится только его sha256 (0050).
//
// Не вошедшего отправляем на вход с адресом возврата: `accept_invitation`
// сверяет почту приглашения с почтой вошедшего, и без сессии проверять
// нечего. Регистрация по той же ссылке работает так же — после неё
// человек вернётся сюда уже с сессией.
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect(`/login?next=${encodeURIComponent(`/invite/${token}`)}`)

  return (
    <div className="auth-page">
      <div className="auth-topbar">
        <Link href="/" className="brand-topbar">CRESKO</Link>
      </div>
      <div className="mx-auto w-full max-w-lg px-4 py-12">
        <AcceptClient token={token} email={user.email ?? ''} />
      </div>
    </div>
  )
}
