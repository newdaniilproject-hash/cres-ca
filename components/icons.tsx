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

/** Щит — «дані під контролем», «без картки». */
export function IconShield({ size = 20, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M12 3l7 3v5.5c0 4.2-2.9 7.6-7 9.5-4.1-1.9-7-5.3-7-9.5V6l7-3z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  )
}

/** Молния — автоматизация, «без зайвої рутини». */
export function IconBolt({ size = 20, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M13 2L5 13h6l-1 9 8-11h-6l1-9z" />
    </svg>
  )
}

/** Гарнитура — поддержка на старте. */
export function IconSupport({ size = 20, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4 13v-1a8 8 0 0116 0v1" />
      <rect x="2.5" y="13" width="4" height="6" rx="1.6" />
      <rect x="17.5" y="13" width="4" height="6" rx="1.6" />
      <path d="M19.5 19v.5a2.5 2.5 0 01-2.5 2.5h-3" />
    </svg>
  )
}

/** Треугольник воспроизведения. Заливкой, а не обводкой: у мелкого
    треугольника обводка читается как рамка, а не как кнопка. */
export function IconPlay({ size = 18, className }: P) {
  return (
    <svg {...base(size)} className={className} fill="currentColor" stroke="none">
      <path d="M8 5.2v13.6L19 12 8 5.2z" />
    </svg>
  )
}

/** Стрелка вправо — переход в кнопке. */
export function IconArrowRight({ size = 18, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M5 12h13M13 6.5l5.5 5.5L13 17.5" />
    </svg>
  )
}

/** Портфель — малый бизнес. */
export function IconBriefcase({ size = 22, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="3" y="7.5" width="18" height="12.5" rx="2.5" />
      <path d="M9 7.5V6a2 2 0 012-2h2a2 2 0 012 2v1.5" />
      <path d="M3 13h18" />
    </svg>
  )
}

/** Колокол — уведомления. */
export function IconBell({ size = 20, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M18 9a6 6 0 10-12 0c0 4-1.5 5.5-2 6.5h16c-.5-1-2-2.5-2-6.5z" />
      <path d="M10 19a2 2 0 004 0" />
    </svg>
  )
}

/** Шеврон вниз — раскрывающееся меню. */
export function IconChevron({ size = 16, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M6 9.5l6 6 6-6" />
    </svg>
  )
}

/** Глобус — публичная страница заведения. */
export function IconGlobe({ size = 20, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.6 2.5 15.4 0 18-2.5-2.6-2.5-15.4 0-18z" />
    </svg>
  )
}

/** Плюс — добавить. */
export function IconPlus({ size = 20, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

/** Три точки — прочие действия строки. */
export function IconMore({ size = 20, className }: P) {
  return (
    <svg {...base(size)} className={className} fill="currentColor" stroke="none">
      <circle cx="5.5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="18.5" cy="12" r="1.6" />
    </svg>
  )
}

/** Стрелка вверх из ящика — выгрузка. */
export function IconExport({ size = 20, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M12 15V3M8 7l4-4 4 4" />
      <path d="M4 14v4a2 2 0 002 2h12a2 2 0 002-2v-4" />
    </svg>
  )
}

/** Треугольник с восклицанием — предупреждение. */
export function IconAlert({ size = 20, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M12 4.5L2.8 20h18.4L12 4.5z" />
      <path d="M12 10v4.5M12 17.2v.01" />
    </svg>
  )
}

/** Часы — сроки и напоминания. */
export function IconClock({ size = 20, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5.2l3.2 2" />
    </svg>
  )
}

/** Круговая диаграмма — аналитика и отчёты. */
export function IconChart({ size = 20, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M12 3a9 9 0 109 9h-9V3z" />
      <path d="M15.5 3.6A9 9 0 0120.4 8.5H15.5V3.6z" />
    </svg>
  )
}
