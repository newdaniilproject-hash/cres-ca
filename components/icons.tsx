// Иконки оболочки — инлайновым SVG, одним файлом.
//
// Почему не шрифт и не библиотека: пакетов в сборку не добавляем
// (реестр закрыт, и лишние 300 КБ ради восьми картинок — плохая сделка),
// а текстовые символы вроде «▦» рисуются в каждой системе по-своему
// и на телефоне выглядят как сбой шрифта. Здесь линия толщиной 1.75
// и currentColor, поэтому иконка красится тем же цветом, что и подпись,
// и одинакова в светлой и тёмной теме.

import { ICON_GRID, ICON_SHAPES, ICON_STROKE } from '@/shared/icon-paths'

type P = { size?: number; className?: string }

const base = (size: number) => ({
  width: size, height: size, viewBox: `0 0 ${ICON_GRID} ${ICON_GRID}`,
  fill: 'none', stroke: 'currentColor', strokeWidth: ICON_STROKE,
  strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
  'aria-hidden': true,
})

// ── Значки, геометрия которых лежит в общем слое ────────────────────────────
//
// На эти имена ссылается реестр модулей (`public.modules.icon`), и ровно
// их же рисует мобильное приложение. Числа — в `shared/icon-paths.ts`;
// разъехаться веб и телефон физически не могут, потому что читают один
// файл. Остальные значки ниже остались разметкой: телефон их не рисует,
// и переносить «заодно» незачем.
function Shaped({ name, size = 22, className }: P & { name: string }) {
  return (
    <svg {...base(size)} className={className}>
      {(ICON_SHAPES[name] ?? []).map((sh, i) =>
        sh.k === 'path'
          ? <path key={i} d={sh.d} />
          : sh.k === 'circle'
            ? <circle key={i} cx={sh.cx} cy={sh.cy} r={sh.r} />
            : <rect key={i} x={sh.x} y={sh.y} width={sh.w} height={sh.h} rx={sh.rx} />,
      )}
    </svg>
  )
}

/** Коробка — склад. */
export function IconBox(p: P) {
  return <Shaped name="IconBox" {...p} />
}

/** Календарь — записи. */
export function IconCalendar(p: P) {
  return <Shaped name="IconCalendar" {...p} />
}

/** Ножницы — услуги. */
export function IconScissors(p: P) {
  return <Shaped name="IconScissors" {...p} />
}

/** Человек — профиль. */
export function IconUser(p: P) {
  return <Shaped name="IconUser" {...p} />
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
export function IconCheck(p: P) {
  return <Shaped name="IconCheck" {...p} />
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
export function IconBag(p: P) {
  return <Shaped name="IconBag" {...p} />
}

/** Два человека — клиенты. */
export function IconUsers(p: P) {
  return <Shaped name="IconUsers" {...p} />
}

/** Купюра — финансы. */
export function IconMoney(p: P) {
  return <Shaped name="IconMoney" {...p} />
}

/** Шестерня — магазин и настройки. */
export function IconGear(p: P) {
  return <Shaped name="IconGear" {...p} />
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

/** Стрелка по кругу — «повторити останнє». Не то же, что `IconArrows`:
 *  та про движение между местами, эта про повтор того же действия. */
export function IconRepeat({ size = 20, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4.5 12a7.5 7.5 0 0 1 12.8-5.3L20 9.5" />
      <path d="M20 4.5v5h-5" />
      <path d="M19.5 12a7.5 7.5 0 0 1-12.8 5.3L4 14.5" />
      <path d="M4 19.5v-5h5" />
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
