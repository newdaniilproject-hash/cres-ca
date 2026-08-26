// Скелетон загрузки. Только содержимое — оболочка уже на экране
// (разбор — в `app/app/customers/loading.tsx`).
//
// Форма повторяет SettingsClient: список разделов строками, у каждой
// плашка со значком слева и шеврон справа. Число строк постоянное:
// набор разделов не зависит от данных, он зависит от прав и модулей,
// а те приезжают с токеном ещё до запроса.
export default function Loading() {
  return (
    <div className="flex flex-col gap-4">
      <div className="mb-1 hidden items-center gap-3 lg:flex">
        <span className="skeleton h-11 w-11 rounded-2xl" />
        <div className="flex flex-col gap-2">
          <span className="skeleton h-6 w-64" />
          <span className="skeleton h-4 w-48" />
        </div>
      </div>

      <div className="flex flex-col gap-2" style={{ maxWidth: 700 }}>
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="card flex items-center gap-3 !py-4">
            <span className="skeleton h-10 w-10 shrink-0 rounded-xl" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <span className="skeleton h-4 w-40" />
              <span className="skeleton h-3 w-full max-w-sm" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
