// Скелетон загрузки. Рисует ТОЛЬКО содержимое: шапка, заголовок
// и нижняя панель приходят из `app/app/layout.tsx` и во время
// загрузки уже стоят на экране. Раньше здесь была своя AppShell —
// и при каждом переходе на экране оказывались две нижние панели
// одна поверх другой. Не возвращать.
// JournalsClient открывается на вкладке «Прибирання» — чек-лист
// задач построчно, тем же .row, что и в реальному контенті.
export default function Loading() {
  return (
    <>
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
    </>
  )
}
