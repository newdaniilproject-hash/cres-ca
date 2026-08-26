// Скелетон загрузки. Только содержимое — оболочка уже на экране
// (разбор — в `app/app/customers/loading.tsx`).
//
// Форма повторяет FinanceClient: хедер, три плитки-метрики,
// полоса «Усі / Доходи / Витрати / Аналітика», журнал по дням.
export default function Loading() {
  return (
    <div className="flex flex-col gap-4">
      <div className="mb-1 hidden items-center gap-3 lg:flex">
        <span className="skeleton h-11 w-11 rounded-2xl" />
        <div className="flex flex-col gap-2">
          <span className="skeleton h-6 w-36" />
          <span className="skeleton h-4 w-56" />
        </div>
      </div>

      <section className="grid grid-cols-3 gap-2 lg:gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="card flex flex-col gap-2">
            <span className="skeleton h-9 w-9 rounded-xl" />
            <span className="skeleton h-3 w-20" />
            <span className="skeleton h-6 w-24" />
          </div>
        ))}
      </section>

      <div className="scroll-x -mx-4 flex gap-2 px-4 pb-1 sm:mx-0 sm:px-0">
        {Array.from({ length: 4 }).map((_, i) => (
          <span key={i} className="skeleton h-9 w-28 shrink-0" />
        ))}
      </div>

      {/* Журнал сгруппирован по дням: заголовок дня и под ним строки.
          Скелетон повторяет эту ступень — иначе в момент прихода данных
          список подпрыгивает на высоту заголовков. */}
      {Array.from({ length: 2 }).map((_, g) => (
        <section key={g} className="card !p-0">
          <div className="flex items-center justify-between px-5 py-3">
            <span className="skeleton h-4 w-28" />
            <span className="skeleton h-4 w-20" />
          </div>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton-row px-5">
              <span /><span /><span /><span />
            </div>
          ))}
        </section>
      ))}
    </div>
  )
}
