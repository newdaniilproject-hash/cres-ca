import { createClient } from '@/lib/supabase/server'
import { PublicHeader, publicT as t } from '@/components/shell'
import { MapView } from './map-view'

export const revalidate = 300
export const metadata = { title: t('public.map.meta.title') }

// Заведения на карте, как у Fresha: точки — продавцы и мастера,
// клик — карточка со ссылкой на витрину.
export default async function MapPage() {
  const supabase = await createClient()
  const [{ data: { user } }, { data: points }] = await Promise.all([
    supabase.auth.getUser(),
    supabase.rpc('map_tenants'),
  ])

  return (
    <div className="flex h-dvh flex-col">
      <PublicHeader authed={!!user} />
      <div className="min-h-0 flex-1">
        <MapView points={points ?? []} />
      </div>
    </div>
  )
}
