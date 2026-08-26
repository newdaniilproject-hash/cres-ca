// Скелетон загрузки карточки заказа. Только содержимое — оболочка уже
// на экране (разбор — в `app/app/customers/loading.tsx`).
//
// Карточка тянет заказ, его позиции, историю статусов, отгрузку
// и возвраты. Форма: шапка с номером и статусом, состав, итоги, история.
export default function Loading() {
  return (
    <div className="flex flex-col gap-4">
      <section className="card flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <span className="skeleton h-6 w-36" />
          <span className="skeleton h-7 w-28" />
        </div>
        <span className="skeleton h-4 w-56" />
        <div className="flex flex-wrap gap-2">
          <span className="skeleton h-11 w-36" />
          <span className="skeleton h-11 w-32" />
        </div>
      </section>

      <section className="card !p-0">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skeleton-row px-5">
            <span /><span /><span /><span />
          </div>
        ))}
      </section>

      <section className="card flex flex-col gap-3">
        <span className="skeleton h-4 w-28" />
        {Array.from({ length: 3 }).map((_, i) => (
          <span key={i} className="skeleton h-4 w-full max-w-sm" />
        ))}
      </section>
    </div>
  )
}
