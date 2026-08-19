// ⚠️ ВРЕМЕННАЯ страница приёмки вида. НЕ КОММИТИТЬ.
// Разбор — в шапке `app/zz-preview/page.tsx`. Данные — из хендоффа CRESKO,
// экран `today`: пять записей дня и два повода «потребує уваги» ровно те,
// что нарисованы в макете.
import { AppShell, type NavModule } from '@/components/app-shell'
import { getT } from '@/lib/i18n/server'
import type { T } from '@/lib/i18n/translate'
import { TodayMobile, type TodayAttention } from '../../app/today-mobile'

// Новые строки экрана лежат в отдельном файле стенда (`keys-mobtoday.json`)
// и в словарь продукта попадут отдельным шагом. Чтобы кадр был сопоставим
// с эталоном, переводчик здесь их подставляет сам.
const EXTRA: Record<string, string> = {
  'home.schedule.title': 'Розклад на сьогодні',
  'home.schedule.all': 'Всі записи',
  'home.attention.title': 'Потребує уваги',
  'home.attention.empty': 'Нічого термінового: терміни в межах норми, запасів достатньо',
  'home.attention.low': 'Залишок нижче мінімуму',
  'app.chrome.bell.pending': 'У черзі: {n}',
}

function withExtra(base: T): T {
  return new Proxy(base, {
    apply(target, thisArg, args: [string, Record<string, string>?]) {
      const raw = EXTRA[args[0]]
      if (raw === undefined) return Reflect.apply(target as never, thisArg, args)
      return Object.entries(args[1] ?? {}).reduce(
        (s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), raw,
      )
    },
  }) as T
}

const REGISTRY: NavModule[] = [
  { code: 'inventory', title: 'Склад', description: 'Розхідники, ємності, приймання', icon: 'IconBox', route: '/app/inventory', perm: 'stock.read', inTabs: true },
  { code: 'bookings', title: 'Записи', description: 'Запис на послуги, слоти', icon: 'IconCalendar', route: '/app/bookings', perm: 'orders.read', inTabs: true },
  { code: 'catalog', title: 'Послуги', description: 'Товари і послуги', icon: 'IconScissors', route: '/app/catalog', perm: 'catalog.read', inTabs: true },
]

const pad = (n: number) => String(n).padStart(2, '0')
const now = new Date()
const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
const at = (h: number, m: number) => new Date(`${day}T${pad(h)}:${pad(m)}:00`).toISOString()

const BOOKINGS = [
  { id: 'b1', startISO: at(9, 0), name: 'Анна К.', service: 'Манікюр + гель-лак', status: 'confirmed' },
  { id: 'b2', startISO: at(10, 30), name: 'Марія І.', service: 'Педикюр', status: 'confirmed' },
  { id: 'b3', startISO: at(12, 0), name: 'Олена П.', service: 'Нарощування нігтів', status: 'confirmed' },
  { id: 'b4', startISO: at(14, 30), name: 'Вікторія С.', service: 'Корекція брів', status: 'booked' },
  { id: 'b5', startISO: at(16, 0), name: 'Ірина В.', service: 'Зняття покриття', status: 'confirmed' },
]

export default async function TodayPreview() {
  const t = withExtra(await getT())
  const attention: TodayAttention[] = [
    {
      key: 'c1',
      title: 'Дезрозчин 2% для інструментів',
      sub: t('home.expiring.container', { code: 'DR-25-05' }),
      badge: t('home.expiring.until', { date: t.date(new Date(Date.now() + 2 * 864e5)) }),
      hot: true,
      href: '/app/inventory',
    },
    {
      key: 'l1',
      title: 'Olaplex No.5 Bond Maintenance',
      sub: t('home.attention.low'),
      badge: t('home.reorder.item', { n: t.number(3) }),
      href: '/app/inventory/reorder',
    },
  ]

  return (
    <div id="page">
      <AppShell
        modules={REGISTRY.map((r) => r.code)}
        registry={REGISTRY}
        perms={['*']}
        shopName="Beauty Studio"
        userName="Олена Коваль"
        role="admin"
      >
        <TodayMobile
          t={t}
          name="Олено"
          showBookings
          showAttention
          bookings={BOOKINGS}
          attention={attention}
        />
      </AppShell>
    </div>
  )
}
