// Скелетон загрузки. Рисует ТОЛЬКО содержимое: шапка, заголовок
// и нижняя панель приходят из `app/app/layout.tsx` и во время
// загрузки уже стоят на экране (своя AppShell здесь давала бы
// вторую нижнюю панель поверх первой — см. склад, не возвращать).
//
// Форма повторяет RecipesClient: строка вкладок, затем карточка
// со списком позиций. Переменное число строк получает только
// список — именно он меняет высоту от данных.
export default function Loading() {
  return (
    <div className="flex flex-col gap-5">
      {/* Вкладки «Послуги / Товари» */}
      <div className="flex gap-2">
        {[96, 88].map((w, i) => (
          <span key={i} className="skeleton h-11 shrink-0" style={{ width: w }} />
        ))}
      </div>

      {/* Список позиций */}
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
