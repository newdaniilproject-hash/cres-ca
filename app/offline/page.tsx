export const metadata = { title: 'Немає мережі' }

// Страница, которую service worker отдаёт вместо пустого экрана,
// когда сети нет и в кеше ничего подходящего не нашлось.
// Её задача — не извиниться, а сказать, что делать дальше.
export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-12">
      <p className="eyebrow">Звʼязок</p>
      <h1 className="display mt-3 t-3xl">Немає мережі</h1>
      <p className="t-md mt-4 leading-relaxed prose-muted">
        Сторінка, яку ви відкрили, ще не збережена на телефоні. Ті екрани,
        якими ви вже користувалися, відкриються й без мережі.
      </p>
      <p className="t-md mt-3 leading-relaxed prose-muted">
        Усе, що ви робили офлайн — відкриття банок, списання, записи
        в журналах — збережено на телефоні й піде в базу автоматично,
        щойно звʼязок відновиться. Нічого не загубиться.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <a href="/app/inventory" className="btn-primary">Відкрити склад</a>
        <a href="/app" className="btn-secondary">На головну кабінету</a>
      </div>
    </main>
  )
}
