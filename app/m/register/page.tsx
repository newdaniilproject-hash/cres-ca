import { MobileRegisterForm } from './register-form'
import { getT } from '@/lib/i18n/server'

// Заголовок вкладки браузера — строка интерфейса, поэтому из словаря.
// Разбор решения — в `app/app/journals/page.tsx`.
export async function generateMetadata() {
  const t = await getT()
  return { title: t('m.register.meta.title') }
}

export default function MobileRegisterPage() {
  return <MobileRegisterForm />
}
