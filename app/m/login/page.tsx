import { Suspense } from 'react'
import { MobileLoginForm } from './login-form'

export const metadata = { title: 'Вхід' }

export default function MobileLoginPage() {
  // useSearchParams требует границы Suspense, иначе сборка Next падает
  // на пререндере. Ловилось на Vercel, локально не видно.
  return (
    <Suspense fallback={null}>
      <MobileLoginForm />
    </Suspense>
  )
}
