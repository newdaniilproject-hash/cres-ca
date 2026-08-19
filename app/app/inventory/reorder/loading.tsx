// Скелетон загрузки. Рисует ТОЛЬКО содержимое: шапка, заголовок
// и нижняя панель приходят из `app/app/layout.tsx` и во время
// загрузки уже стоят на экране (своя AppShell здесь давала бы
// вторую нижнюю панель поверх первой — см. склад, не возвращать).
//
// Форма повторяет ReorderClient: три плитки-счётчика, широкая кнопка
// «Скопіювати все», затем карточка группы поставщика со строками.
export default function Loading() {
  return (
    <div className="flex flex-col gap-5">
      {/* Счётчики */}
      <section className="grid grid-cols-3 gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="metric">
            <span className="skeleton h-6 w-10" />
            <span className="skeleton h-3 w-16" />
          </div>
        ))}
      </section>

      {/* «Скопіювати все» */}
      <span className="skeleton h-11 w-full" />

      {/* Группа поставщика */}
      <section className="card !p-0">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="skeleton-row px-5">
            <span /><span /><span /><span />
          </div>
        ))}
      </section>
    </div>
  )
}
