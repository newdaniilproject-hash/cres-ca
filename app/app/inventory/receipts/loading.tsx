// Скелетон загрузки. Рисует ТОЛЬКО содержимое: шапка, заголовок
// и нижняя панель приходят из `app/app/layout.tsx` и во время
// загрузки уже стоят на экране (см. `movements/loading.tsx` — своя
// AppShell здесь давала две нижние панели одна поверх другой).
//
// Форма повторяет ReceiptsClient: три счётчика, кнопка создания,
// список `.row`. Скелетон другой формы — лишний скачок раскладки.
export default function Loading() {
  return (
    <div className="flex flex-col gap-5">
      {/* Счётчики */}
      <section className="grid grid-cols-3 gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="metric">
            <span className="skeleton h-5 w-8" />
            <span className="skeleton h-3 w-16" />
          </div>
        ))}
      </section>

      {/* Кнопка создания */}
      <span className="skeleton h-11 w-44" />

      {/* Список */}
      <section className="card !p-0">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="skeleton-row px-5">
            <span /><span /><span /><span />
          </div>
        ))}
      </section>
    </div>
  )
}
