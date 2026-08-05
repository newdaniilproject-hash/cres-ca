'use client'

import Link from 'next/link'

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
  return (
    // Экран прокручивается целиком: при поднятой клавиатуре видимая
    // высота падает вдвое, и без прокрутки нижние поля недостижимы.
    <main
      className="flex flex-1 flex-col px-6 pb-8"
      style={{ overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}
    >
      <div className="flex items-center" style={{ height: 56, marginLeft: -10 }}>
        {onBack ? (
          <button type="button" onClick={onBack} aria-label="Назад" className="navback">
            <BackArrow />
          </button>
        ) : backHref ? (
          <Link href={backHref} aria-label="Назад" className="navback">
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

// Клавиатура съедает половину экрана, и поле под ней человек набирает
// вслепую. Задержка — пока клавиатура выезжает: без неё браузер
// считает высоту по старому экрану и подтягивает не туда.
export function keepVisible(e: React.FocusEvent<HTMLInputElement>) {
  const el = e.currentTarget
  setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 250)
}
