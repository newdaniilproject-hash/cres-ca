// Скелетон загрузки. Рисует ТОЛЬКО содержимое: шапка, заголовок
// и нижняя панель приходят из `app/app/layout.tsx` и во время
// загрузки уже стоят на экране (см. `movements/loading.tsx`).
//
// Форма повторяет ReceiptDetail: карточка шапки документа, карточка
// строк с итогом и рядом действий внизу.
export default function Loading() {
  return (
    <div className="flex flex-col gap-5">
      {/* Шапка документа */}
      <section className="card">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <span className="skeleton block h-5 w-40" />
            <span className="skeleton mt-1.5 block h-3 w-56" />
          </div>
          <span className="skeleton h-7 w-24 shrink-0" />
        </div>
      </section>

      {/* Строки */}
      <section className="card !p-0">
        <div className="flex items-center justify-between gap-3 px-5 pt-5">
          <span className="skeleton h-5 w-24" />
          <span className="skeleton h-4 w-28" />
        </div>
        <div className="px-5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton-row">
              <span /><span /><span /><span />
            </div>
          ))}
        </div>
        <div className="flex gap-2 px-5 pb-5 pt-4">
          <span className="skeleton h-11 w-36" />
          <span className="skeleton h-11 w-44" />
        </div>
      </section>
    </div>
  )
}
