import Link from 'next/link'
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
// Без сессии принимать нечего: `accept_invitation` сверяет почту
// приглашения с почтой вошедшего. Поэтому не вошедшему показываем
// РАЗВИЛКУ, а не редирект на вход.
//
// Почему развилка, а не прежний `redirect('/login?next=…')`: у половины
// приглашённых аккаунта ещё нет. Экран входа отправляет таких на
// регистрацию своей ссылкой «Створити акаунт», и адрес возврата в ней
// теряется — человек регистрируется и оказывается в общем кабинете
// без заведения, решив, что приглашение не сработало. Здесь обе двери
// названы явно и обе несут `next` на этот же адрес: и вход, и регистрация
// после успеха возвращают сюда, уже с сессией. Цена — один лишний клик
// тому, у кого аккаунт есть; потерянное приглашение дороже.
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const next = encodeURIComponent(`/invite/${token}`)

  return (
    <div className="auth-page">
      <div className="auth-topbar">
        <Link href="/" className="brand-topbar">CRESKO</Link>
      </div>
      <div className="mx-auto w-full max-w-lg px-4 py-12">
        {user ? (
          <AcceptClient token={token} email={user.email ?? ''} />
        ) : (
          <div className="card flex flex-col gap-4">
            <h1 className="display t-2xl">Вас запросили в команду</h1>
            <p className="t-md prose-muted">
              Щоб прийняти запрошення, увійдіть тією поштою, на яку прийшов лист.
              Запрошення виписане саме на неї й іншій пошті не спрацює.
            </p>
            <p className="t-sm prose-muted">
              Акаунта ще немає? Створіть його — після підтвердження пошти
              ви повернетесь на цю саму сторінку.
            </p>
            <div className="flex flex-wrap gap-2">
              <Link className="btn-primary" href={`/login?next=${next}`}>Увійти</Link>
              <Link className="btn-secondary" href={`/register?next=${next}`}>Створити акаунт</Link>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
