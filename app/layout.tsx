import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import { themeBootScript } from '@/components/theme'
import { nativeBootScript } from '@/components/native-boot'
import { ToastProvider } from '@/components/toast'
import { OfflineBar } from '@/components/offline'
import { KeyboardFit } from '@/components/keyboard-fit'
import { NotifyBanner } from '@/components/banner'
import { NativeProvider } from '@/components/native'
import { PwaProvider } from '@/components/pwa'
import { SwipeBack } from '@/components/swipe-back'
import { NativeFeel } from '@/components/native-feel'
import { DeepLink } from '@/components/deep-link'
import './globals.css'

// Один шрифт на весь интерфейс: заголовки теперь гротеском
// (--font-heading в globals.css), и серифная гарнитура больше нигде
// не выводится — грузить её значило бы платить за неиспользуемый файл.
const inter = Inter({
  subsets: ['latin', 'cyrillic'],
  variable: '--font-inter',
  display: 'swap',
})

// Тайтлы вкладок: имя продукта — CRESKO. Шаблон «%s — CRESKO» подставляется
// ко всем экранам кабинета, у которых свой title («Склад — CRESKO»).
// Заголовок публичной витрины задан у неё absolute (app/page.tsx) и это
// изменение его не касается: имя витрины — отдельное решение владельца.
export const metadata: Metadata = {
  title: { default: 'CRESKO — склад для майстрів', template: '%s — CRESKO' },
  description:
    'Товари та послуги від українських підприємців: запис до майстрів, замовлення з доставкою, облік для продавця.',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'CRESKO' },
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
        {/* И признак приложения — тоже до первой отрисовки, иначе виден
            кадр с боковым меню и переключателем темы. */}
        <script dangerouslySetInnerHTML={{ __html: nativeBootScript }} />
      </head>
      <body>
        {/* Уведомления, состояние связи и предложение установки живут
            в одном нижнем стеке и доступны с любого экрана. Правило,
            ради которого это здесь: у любого действия виден исход,
            непонятных состояний быть не должно. */}
        <ToastProvider overlay={<><NativeProvider /><PwaProvider /><OfflineBar /></>}>
          {/* Сквозные, поэтому подключаются один раз в корне.
              KeyboardFit  — высота клавиатуры в переменную --kb;
                             считает через visualViewport, то есть
                             работает и в обычном браузере.
              SwipeBack    — жест «назад» от левого края (только в обёртке).
              NotifyBanner — уведомление при открытой вкладке.
              NativeFeel   — мелкие нативные повадки (только в обёртке). */}
          <KeyboardFit />
          <SwipeBack />
          <NotifyBanner />
          <NativeFeel />
          {/* Глубокие ссылки: возврат от Apple и Google, тап по пушу,
              ссылка на товар, присланная в мессенджере. Один обработчик
              на всё приложение — иначе на одном экране ссылка открывает
              нужное, а на другом ничего не делает.

              ВНИМАНИЕ, оплачено отказом 05.08.2026: getLaunchUrl при
              удалённом server.url отдаёт САМ server.url, а не глубокую
              ссылку. Пропустить её дальше = вечный цикл перезагрузок
              и убитый WKWebView на ВСЕХ сборках сразу. Фильтр
              по схеме cresca: внутри deep-link.tsx снимать нельзя. */}
          <DeepLink />
          {children}
        </ToastProvider>
      </body>
    </html>
  )
}
