// Скелетон загрузки карточки ёмкости. Только содержимое — оболочка уже
// на экране (разбор — в `app/app/customers/loading.tsx`).
//
// На эту карточку заходят СКАНЕРОМ, стоя у рабочего места: навёл на
// наклейку — и ждёшь ответа. Пустой кадр здесь читается хуже всего:
// мастер не понимает, прочитался ли код вообще, и сканирует второй раз.
export default function Loading() {
  return (
    <div className="flex flex-col gap-4">
      <section className="card flex flex-col gap-3">
        <span className="skeleton h-6 w-48" />
        <span className="skeleton h-4 w-32" />
        <div className="kv">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="kv-row">
              <span className="skeleton h-4 w-28" />
              <span className="skeleton h-4 w-24" />
            </div>
          ))}
        </div>
      </section>

      <div className="flex flex-wrap gap-2">
        <span className="skeleton h-11 w-40" />
        <span className="skeleton h-11 w-36" />
      </div>
    </div>
  )
}
