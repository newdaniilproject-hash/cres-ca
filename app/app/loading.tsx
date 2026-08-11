import { AppShell } from '@/components/shell'

// Три карточки дашборда: записи сьогодні, спливає термін, що закуповувати.
// Кількість рядків — правдоподібна, не точна: реальна залежить від дня.
export default function Loading() {
  return (
    <AppShell active="/app" title="Кабінет">
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card rise-1">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="t-lg">Записи сьогодні</h2>
          </div>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton-row">
              <span /><span /><span /><span />
            </div>
          ))}
        </section>

        <section className="card rise-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="t-lg">Спливає термін</h2>
          </div>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="skeleton-row">
              <span /><span /><span /><span />
            </div>
          ))}
        </section>

        <section className="card rise-3 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="t-lg">Що закуповувати</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <span key={i} className="skeleton h-6 w-28" />
            ))}
          </div>
        </section>
      </div>
    </AppShell>
  )
}
