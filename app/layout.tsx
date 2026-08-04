import type { Metadata, Viewport } from 'next'
import { Inter, Source_Serif_4 } from 'next/font/google'
import { themeBootScript } from '@/components/theme'
import './globals.css'

const inter = Inter({
  subsets: ['latin', 'cyrillic'],
  variable: '--font-inter',
  display: 'swap',
})

const serif = Source_Serif_4({
  subsets: ['latin', 'cyrillic'],
  variable: '--font-serif',
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
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#faf8f5' },
    { media: '(prefers-color-scheme: dark)', color: '#12100e' },
  ],
  // viewportFit: содержимое заходит под вырез и системный индикатор,
  // а отступы возвращаются точечно через env(safe-area-inset-*).
  // Зум НЕ блокируем: user-scalable=no — нарушение доступности.
  viewportFit: 'cover',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uk" className={`${inter.variable} ${serif.variable}`} suppressHydrationWarning>
      <head>
        {/* Класс темы ставится синхронно, до первой отрисовки:
            иначе виден кадр с чужим фоном. */}
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body>{children}</body>
    </html>
  )
}
