import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { AcceptClient } from './accept-client'
import { getT } from '@/lib/i18n/server'

export const dynamic = 'force-dynamic'

// Заголовок вкладки браузера — строка интерфейса, поэтому из словаря.
// Разбор решения — в `app/app/journals/page.tsx`.
export async function generateMetadata() {
  const t = await getT()
  return { title: t('invite.meta.title') }
}

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
  const t = await getT()
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
            <h1 className="display t-2xl">{t('invite.title')}</h1>
            <p className="t-md prose-muted">{t('invite.guest.desc')}</p>
            <p className="t-sm prose-muted">{t('invite.guest.noAccount')}</p>
            <div className="flex flex-wrap gap-2">
              <Link className="btn-primary" href={`/login?next=${next}`}>
                {t('invite.guest.login')}
              </Link>
              <Link className="btn-secondary" href={`/register?next=${next}`}>
                {t('invite.guest.register')}
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
