import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import { getT } from '@/lib/i18n/server'
import { SellerWizard, type Speciality } from './wizard'

export const dynamic = 'force-dynamic'

export async function generateMetadata() {
  const t = await getT()
  return { title: t('reg.role.title') }
}

// Регистрация продавца. Серверная половина делает ровно одно: приносит
// справочник специальностей.
//
// Почему справочник грузится ЗДЕСЬ, а не запросом из формы. Он нужен на
// двух шагах из семи, и запрос из браузера дал бы пустые списки на первую
// секунду каждого — в момент, когда человек уже смотрит на экран выбора.
// Таблица `specialities` открыта анониму политикой `specialities_read`
// (`is_active`), то есть ещё не зарегистрированный человек её видит.
//
// Адрес возврата принимается только внутренним путём с одним ведущим
// слэшем: `//evil.com` — это чужой сайт, а не путь, и без проверки форма
// становится открытым перенаправлением.
export default async function SellerRegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const sp = await searchParams
  const raw = sp.next
  const next = raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/app'

  const supabase = await createClient()
  const { data } = await supabase
    .from('specialities')
    .select('id, name, kind')
    .eq('is_active', true)
    .order('position')

  return (
    <Suspense>
      <SellerWizard specialities={(data ?? []) as Speciality[]} next={next} />
    </Suspense>
  )
}
