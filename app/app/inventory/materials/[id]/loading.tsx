// Скелетон карточки засоба. Рисует ТОЛЬКО содержимое: шапка и нижняя
// панель приходят из макета кабинета и уже стоят на экране.
//
// Форма повторяет MaterialCard: шапка с миниатюрой и названием →
// паспорт таблицей .kv → «Партія та терміни» → два навигационных ряда
// подэкранов. Скелетон другой формы — лишний скачок раскладки в момент,
// когда данные приехали.
export default function Loading() {
  return (
    <div className="flex flex-col gap-4">
      {/* Шапка: бейдж состояния, фото + имя, остаток, кнопка правки */}
      <div className="card flex flex-col gap-2">
        <span className="skeleton h-5 w-24" />
        <div className="flex items-start gap-3">
          <span className="skeleton h-12 w-12 shrink-0" />
          <span className="skeleton mt-1 h-7 w-2/3" />
        </div>
        <span className="skeleton h-4 w-44" />
        <span className="skeleton mt-2 h-10 w-40" />
      </div>

      {/* Паспорт засоба: надзаголовок + строки «ключ — значение» */}
      <div>
        <span className="skeleton mb-2 block h-3 w-32" />
        <div className="kv">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="kv-row">
              <span className="skeleton h-4 w-24" />
              <span className="skeleton h-4 w-28" />
            </div>
          ))}
        </div>
      </div>

      {/* Партия и сроки */}
      <div>
        <span className="skeleton mb-2 block h-3 w-36" />
        <div className="kv">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="kv-row">
              <span className="skeleton h-4 w-28" />
              <span className="skeleton h-4 w-24" />
            </div>
          ))}
        </div>
      </div>

      {/* Два подэкрана: документы и контроль вскрытия */}
      <div className="card !p-0">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="skeleton-row px-5">
            <span /><span /><span /><span />
          </div>
        ))}
      </div>
    </div>
  )
}
