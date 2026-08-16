'use client'

import Link from 'next/link'
import { useT } from '@/lib/i18n/client'

// Каркас экрана приложения. Один на все экраны входа и регистрации,
// потому что расхождение между ними человек замечает мгновенно:
// кнопка «назад» на два пикселя ниже — и вид дешевеет.
//
// Устройство нативного экрана: полоса навигации сверху (стрелка слева),
// крупный заголовок, подпись, содержимое. Никакого логотипа-ссылки
// на сайт, никакого переключателя темы, никаких «Крок 2 із 3».

export function AppScreen({
  title,
  subtitle,
  onBack,
  backHref,
  children,
}: {
  title: string
  subtitle?: string
  /** Назад внутри экрана — например, с кода обратно к форме. */
  onBack?: () => void
  /** Назад на другой экран. Если не задано ни то, ни другое — стрелки нет. */
  backHref?: string
  children: React.ReactNode
}) {
  const t = useT()
  return (
    // m-scroll — прокручиваемая область экрана. Класс не косметический:
    // пока печатают, к нему снизу добавляется запас в три четверти
    // экрана, иначе последнее поле физически некуда поднять над
    // клавиатурой. Правило в globals.css.
    <main className="m-scroll flex flex-1 flex-col px-6 pb-8">
      <div className="flex items-center" style={{ height: 56, marginLeft: -10 }}>
        {onBack ? (
          <button type="button" onClick={onBack} aria-label={t('m.nav.back.aria')} className="navback">
            <BackArrow />
          </button>
        ) : backHref ? (
          <Link href={backHref} aria-label={t('m.nav.back.aria')} className="navback">
            <BackArrow />
          </Link>
        ) : null}
      </div>

      <h1 className="display t-2xl mt-2">{title}</h1>
      {subtitle && (
        <p className="t-md mt-2" style={{ color: 'var(--color-muted)', lineHeight: 1.5 }}>
          {subtitle}
        </p>
      )}

      <div className="mt-7">{children}</div>
    </main>
  )
}

function BackArrow() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  )
}

// Подпись + поле + место под ошибку одним блоком: иначе при появлении
// ошибки форма подпрыгивает и палец промахивается по кнопке.
export function Field({
  label,
  htmlFor,
  className = '',
  children,
}: {
  label: string
  htmlFor?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={className}>
      <label className="field-label" htmlFor={htmlFor}>{label}</label>
      {children}
    </div>
  )
}

// Поднять поле к верхней кромке экрана при фокусе.
//
// block: 'start', а НЕ 'center'. Центр — это середина той высоты,
// которую браузер считает видимой; в веб-вью он считает её неправильно
// и «центрирует» поле ровно под клавиатуру. Верхняя кромка не зависит
// ни от каких измерений: выше неё клавиатуры не бывает.
//
// Отступ сверху даёт scroll-margin-top в globals.css — иначе подпись
// поля срезается краем экрана.
//
// Дважды: сразу и ещё раз через 420 мс. Клавиатура выезжает примерно
// треть секунды, и первый расчёт делается по старой высоте экрана.
export function keepVisible(e: React.FocusEvent<HTMLInputElement>) {
  const el = e.currentTarget
  const up = () => el.scrollIntoView({ block: 'start', behavior: 'smooth' })
  setTimeout(up, 60)
  setTimeout(up, 420)
}
