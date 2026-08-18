import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import { themeBootScript, ThemeNativeSync } from '@/components/theme'
import { nativeBootScript } from '@/components/native-boot'
import { langBootScript } from '@/lib/i18n/cookie'
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

// Заголовок и описание витрины НЕ переведены сознательно, и это не забытое
// место. Метаданные читает поисковик, а язык страницы для него определяется
// адресом, а не кукой: витрине нужен сегмент (`/uk`, `/ru`, `/en`) и `hreflang`,
// иначе один и тот же адрес отдаёт три разных описания и в индекс попадает
// случайное. Сегмент приезжает вместе с переделкой витрины (CLAUDE.md →
// «Внешний вид»), и вот тогда это становится `generateMetadata` с языком
// из сегмента. До тех пор украинский — язык витрины, и он же честный
// в выдаче.
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
  themeColor: '#f6f7f9',
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
        {/* Атрибут `lang` на <html> — тем же приёмом и по той же причине.
            Текст в кадре не мигает (кабинет рисуется на сервере, кука там
            уже прочитана), но статический `lang="uk"` ниже остался бы
            украинским при русском интерфейсе: по нему работают скринридер
            и переносы слов. Куку здесь не читаем нарочно — `cookies()`
            в корневом макете сделал бы динамической всю витрину. */}
        <script dangerouslySetInnerHTML={{ __html: langBootScript }} />
      </head>
      <body>
        {/* Уведомления, состояние связи и предложение установки живут
            в одном нижнем стеке и доступны с любого экрана. Правило,
            ради которого это здесь: у любого действия виден исход,
            непонятных состояний быть не должно.

            ЯЗЫК этого стека приходит не отсюда: провайдер стоит внутри
            `components/toast.tsx`, вокруг самого стека, и берёт язык
            из `<html lang>`. Обернуть провайдером ВСЁ дерево здесь
            нельзя — тогда за кукой поехали бы и клиентские части
            витрины, а витрина закреплена на украинском до переезда
            на сегмент адреса (`components/shell.tsx` → `publicT`).
            Разбор решения целиком — в `lib/i18n/client.tsx`. */}
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
          {/* Статус-бар обёртки идёт за темой. Класс на <html> ставит
              загрузочный скрипт, а моста в тот момент ещё нет. */}
          <ThemeNativeSync />
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
