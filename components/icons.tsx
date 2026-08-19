// Иконки оболочки — инлайновым SVG, одним файлом.
//
// Почему не шрифт и не библиотека: пакетов в сборку не добавляем
// (реестр закрыт, и лишние 300 КБ ради восьми картинок — плохая сделка),
// а текстовые символы вроде «▦» рисуются в каждой системе по-своему
// и на телефоне выглядят как сбой шрифта. Здесь линия толщиной 1.75
// и currentColor, поэтому иконка красится тем же цветом, что и подпись,
// и одинакова в светлой и тёмной теме.

type P = { size?: number; className?: string }

const base = (size: number) => ({
  width: size, height: size, viewBox: '0 0 24 24',
  fill: 'none', stroke: 'currentColor', strokeWidth: 1.75,
  strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
  'aria-hidden': true,
})

/** Коробка — склад. */
export function IconBox({ size = 22, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M21 8l-9-5-9 5 9 5 9-5z" />
      <path d="M3 8v8l9 5 9-5V8" />
      <path d="M12 13v8" />
    </svg>
  )
}

/** Календарь — записи. */
export function IconCalendar({ size = 22, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="3" y="5" width="18" height="16" rx="2.5" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  )
}

/** Ножницы — услуги. */
export function IconScissors({ size = 22, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="6" cy="6" r="2.6" />
      <circle cx="6" cy="18" r="2.6" />
      <path d="M8.1 7.9L20 20M20 4L8.1 16.1" />
    </svg>
  )
}

/** Человек — профиль. */
export function IconUser({ size = 22, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.5 20c1.4-3.4 4.2-5 7.5-5s6.1 1.6 7.5 5" />
    </svg>
  )
}

/** Лупа — поиск. */
export function IconSearch({ size = 20, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </svg>
  )
}

/** Рамка сканера — камера с прицелом. */
export function IconScan({ size = 20, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4 8.5V6.5A2.5 2.5 0 016.5 4h2M15.5 4h2A2.5 2.5 0 0120 6.5v2M20 15.5v2a2.5 2.5 0 01-2.5 2.5h-2M8.5 20h-2A2.5 2.5 0 014 17.5v-2" />
      <path d="M7.5 12h9" />
    </svg>
  )
}

/** Домик — «Сьогодні». */
export function IconHome({ size = 22, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4 10.5L12 4l8 6.5" />
      <path d="M5.5 9.8V19a1 1 0 001 1h11a1 1 0 001-1V9.8" />
    </svg>
  )
}

/** Галочка в круге — журналы. */
export function IconCheck({ size = 22, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.5 12.3l2.4 2.4 4.6-4.9" />
    </svg>
  )
}

/** Лист — документы и техкарты. */
export function IconDoc({ size = 22, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M6 3.5h7.5L18 8v12.5a1 1 0 01-1 1H6a1 1 0 01-1-1v-16a1 1 0 011-1z" />
      <path d="M13.5 3.5V8H18M8.5 13h7M8.5 16.5h5" />
    </svg>
  )
}

/** Сетка — каталог. */
export function IconGrid({ size = 22, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="4" y="4" width="7" height="7" rx="1.6" />
      <rect x="13" y="4" width="7" height="7" rx="1.6" />
      <rect x="4" y="13" width="7" height="7" rx="1.6" />
      <rect x="13" y="13" width="7" height="7" rx="1.6" />
    </svg>
  )
}

/** Пакет — заказы. */
export function IconBag({ size = 22, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M5 8h14l-1 12H6L5 8z" />
      <path d="M9 8V6.5a3 3 0 016 0V8" />
    </svg>
  )
}

/** Два человека — клиенты. */
export function IconUsers({ size = 22, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="9.5" cy="8" r="3.2" />
      <path d="M3.5 19c1.2-2.9 3.5-4.3 6-4.3s4.8 1.4 6 4.3" />
      <path d="M16 5.2a3.2 3.2 0 010 5.6M17.5 14.9c1.5.6 2.7 1.9 3.4 3.6" />
    </svg>
  )
}

/** Купюра — финансы. */
export function IconMoney({ size = 22, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="3" y="6" width="18" height="12" rx="2.5" />
      <circle cx="12" cy="12" r="2.6" />
    </svg>
  )
}

/** Шестерня — магазин и настройки. */
export function IconGear({ size = 22, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 3.5v2.2M12 18.3v2.2M20.5 12h-2.2M5.7 12H3.5M18 6l-1.6 1.6M7.6 16.4L6 18M18 18l-1.6-1.6M7.6 7.6L6 6" />
    </svg>
  )
}

/** Стрелка назад. */
export function IconBack({ size = 22, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M15 18l-6-6 6-6" />
    </svg>
  )
}

/** Выход. */
export function IconExit({ size = 20, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M15 4.5h3a1 1 0 011 1v13a1 1 0 01-1 1h-3" />
      <path d="M10 8l-4 4 4 4M6 12h9" />
    </svg>
  )
}

/** Крестик. */
export function IconClose({ size = 20, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

/** Колокол — то, что требует внимания. */
export function IconBell({ size = 22, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M18 9.5a6 6 0 10-12 0c0 4.2-1.3 5.9-2 6.6-.3.3-.1.9.4.9h15.2c.5 0 .7-.6.4-.9-.7-.7-2-2.4-2-6.6z" />
      <path d="M10.2 20.2a2.2 2.2 0 003.6 0" />
    </svg>
  )
}

// ── Склад ───────────────────────────────────────────────────────
//
// Заведены 18.08.2026 вместе с переборкой экрана склада. До этого дня
// он рисовал состояния и разделы ТЕКСТОВЫМИ ЗНАКАМИ — «◫ ◷ ⊘ ⌄ ⌗ ⬓ ⇅ ☰».
// Ровно то, о чём предупреждает шапка этого файла: на телефоне владельца
// половина из них вышла квадратами и решётками, и счётчик «Прострочені»
// был подписан знаком, который читается как «нет глифа», а не как беда.
//
// Тон плитки несёт смысл (globals.css, `.stat-tile`), и значок обязан
// его повторять, а не спорить с ним: часы — «скоро», треугольник —
// «уже сломалось». Значок, выбранный по красоте, отменяет цвет.

/** Стопка — общее число позиций. */
export function IconLayers({ size = 22, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M12 3l9 4.5-9 4.5-9-4.5L12 3z" />
      <path d="M3 12.5l9 4.5 9-4.5" />
      <path d="M3 17l9 4.5 9-4.5" />
    </svg>
  )
}

/** Часы — срок ещё не вышел, но выйдет. */
export function IconClock({ size = 22, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 1.8" />
    </svg>
  )
}

/** Треугольник с восклицанием — срок вышел. */
export function IconAlert({ size = 22, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M12 4.2L21 19.5H3L12 4.2z" />
      <path d="M12 10v3.6M12 16.6h.01" />
    </svg>
  )
}

/** Стрелка вниз к черте — остаток у порога. */
export function IconLow({ size = 22, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M12 4v10M8 10.5l4 4 4-4" />
      <path d="M4.5 19.5h15" />
    </svg>
  )
}

/** Лоток со стрелкой внутрь — приёмка. */
export function IconInbox({ size = 22, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M3.5 13.5h4l1.5 2.5h6l1.5-2.5h4" />
      <path d="M5.5 5.5h13l2 8v4a1.5 1.5 0 01-1.5 1.5h-14A1.5 1.5 0 013.5 17.5v-4l2-8z" />
    </svg>
  )
}

/** Две стрелки — журнал движений. */
export function IconArrows({ size = 22, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M7.5 4.5v15M4 8l3.5-3.5L11 8" />
      <path d="M16.5 19.5v-15M13 16l3.5 3.5L20 16" />
    </svg>
  )
}

/** Планшет с зажимом — инвентаризация. */
export function IconClipboard({ size = 22, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M9 4.5H7a1.5 1.5 0 00-1.5 1.5v13A1.5 1.5 0 007 20.5h10a1.5 1.5 0 001.5-1.5V6A1.5 1.5 0 0017 4.5h-2" />
      <rect x="9" y="2.8" width="6" height="3.4" rx="1.2" />
      <path d="M8.8 12.5l1.8 1.8 3.6-3.6" />
    </svg>
  )
}

/** QR — наклейка на ёмкости. */
export function IconQr({ size = 22, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1.4" />
      <rect x="14" y="3.5" width="6.5" height="6.5" rx="1.4" />
      <rect x="3.5" y="14" width="6.5" height="6.5" rx="1.4" />
      <path d="M14 14h3v3h-3zM20.5 14v3M17.5 20.5h3" />
    </svg>
  )
}

/** Штрихкод — заводские коды. */
export function IconBarcode({ size = 22, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M3.5 6.5v11M7 6.5v11M10.5 6.5v11M14 6.5v11M17.5 6.5v11M20.5 6.5v11" />
    </svg>
  )
}

/** Колба — рецептура. */
export function IconBeaker({ size = 22, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M9.5 3.5v6L4.8 17.6A1.6 1.6 0 006.2 20h11.6a1.6 1.6 0 001.4-2.4L14.5 9.5v-6" />
      <path d="M8.5 3.5h7M7.4 14.5h9.2" />
    </svg>
  )
}

/** Замок — пароль і безпека. */
export function IconLock({ size = 22, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V7.5a4 4 0 018 0V11" />
    </svg>
  )
}

/** Конверт — пошта. */
export function IconMail({ size = 22, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
      <path d="M4 7l8 6 8-6" />
    </svg>
  )
}

/** Список — справочники. */
export function IconList({ size = 22, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M9 6.5h11M9 12h11M9 17.5h11" />
      <path d="M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01" />
    </svg>
  )
}

/** Стрелка вниз в лоток — скачать файл. */
export function IconDownload({ size = 20, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M12 4v10" />
      <path d="M8 10.5l4 4 4-4" />
      <path d="M4.5 19.5h15" />
    </svg>
  )
}

/** Плюс — добавить, развернуть. */
export function IconPlus({ size = 20, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

/** Минус — свернуть. */
export function IconMinus({ size = 20, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M5 12h14" />
    </svg>
  )
}

/** Наклейка с кодом — этикетка ёмкости. */
export function IconLabel({ size = 20, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4 5.5h16v13H4z" />
      <path d="M7.5 9v6M10.5 9v6M13.5 9v3.5M16.5 9v6" />
    </svg>
  )
}

/** Шеврон вправо — «внутри есть ещё». Только указатель, не кнопка. */
export function IconChevronRight({ size = 18, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  )
}

/** Цінник — ціна позиції в каталозі. Не «наклейка» (`IconLabel`): та
 *  говорит о коде на банке, эта — о деньгах, и путать их нельзя. */
export function IconTag({ size = 20, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M11.6 3.5H5a1.5 1.5 0 0 0-1.5 1.5v6.6a1.5 1.5 0 0 0 .44 1.06l7 7a1.5 1.5 0 0 0 2.12 0l6.6-6.6a1.5 1.5 0 0 0 0-2.12l-7-7a1.5 1.5 0 0 0-1.06-.44Z" />
      <circle cx="8" cy="8" r="1.1" />
    </svg>
  )
}

/** Лійка — фільтри та сортування списку. */
export function IconFilter({ size = 20, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4 6.5h16M7 12h10M10 17.5h4" />
    </svg>
  )
}
