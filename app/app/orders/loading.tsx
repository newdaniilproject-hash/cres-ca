// Скелетон загрузки. Только содержимое — оболочка уже на экране
// (см. `app/app/customers/loading.tsx`, там же разбор, зачем это нужно).
//
// Форма повторяет OrdersClient: хедер веб-раскладки, полоса статусов
// со счётчиками, список заказов.
export default function Loading() {
  return (
    <div className="flex flex-col gap-4">
      <div className="mb-1 hidden items-center gap-3 lg:flex">
        <span className="skeleton h-11 w-11 rounded-2xl" />
        <div className="flex flex-col gap-2">
          <span className="skeleton h-6 w-44" />
          <span className="skeleton h-4 w-56" />
        </div>
      </div>

      <div className="scroll-x -mx-4 flex gap-2 px-4 pb-1 sm:mx-0 sm:px-0">
        {Array.from({ length: 5 }).map((_, i) => (
          <span key={i} className="skeleton h-9 w-28 shrink-0" />
        ))}
      </div>

      <section className="card !p-0">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="skeleton-row px-5">
            <span /><span /><span /><span />
          </div>
        ))}
      </section>
    </div>
  )
}
