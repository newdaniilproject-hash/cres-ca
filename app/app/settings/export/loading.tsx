// Скелетон выгрузки. Рисует ТОЛЬКО содержимое: шапка и нижняя панель
// приходят из `app/app/layout.tsx` (разбор — `app/app/bookings/loading.tsx`).
export default function Loading() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span className="skeleton block h-4 w-28" />
        <span className="skeleton block h-7 w-56" />
      </div>
      <div className="card">
        <span className="skeleton block h-9 w-48" />
      </div>
      <div className="card !p-0">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="row px-5">
            <span className="skeleton block h-4 w-40" />
            <span className="skeleton block h-7 w-28" />
          </div>
        ))}
      </div>
    </div>
  )
}
