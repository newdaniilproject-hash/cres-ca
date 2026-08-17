// Скелетон карточки мастера: заголовок, состояние, неделя, отпуска.
// Рисует ТОЛЬКО содержимое — шапка и нижняя панель уже на экране.
export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <span className="skeleton block h-4 w-24" />
        <span className="skeleton block h-7 w-52" />
        <span className="skeleton block h-4 w-36" />
      </div>
      <div className="card">
        <span className="skeleton block h-5 w-64" />
      </div>
      <div className="card !p-0">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="row px-5">
            <span className="skeleton block h-4 w-24" />
            <span className="skeleton block h-6 w-32" />
          </div>
        ))}
      </div>
      <div className="card">
        <span className="skeleton block h-4 w-48" />
      </div>
    </div>
  )
}
