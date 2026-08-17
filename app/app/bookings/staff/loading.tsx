// Скелетон списка мастеров. Рисует ТОЛЬКО содержимое: шапка и нижняя
// панель приходят из `app/app/layout.tsx` и во время загрузки уже стоят
// на экране (разбор — в `app/app/bookings/loading.tsx`).
export default function Loading() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-2">
          <span className="skeleton block h-6 w-40" />
          <span className="skeleton block h-4 w-64" />
        </div>
        <span className="skeleton block h-9 w-32" />
      </div>
      <div className="card !p-0">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="skeleton-row px-5">
            <span /><span /><span /><span />
          </div>
        ))}
      </div>
    </div>
  )
}
