import type { Metadata } from 'next'

// Оболочка мобильного приложения. Сюда указывает capacitor.config.ts,
// и это НЕ страницы сайта: ни шапки, ни переключателя темы, ни ссылки
// «на головну» — в приложении их быть не должно.
//
// Общая логика (Supabase, права, серверные действия) та же самая, что в вебе.
// Различается только раскладка — ровно как требует правило проекта
// «общий слой вместо паритета».
export const metadata: Metadata = {
  title: 'Маркет',
  // Приложение не масштабируется жестами: это не веб-страница.
  // viewport-fit=cover нужен, чтобы контент уходил под вырез, а отступы
  // задавались через env(safe-area-inset-*), а не гадались.
}

export const viewport = {
  themeColor: '#141417',
  viewportFit: 'cover' as const,
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

export default function MobileLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex flex-col"
      style={{
        minHeight: '100dvh',
        background: 'var(--color-bg)',
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        // Свайп-назад по краю экрана не должен выделять текст.
        WebkitUserSelect: 'none',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      {children}
    </div>
  )
}
