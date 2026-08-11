import { AppShell } from '@/components/shell'

// JournalsClient открывается на вкладке «Прибирання» — чек-лист
// задач построчно, тем же .row, что и в реальному контенті.
export default function Loading() {
  return (
    <AppShell active="/app/journals" title="Санітарні журнали">
      <div className="flex flex-col gap-5">
        <div className="rise flex flex-wrap items-center gap-2">
          <span className="skeleton h-11 w-48" />
        </div>

        <section className="flex flex-col gap-4">
          <div className="card rise-1 !p-0">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="skeleton-row px-5">
                <span /><span /><span /><span />
              </div>
            ))}
          </div>
        </section>
      </div>
    </AppShell>
  )
}
