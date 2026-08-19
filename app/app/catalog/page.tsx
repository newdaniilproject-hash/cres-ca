import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { currentMembership, can, hasModule } from '@/lib/tenant'
import { ModuleOff } from '@/components/module-gate'
import { AppShell } from '@/components/shell'
import { CatalogClient } from './catalog-client'
import { getT } from '@/lib/i18n/server'

export const dynamic = 'force-dynamic'

// Заголовок вкладки браузера — строка интерфейса, поэтому из словаря.
// Разбор решения — в `app/app/journals/page.tsx`.
export async function generateMetadata() {
  const t = await getT()
  return { title: t('catalog.meta.title') }
}

type MediaRow = { path: string; position: number }
type VariantRow = {
  id: string; price: number | null; duration_minutes: number | null
  track_stock: boolean; stock_qty: number | null
}

// Название категории приезжает вложенной выборкой. PostgREST на связи
// «многие к одному» отдаёт ОБЪЕКТ, но нетипизированный клиент рисует
// его массивом — разбираем оба вида, иначе категория молча станет
// пустой на первой же смене версии supabase-js.
type CategoryRef = { name: string } | { name: string }[] | null | undefined
const categoryName = (c: CategoryRef): string | null =>
  (Array.isArray(c) ? c[0]?.name ?? null : c?.name ?? null)

// Обложка и число вариантов приходят вложенными выборками, а не отдельными
// запросами: список каталога открывают чаще любого другого экрана кабинета,
// и три поездки в базу вместо одной здесь заметны (правило 6).
export default async function CatalogPage() {
  const m = await currentMembership()
  if (!m) redirect('/register/seller')
  // `offerings_read` (0004) стоит на `catalog.read`. Без проверки
  // inspector, у которого это право забрали в 0035, открывал каталог
  // прямым адресом и получал пустой экран без причины.
  if (!can(m, 'catalog.read')) redirect('/app')
  // Вторая ось: право сотрудника прочитано, теперь спрашиваем, брал ли
  // заклад сам раздел. В панели этот пункт помечен модулем `catalog`
  // («Послуги»), то есть меню его уже прячет — а прямой адрес открывал
  // список позиций заведению, которое каталога не подключало.
  if (!hasModule(m, 'catalog')) return <ModuleOff m={m} module="catalog" />

  const supabase = await createClient()

  const { data, error } = await supabase
    .from('offerings')
    .select(
      // Категория и остаток вариантов — теми же вложенными выборками,
      // а не отдельными поездками: карточка каталога на широком экране
      // показывает и то и другое, а лишний запрос здесь заметен (правило 6).
      // `categories` — общий справочник платформы, он читается по
      // `categories_read` (0002) всеми, поэтому связь не вернёт пустоту
      // из-за прав, как это было с `offerings(title)` у инспектора.
      `id, kind, status, title, subtitle, price, currency, slug, listed,
       categories(name),
       offering_media(path, position),
       offering_variants(id, price, duration_minutes, track_stock, stock_qty)`,
    )
    .eq('tenant_id', m.tenantId)
    .order('updated_at', { ascending: false })
    .limit(200)

  return (
    <AppShell modules={m.modules} perms={m.perms}>
      <CatalogClient
        error={error?.message ?? null}
        // `/app/catalog/new` требует `catalog.write` и разворачивает
        // обратно сюда. Кнопка «Додати» без права вела человека в редирект —
        // снаружи это неотличимо от сломанной кнопки. Право считается
        // здесь и едет пропом: клиент за правами не ходит (правило 3).
        canWrite={can(m, 'catalog.write')}
        // Витрина — соседний модуль: от него зависят строка «вітрина нічого
        // не показує» в пустом списке и отметка «поза каталогом».
        hasStorefront={hasModule(m, 'storefront')}
        items={(data ?? []).map((o) => {
          const media = ([...((o.offering_media ?? []) as MediaRow[])])
            .sort((a, b) => a.position - b.position)
          const variants = (o.offering_variants ?? []) as VariantRow[]
          // Цена-витрина заполнена не всегда. Тогда показываем минимальную
          // по вариантам — ровно то число, которое увидит покупатель.
          const fromVariants = variants
            .map((v) => (v.price == null ? null : Number(v.price)))
            .filter((p): p is number => p !== null)
          // Тривалість — тільки для послуг, і тільки коли задана хоч
          // на одному варіанті: у товару це поле завжди порожнє
          // (тригер `offering_variants_duration`, 0010).
          const durations = variants
            .map((v) => v.duration_minutes)
            .filter((d): d is number => d != null)

          // Залишок — сумма по вариантам, У КОТОРЫХ он ведётся. Вариант
          // без учёта (`track_stock = false`) не «ноль на складе», а
          // «остаток не считаем»: сложить его с остальными значило бы
          // показать в карточке меньше, чем есть на полке. Если учёта
          // нет ни у одного варианта — величины нет вовсе (null),
          // и бейдж остатка не рисуется.
          const tracked = variants.filter((v) => v.track_stock)

          return {
            id: o.id as string,
            kind: o.kind as 'product' | 'service',
            status: o.status as string,
            title: o.title as string,
            subtitle: (o.subtitle ?? null) as string | null,
            slug: o.slug as string,
            listed: o.listed as boolean,
            currency: o.currency as string,
            price: o.price != null
              ? Number(o.price)
              : fromVariants.length > 0 ? Math.min(...fromVariants) : null,
            durationMinutes: durations.length > 0 ? Math.min(...durations) : null,
            variants: variants.length,
            cover: media[0]?.path ?? null,
            category: categoryName((o as { categories?: CategoryRef }).categories),
            // Остаток — величина товара. У услуги её нет по природе,
            // и триггер каталога держит `track_stock = false` на её
            // вариантах; спрашивать здесь `kind` — вторая защита от
            // строки-исключения, заведённой в обход формы.
            stock: o.kind === 'product' && tracked.length > 0
              ? tracked.reduce((s, v) => s + (v.stock_qty ?? 0), 0)
              : null,
          }
        })}
      />
    </AppShell>
  )
}
