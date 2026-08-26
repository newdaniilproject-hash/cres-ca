// Скелетон загрузки формы новой позиции. Только содержимое — оболочка
// уже на экране (разбор — в `app/app/customers/loading.tsx`).
//
// Форма позиции длинная и грузится вместе со справочником категорий
// и списком мест хранения. Без скелетона нажатие «Нова позиція»
// отвечает пустым полотном — то есть выглядит как несработавшая кнопка.
export default function Loading() {
  return (
    <div className="flex flex-col gap-5">
      <span className="skeleton h-11 w-40" />
      {Array.from({ length: 3 }).map((_, s) => (
        <section key={s} className="card grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-2">
              <span className="skeleton h-3 w-24" />
              <span className="skeleton h-11 w-full" />
            </div>
          ))}
        </section>
      ))}
    </div>
  )
}
