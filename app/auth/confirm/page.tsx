import { getLang, getT } from '@/lib/i18n/server'
import { LangProvider } from '@/lib/i18n/client'
import { AuthShell } from '../../(auth)/auth-shell'
import { SuccessScreen } from '@/components/auth-ui'

// Куда приземляются ссылки подтверждения смены почты — ОБЕ, со старого
// и с нового адреса. Раньше `emailRedirectTo` не задавался вовсе, человек
// падал на корень сайта и не понимал, закончил он процедуру или нет:
// GoTrue меняет почту только после подтверждения ОБОИХ писем, и об этом
// надо сказать словами ровно в момент перехода.
//
// Серверный компонент без единого запроса к базе: сессии тут может
// не быть вовсе (ссылку открыли в другом браузере), и страница обязана
// отработать анониму. Обе кнопки — просто ссылки: «До кабінету» проверит
// вход сам, «Увійти» — для тех, кто открыл письмо там, где сессии нет.
//
// Язык — тем же способом, что и у экранов входа (`app/(auth)/layout.tsx`):
// кука читается на сервере, провайдер отдаёт словарь клиентским
// компонентам раскладки в первом же кадре.
export async function generateMetadata() {
  const t = await getT()
  return { title: t('auth.confirm.title') }
}

export default async function AuthConfirmPage() {
  const t = await getT()
  return (
    <LangProvider lang={await getLang()}>
      <AuthShell>
        <SuccessScreen
          title={t('auth.confirm.title')}
          subtitle={t('auth.confirm.lead')}
          actionLabel={t('auth.confirm.toApp')}
          actionHref="/app"
          secondaryLabel={t('auth.confirm.toLogin')}
          secondaryHref="/login"
        />
      </AuthShell>
    </LangProvider>
  )
}
