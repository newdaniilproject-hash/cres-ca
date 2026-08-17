import { getLang } from '@/lib/i18n/server'
import { LangProvider } from '@/lib/i18n/client'

// Язык кабинета покупателя. Список экрана `/account` собирает сервер
// (`getT()`), а `/account/security` — клиентская форма с `useT()`:
// без провайдера смена пароля и почты оставалась украинской при русском
// интерфейсе, хотя соседний экран уже переключался.
//
// Кэш этим не оплачивается: `/account` и так `force-dynamic` (там заказы
// и записи конкретного человека) и закрыт в `robots.ts`.
export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  return <LangProvider lang={await getLang()}>{children}</LangProvider>
}
