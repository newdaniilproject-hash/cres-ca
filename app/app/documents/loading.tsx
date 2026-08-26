// Скелетон загрузки. Только содержимое — оболочка уже на экране
// (разбор — в `app/app/customers/loading.tsx`).
//
// Экран реестра косметики — ГЛАВНЫЙ для инспектора: он открывает его
// первым и с чужого телефона. Пустой кадр вместо списка читается там
// хуже всего: «в салоне ничего нет» вместо «сейчас загрузится».
export default function Loading() {
  return (
    <div className="flex flex-col gap-5">
      <div className="hidden items-center justify-between gap-3 lg:flex">
        <div className="flex items-center gap-3">
          <span className="skeleton h-11 w-11 rounded-2xl" />
          <div className="flex flex-col gap-2">
            <span className="skeleton h-6 w-56" />
            <span className="skeleton h-4 w-64" />
          </div>
        </div>
        <span className="skeleton h-11 w-40" />
      </div>

      <span className="skeleton h-11 w-full lg:hidden" />

      <section className="card !p-0">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="skeleton-row px-5">
            <span /><span /><span /><span />
          </div>
        ))}
      </section>
    </div>
  )
}
