import { Suspense } from 'react'
import { MobileLoginForm } from './login-form'
import { getT } from '@/lib/i18n/server'

// Заголовок вкладки браузера — строка интерфейса, поэтому из словаря.
// Разбор решения — в `app/app/journals/page.tsx`.
export async function generateMetadata() {
  const t = await getT()
  return { title: t('m.login.meta.title') }
}

export default function MobileLoginPage() {
  // useSearchParams требует границы Suspense, иначе сборка Next падает
  // на пререндере. Ловилось на Vercel, локально не видно.
  return (
    <Suspense fallback={null}>
      <MobileLoginForm />
    </Suspense>
  )
}
