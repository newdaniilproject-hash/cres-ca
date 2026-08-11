import { AppShell } from '@/components/shell'

// BookingsClient групує записи підписами днів, під кожним — card
// зі списком .row (час+ім'я зліва, бейдж+кнопки справа). Готової
// сітки час×слот на цьому екрані немає — .skeleton-calendar тут
// не підійде формою.
export default function Loading() {
  return (
    <AppShell active="/app/bookings" title="Записи">
      <div className="flex flex-col gap-6">
        {Array.from({ length: 2 }).map((_, di) => (
          <section key={di}>
            <span className="skeleton mb-2 block h-4 w-40" />
            <div className="card !p-0">
              {Array.from({ length: di === 0 ? 4 : 2 }).map((_, i) => (
                <div key={i} className="skeleton-row px-5">
                  <span /><span /><span /><span />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </AppShell>
  )
}
