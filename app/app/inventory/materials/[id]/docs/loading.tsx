// Скелетон экрана документов засоба. Рисует ТОЛЬКО содержимое —
// шапка и нижняя панель уже на экране.
//
// Форма повторяет MaterialDocs: ряд фильтров → список файлов →
// блок нотификации МОЗ.
export default function Loading() {
  return (
    <div className="flex flex-col gap-4">
      {/* Фильтры по виду документа */}
      <div className="flex gap-2">
        {['w-16', 'w-20', 'w-24'].map((w, i) => (
          <span key={i} className={`skeleton h-9 shrink-0 ${w}`} />
        ))}
      </div>

      {/* Список файлов */}
      <div className="card !p-0">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skeleton-row px-5">
            <span /><span /><span /><span />
          </div>
        ))}
      </div>

      {/* Нотификация МОЗ */}
      <div className="card flex flex-col gap-2">
        <span className="skeleton h-4 w-32" />
        <span className="skeleton h-5 w-48" />
        <span className="skeleton h-4 w-40" />
      </div>
    </div>
  )
}
