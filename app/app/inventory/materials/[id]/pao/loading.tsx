// Скелетон контроля вскрытия и фасования. Рисует ТОЛЬКО содержимое —
// шапка и нижняя панель уже на экране.
//
// Форма повторяет PaoControl: счётчики .metric → переключатель
// «Активні / Всі» → карточка банки со строками «ключ — значение»
// и кнопками → история розливов.
export default function Loading() {
  return (
    <div className="flex flex-col gap-4">
      {/* Счётчики смены */}
      <section className="grid grid-cols-3 gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="metric">
            <span className="skeleton mb-1.5 block h-6 w-8" />
            <span className="skeleton block h-3 w-16" />
          </div>
        ))}
      </section>

      {/* Переключатель «Активні / Всі» */}
      <span className="skeleton h-9 w-36 rounded-full" />

      {/* Карточка банки: код + бейдж, строки, кнопки действий */}
      <div className="card">
        <div className="mb-1 flex items-center justify-between">
          <span className="skeleton h-5 w-28" />
          <span className="skeleton h-5 w-20" />
        </div>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="kv-row">
            <span className="skeleton h-4 w-24" />
            <span className="skeleton h-4 w-28" />
          </div>
        ))}
        <div className="mt-3 flex gap-2">
          <span className="skeleton h-10 w-32" />
          <span className="skeleton h-10 w-28" />
        </div>
      </div>

      {/* История розливов */}
      <div className="card !p-0">
        <div className="px-5 pt-4">
          <span className="skeleton block h-3 w-32" />
        </div>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="skeleton-row px-5">
            <span /><span /><span /><span />
          </div>
        ))}
      </div>
    </div>
  )
}
