// Скелетон загрузки карточки позиции. Только содержимое — оболочка
// уже на экране (разбор — в `app/app/customers/loading.tsx`).
//
// Карточка тянет саму позицию, её варианты, фото, категории, места
// хранения и расход по рецептуре — шесть выборок. Форма скелетона та же,
// что у «новой позиции»: это буквально один и тот же экран с данными
// и без них, и разная форма загрузки у них была бы враньём о том,
// куда человек попадёт.
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
