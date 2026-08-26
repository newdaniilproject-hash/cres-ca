// Скелетон загрузки. Рисует ТОЛЬКО содержимое: шапка, заголовок и нижняя
// панель приходят из `app/app/layout.tsx` и во время загрузки уже стоят
// на экране. Своя AppShell здесь дала бы вторую нижнюю панель поверх
// первой — не возвращать.
//
// Почему этот файл вообще нужен. Правило 6: ОТВЕТ на нажатие и ЗАГРУЗКА
// данных — разные сроки, и первый не имеет права ждать второго. Экран
// клиентов делает пять запросов (список плюс три счётчика `head: true`
// плюс напоминания) в базу в Ирландии; без скелетона нажатие на «Клієнти»
// отвечало ПУСТОТОЙ, и это читается как зависшая кнопка.
//
// Форма повторяет CustomersClient: хедер веб-раскладки, полоса фильтров
// со счётчиками, таблица.
export default function Loading() {
  return (
    <div className="flex flex-col gap-4">
      {/* Хедер экрана — только на широком: на телефоне имя раздела
          называет шапка, и второй заголовок был бы его повтором. */}
      <div className="mb-1 hidden items-center gap-3 lg:flex">
        <span className="skeleton h-11 w-11 rounded-2xl" />
        <div className="flex flex-col gap-2">
          <span className="skeleton h-6 w-40" />
          <span className="skeleton h-4 w-56" />
        </div>
      </div>

      {/* Полоса фильтров со счётчиками */}
      <div className="scroll-x -mx-4 flex gap-4 px-4 pb-1 sm:mx-0 sm:px-0">
        {Array.from({ length: 3 }).map((_, i) => (
          <span key={i} className="skeleton h-8 w-32 shrink-0" />
        ))}
      </div>

      <section className="card !p-0">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="skeleton-row px-5">
            <span /><span /><span /><span />
          </div>
        ))}
      </section>
    </div>
  )
}
