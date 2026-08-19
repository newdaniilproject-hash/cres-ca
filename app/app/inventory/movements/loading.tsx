// Скелетон загрузки. Рисует ТОЛЬКО содержимое: шапка, заголовок
// и нижняя панель приходят из `app/app/layout.tsx` и во время
// загрузки уже стоят на экране. Раньше здесь была своя AppShell —
// и при каждом переходе на экране оказывались две нижние панели
// одна поверх другой. Не возвращать.
//
// Форма повторяет MovementsClient: счётчики, ряд чипов фильтра,
// кнопка действия, список `.row`. Скелетон другой формы — лишний
// скачок раскладки в момент, когда данные приехали.
export default function Loading() {
  return (
    <div className="flex flex-col gap-5">
      {/* Счётчики */}
      <section className="grid grid-cols-4 gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="metric">
            <span className="skeleton h-5 w-8" />
            <span className="skeleton h-3 w-16" />
          </div>
        ))}
      </section>

      {/* Чипы фильтра — одной строкой, как на экране */}
      <div className="scroll-x -mx-4 flex gap-2 px-4 pb-1 sm:mx-0 sm:px-0">
        {Array.from({ length: 6 }).map((_, i) => (
          <span key={i} className="skeleton h-9 w-24 shrink-0" />
        ))}
      </div>

      {/* Кнопка действия */}
      <span className="skeleton h-11 w-44" />

      {/* Список */}
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
