// Скелетон загрузки. Рисует ТОЛЬКО содержимое: шапка, заголовок
// и нижняя панель приходят из `app/app/layout.tsx` и во время
// загрузки уже стоят на экране. Своей AppShell здесь быть не должно —
// при каждом переходе на экране оказывались бы две нижние панели
// одна поверх другой. Не заводить.
//
// Заведён 18.08.2026 вместе с «Профілем»: этих двух вкладок из четырёх
// нижней панели скелетона не было ВООБЩЕ. Без него Next держит на экране
// ПРЕЖНЮЮ страницу, пока сервер рисует новую, — то есть нажатие на
// вкладку не меняло ничего целую секунду. Владелец описал это как
// «переход прогружается где-то секунду»; сама секунда — серверная
// отрисовка и поход в базу, а вот пустое ожидание без единого признака
// жизни давал именно отсутствующий `loading.tsx`.
//
// Форма повторяет CatalogClient: ряд фильтров, карточка итога,
// плитки позиций сеткой.
export default function Loading() {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <span key={i} className="skeleton h-11 w-28" />
        ))}
      </div>

      <section className="card">
        <span className="skeleton block h-4 w-48" />
      </section>

      <div className="grid gap-2 sm:grid-cols-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="card !p-3">
            <div className="flex items-center gap-3">
              <span className="skeleton h-16 w-16 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="skeleton mb-2 block h-4 w-3/4" />
                <span className="skeleton block h-3 w-1/2" />
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
