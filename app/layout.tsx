import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import { themeBootScript } from '@/components/theme'
import './globals.css'

// Один шрифт на весь интерфейс: заголовки теперь гротеском
// (--font-heading в globals.css), и серифная гарнитура больше нигде
// не выводится — грузить её значило бы платить за неиспользуемый файл.
const inter = Inter({
  subsets: ['latin', 'cyrillic'],
  variable: '--font-inter',
  display: 'swap',
})

export const metadata: Metadata = {
  title: { default: 'Маркетплейс товарів і послуг', template: '%s — Маркетплейс' },
  description:
    'Товари та послуги від українських підприємців: запис до майстрів, замовлення з доставкою, облік для продавця.',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Маркетплейс' },
}

export const viewport: Viewport = {
  // Совпадает с --color-bg: иначе шапка браузера на телефоне
  // другого цвета, чем страница, и это видно полосой.
  themeColor: '#141417',
  // viewportFit: содержимое заходит под вырез и системный индикатор,
  // а отступы возвращаются точечно через env(safe-area-inset-*).
  // Зум НЕ блокируем: user-scalable=no — нарушение доступности.
  viewportFit: 'cover',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uk" className={inter.variable} suppressHydrationWarning>
      <head>
        {/* Класс темы ставится синхронно, до первой отрисовки:
            иначе виден кадр с чужим фоном. */}
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body>{children}</body>
    </html>
  )
}
