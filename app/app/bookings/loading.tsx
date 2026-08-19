// Скелетон загрузки. Рисует ТОЛЬКО содержимое: шапка, заголовок
// и нижняя панель приходят из `app/app/layout.tsx` и во время
// загрузки уже стоят на экране. Раньше здесь была своя AppShell —
// и при каждом переходе на экране оказывались две нижние панели
// одна поверх другой. Не возвращать.
//
// Форма скелетона — ДЕННА, хоча у екрана три види. Причина не в лінощах:
// loading.tsx не бачить `?view=` (це не сторінка, а заглушка сегмента),
// тобто вгадати вид звідси нічим. Показуємо УМОЛЧАННЯ — таймлайн дня;
// місячна сітка й тижнева приходять зі своїм каркасом одразу, чекати
// їм нічого.
//
// Повторює саме таймлайн: перемикач вида, підпис дня, а далі рядки
// «вузька колонка години + широка плашка». Скелетон іншої форми гірший
// за його відсутність — на місці сірих смуг з'являється щось інше,
// і перехід читається як стрибок.
export default function Loading() {
  return (
    <div className="flex flex-col gap-4">
      <span className="skeleton block h-[52px] w-full rounded-[var(--radius-card)]" />
      <span className="skeleton block h-5 w-48" />
      <div className="flex flex-col gap-2">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="flex items-start gap-2">
            <span className="skeleton mt-2 block h-3 w-[42px] shrink-0" />
            <span className="skeleton block h-14 flex-1 rounded-[var(--radius-control)]" />
          </div>
        ))}
      </div>
    </div>
  )
}
