import { getLang } from '@/lib/i18n/server'
import { LangProvider } from '@/lib/i18n/client'

// Язык раздела приглашений. Причина та же, что у `(auth)`: страница
// приглашения серверная и зовёт `getT()`, а её кнопки живут в клиентском
// `accept-client.tsx` с `useT()` — без провайдера половина экрана
// переключалась, а половина нет.
//
// Динамическим сегмент делает не эта строка: `/invite/<токен>` и так
// `force-dynamic` — приглашение проверяется на каждый запрос.
export default async function InviteLayout({ children }: { children: React.ReactNode }) {
  return <LangProvider lang={await getLang()}>{children}</LangProvider>
}
