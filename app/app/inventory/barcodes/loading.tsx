// Скелетон загрузки. Рисует ТОЛЬКО содержимое: шапка, заголовок
// и нижняя панель приходят из `app/app/layout.tsx` и во время
// загрузки уже стоят на экране (своя AppShell здесь давала бы
// вторую нижнюю панель поверх первой — см. склад, не возвращать).
//
// Форма повторяет BarcodesClient: одна карточка со списком засобів.
// Ни поля поиска, ни шапки у экрана нет — и у скелетона их нет тоже:
// скелетон другой формы даёт скачок раскладки, когда данные приехали.
export default function Loading() {
  return (
    <div className="flex flex-col gap-5">
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
