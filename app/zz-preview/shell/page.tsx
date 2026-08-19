// ⚠️ ВРЕМЕННАЯ страница приёмки вида. НЕ КОММИТИТЬ. См. ../page.tsx.
'use client'

import { AppShell, type NavModule } from '@/components/app-shell'

// Реестр модулей — как его отдаёт база на бою: код, подпись, ОПИСАНИЕ,
// значок, адрес, право, признак нижней панели.
const REGISTRY: NavModule[] = [
  { code: 'inventory', title: 'Склад', description: 'Розхідники, ємності, приймання, інвентаризація', icon: 'IconBox', route: '/app/inventory', perm: 'stock.read', inTabs: true },
  { code: 'bookings', title: 'Записи', description: 'Запис на послуги, слоти, нагадування', icon: 'IconCalendar', route: '/app/bookings', perm: 'orders.read', inTabs: true },
  { code: 'catalog', title: 'Послуги', description: 'Товари і послуги', icon: 'IconScissors', route: '/app/catalog', perm: 'catalog.read', inTabs: true },
  { code: 'compliance', title: 'Журнали', description: 'Санітарні журнали, документи, техкарти, звіт для перевірки', icon: 'IconCheck', route: '/app/journals', perm: 'compliance.read', inTabs: false },
  { code: 'orders', title: 'Замовлення', description: 'Замовлення і доставка', icon: 'IconBag', route: '/app/orders', perm: 'orders.read', inTabs: false },
  { code: 'customers', title: 'Клієнти', description: 'База клієнтів і нагадування', icon: 'IconUsers', route: '/app/customers', perm: 'customers.read', inTabs: false },
  { code: 'finance', title: 'Фінанси', description: 'Доходи, витрати, собівартість', icon: 'IconMoney', route: '/app/finance', perm: 'finances.read', inTabs: false },
]

export default function ShellPreview() {
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
        <div style={{ padding: 16 }}>Вміст екрана</div>
      </AppShell>
    </div>
  )
}
