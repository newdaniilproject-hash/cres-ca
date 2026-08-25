'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { MaterialForm, type RefItem } from './material-form'
import { ContainerForm, type BatchOption } from './container-form'
import { RefsForm } from './refs-form'
import { movementLabel } from './movements/movements-client'
import { Sheet } from '@/components/sheet'
import { QuickFab, type QuickAction } from '@/components/quick-fab'
import { SwipeRow, type SwipeAction } from '@/components/swipe-row'
import { enqueue, isNetworkError } from '@/lib/offline/queue'
import { useToast } from '@/components/toast'
import { useT } from '@/lib/i18n/client'
import { dbErrorText } from '@/lib/errors/db'
import type { Key } from '@/lib/i18n/dict'
import { EXPIRY_BADGE, type ExpiryState, expiryState } from '@/lib/expiry'
import { Scanner } from '@/components/scanner'
import {
  IconAlert, IconArrows, IconBarcode, IconBeaker, IconBox, IconCheck,
  IconChevronRight, IconClipboard, IconClock, IconClose, IconBag, IconInbox,
  // `IconPlus` и `IconScan` здесь больше не нужны: плюс рисует сама
  // плавающая кнопка, а сканирование уехало из стоса действий в шапку,
  // где оно и было (25.08.2026). Камера при этом никуда не делась —
  // её по-прежнему открывает `?scan=1` и значок шапки.
  IconLayers, IconList, IconLow, IconMinus, IconQr,
} from '@/components/icons'

type Container = {
  id: string; code: string; status: string; useBy: string | null
  openedAt: string | null; volume: number | null; unit: string | null
  material: string; materialId: string
}
type Material = {
  id: string; name: string; unit: string; stock: number; threshold: number
  cosmetic: boolean; pao: number | null; brand: string | null
  sku: string | null; batch: string | null; expiry: string | null
  /** Фото засоба (0111). Пусто — рисуем значок, а не серый прямоугольник. */
  imagePath: string | null
  /** Колонки таблицы CRESKO Web §8: Категорія · Склад · Собівартість. */
  category: string | null
  cost: number | null
  locationId: string | null
}
type Variant = {
  id: string; name: string; title: string; stock: number; reserved: number
  threshold: number; unit: string; tracked: boolean
  /** Позиция каталога — по ней строка ведёт в карточку товара. */
  offeringId: string
  category: string | null
  cost: number | null
}
type ScanHit = {
  kind: string; id: string; title: string; subtitle: string | null
  stock_qty: number; location: string | null; low_stock: boolean
  /** У варианта — карточка каталога; у засоба null (0117). */
  offering_id: string | null
}
type ContainerHit = {
  id: string; material: string; code: string; status: string
  use_by: string | null; days_left: number | null; expired: boolean
}
/** Строка журнала для правой рейки CRESKO Web (последние движения). */
type Movement = {
  id: string; type: string; qty: number; unit: string
  title: string; createdAt: string
}

// Цвет движения для рейки — ТЕМ ЖЕ смыслом, что `movementBadge` на экране
// «Рухи»: зелёное — остаток вырос, красное — ушёл, жёлтое — расхождение.
// Здесь текстом, а не плашкой: в колонке 268px бейдж на каждой строке —
// шум, а не акцент. Разойтись с movementBadge эта карта может только
// вместе с enum `stock_movement_type` — тогда править обе.
const MOVE_INK: Record<string, string> = {
  receipt: 'var(--color-success)',
  return: 'var(--color-success)',
  transfer_in: 'var(--color-success)',
  sale: 'var(--color-danger)',
  write_off: 'var(--color-danger)',
  transfer_out: 'var(--color-danger)',
  adjustment: 'var(--color-warn)',
}

// Цвета полосок «Топ категорії за вартістю» (§8). Это ПОРЯДКОВЫЙ
// набор, а не палитра категорий: у категории склада своего цвета нет
// нигде в продукте, и заводить его здесь значило бы завести второй
// источник правды о том, каким цветом рисуется «Манікюр».
const BAR_TONE = [
  'var(--tone-blue)', 'var(--tone-violet)', 'var(--tone-emerald)', 'var(--tone-amber)',
]

type Tab = 'all' | 'materials' | 'containers' | 'goods'
/** Состояние, по которому отфильтрован список. Задаётся плиткой-счётчиком. */
type Flag = 'all' | 'ok' | 'soon' | 'expired'

// Подпись состояния срока — из словаря, а не из `lib/expiry.ts`.
// Само состояние там и остаётся: пороги (14 и 7 дней) — правило склада,
// одно на экран, письмо и наклейку. Переводится только подпись.
//
// Карта одна на весь раздел (её же читают карточка засоба и контроль
// вскрытия): вторая копия разъехалась бы на первом новом состоянии.
export const EXPIRY_KEY: Record<ExpiryState, Key> = {
  none: 'inventory.expiry.none',
  ok: 'inventory.expiry.ok',
  soon: 'inventory.expiry.soon',
  urgent: 'inventory.expiry.urgent',
  expired: 'inventory.expiry.expired',
}

// ── Экран склада ────────────────────────────────────────────────────────────
//
// Переборка 18.08.2026. Отзыв владельца о прежней версии дословно:
// «много дубляжа и не нужного». Дубляж был не на глаз, а буквальный —
// одно и то же действие лежало на экране по два и по три раза:
//
//   поиск   — строка в шапке оболочки (`?q=`) И своё поле на странице;
//   сканер  — значок в шапке (`?scan=1`), плитка «Сканувати» И синяя
//             кнопка рядом со вторым полем. Три входа в одну камеру;
//   пусто   — «Розхідники» и «Ємності» рисовали КАЖДЫЙ свою карточку
//             пустого состояния, и на новом заведении экран состоял
//             из двух почти одинаковых карточек во весь рост;
//   разделы — четыре плитками сверху, четыре тусклыми ссылками внизу
//             (под нижней панелью, то есть наполовину недоступными)
//             и «Довідники» отдельной кнопкой в ряду фильтров.
//
// ⚠️ ПОИСКА НА ЭТОМ ЭКРАНЕ БОЛЬШЕ НЕТ (решение владельца 19.08.2026:
// «пусть в хедере будет один единый поиск по всему... а на самих экранах
// поля поиска не будет»). Поле уехало не «обратно в шапку»: в шапке
// теперь ОДИН поиск на весь кабинет — по расходникам, каталогу, клиентам
// и заказам сразу (`components/global-search.tsx`). Своё поле искало
// только по складу, то есть требовало сначала угадать раздел. Фильтры
// состояния («Дійсні», «Закінчуються», «Прострочені») остались здесь:
// это не поиск, а вопрос «что горит» — он про этот экран и только про
// него. Не возвращать поле «заодно»: два поиска в одном продукте
// расходятся правилами в первый же месяц.
//
// Ряд фильтров при этом смешивал три разных вещи в один список кружков:
// фильтры («Всі», «Розхідники»), переход в шторку («Довідники») и
// создание («+ Засіб»). На 390px он переносился на две строки, и «+ Засіб»
// вставал под «Товари» — читалось как ещё один фильтр.
//
// ── ЧТО ТЕПЕРЬ И ПОЧЕМУ ─────────────────────────────────────────────────────
//
// Порядок сверху вниз отвечает на вопросы мастера в том порядке, в каком
// он их задаёт: «що я щойно відсканував» → «що горить» → «покажи це» →
// список. Всё остальное — ниже списка.
//
//   1. Результат сканирования. Появляется ТОЛЬКО после скана, первым,
//      с кнопками действия («Вдкрити банку»). Это ответ на вопрос,
//      с которым человек подошёл к экрану с банкой в руке.
//   2. Счётчики. Они же ФИЛЬТР, и это главная содержательная правка:
//      раньше «Прострочені: 3» было мёртвым числом — экран сообщал беду
//      и не давал способа её увидеть. Теперь нажатие на плитку оставляет
//      в списке ровно эти три позиции.
//   3. Вкладки по виду записи — одной строкой, с горизонтальной
//      прокруткой вместо переноса.
//   4. Список. Одно пустое состояние на весь экран, а не по одному
//      на секцию.
//   5. «Ще у складі» — ВСЕ остальные экраны раздела одной картой,
//      внизу и в одном месте.
//
// ── ПРАВКА 18.08.2026 ПО ПРОТОТИПУ CRESKO ───────────────────────────────────
//
// Владелец передал кликабельный прототип: «самый близкий визуал что я хотел,
// от него плясать будем». Что он изменил в этом экране:
//
//   • СЧЁТЧИКИ БЕЗ ЗНАЧКОВ. Крупное цветное число и мелкая подпись
//     (`.metric`): четыре плитки со значками съедали треть первого экрана;
//   • «ШВИДКІ ДІЇ» — ряд цветных плиток, уезжающий вбок. Это вход
//     в операции склада, и в прототипе он стоит сразу под счётчиками;
//   • СПИСОК — ОТДЕЛЬНЫЕ КАРТОЧКИ с миниатюрой слева (`.list-card`),
//     а не одна карточка с разделителями. У строки три уровня текста
//     плюс метка состояния, и в сплошном списке они слипаются.
//
// Почему разделы уехали ВНИЗ, а не остались плитками сверху. Приёмка,
// справочники и документы — работа администратора за столом, а не мастера
// у кресла (это же записано в CLAUDE.md про офлайн: приёмка намеренно
// оставлена вне очереди). Держать их первым экраном значит отдавать
// первый экран тому, кто заходит сюда раз в неделю.
export function InventoryClient({
  tenantId, userId, containers, materials, variants, totals,
  suppliers, locations, batches, initialScan, movements, hasCatalog,
}: {
  /** Пришло с кнопки сканера в шапке (?scan=1). */
  initialScan: boolean
  /**
   * Есть ли у заведения модуль «Послуги і товари».
   *
   * Вкладка «Товари» и кнопка «Додати в каталог» ведут в ЧУЖОЙ модуль.
   * У заведения, которое купило только склад, они открывали экран
   * «модуль вимкнено» — человек читает это как поломку, а не как
   * «мне сюда нельзя» (то же правило, что и с пунктами панели:
   * нет модуля — нет кнопки, а не кнопка с отказом).
   */
  hasCatalog: boolean
  tenantId: string
  userId: string
  containers: Container[]
  materials: Material[]
  variants: Variant[]
  totals: { units: number; cost: number; retail: number } | null
  suppliers: RefItem[]
  locations: RefItem[]
  batches: BatchOption[]
  /** Последние движения журнала — для правой рейки на lg+. */
  movements: Movement[]
}) {
  const t = useT()
  const supabase = useMemo(() => createClient(), [])
  const photoUrl = (p: string) => supabase.storage.from('media').getPublicUrl(p).data.publicUrl
  const router = useRouter()
  const toast = useToast()
  const [tab, setTab] = useState<Tab>('all')
  const [flag, setFlag] = useState<Flag>('all')
  // Формы раскрываются шторкой снизу, а не блоком на странице: на телефоне
  // раздвигающийся блок уводит список вниз, и мастер теряет место, где был.
  const [adding, setAdding] = useState<'material' | 'container' | 'refs' | 'move' | null>(null)
  const [manual, setManual] = useState(false)
  const [code, setCode] = useState('')
  const [scan, setScan] = useState<{ item?: ScanHit; container?: ContainerHit; miss?: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [moveBusy, setMoveBusy] = useState(false)
  const [camera, setCamera] = useState(initialScan)
  const inputRef = useRef<HTMLInputElement>(null)
  // Разбивка запаса — ВЕРХНЕЙ шторкой. Снизу открывается то, что человек
  // делает, сверху — то, что смотрит и закрывает, не уходя с экрана
  // (`components/sheet.tsx`, `side`).
  const [details, setDetails] = useState(false)
  // ── ОТКРЫТА РОВНО ОДНА ГРУППА ────────────────────────────────────────
  //
  // Требование владельца 25.08.2026: «при нажатии на один аккордеон
  // закрывается предыдущий», чтобы категории «не занимали полотно
  // целое». Поэтому хранится ОДИН открытый ключ, а не множество
  // закрытых: набор закрытых допускает состояние «открыто всё», ради
  // ухода от которого группы и заводились.
  //
  // Умолчание — закрыты все. Спокойный вид становится оглавлением
  // склада на один экран: «Потребує уваги» плюс список категорий
  // с числами. Это же снимает вопрос «далеко листать»: страница
  // перестала быть длинной.
  // Ключ раскрытой группы. Стартует с «Потребує уваги» (её ключ так и
  // называется): экран существует ради ответа «що горить», и прятать
  // этот ответ за нажатие значит отменить смысл экрана. Всё остальное
  // закрыто — это и есть требование «не занимать полотно целое».
  // Группы «Потребує уваги» может не быть вовсе (всё в порядке) —
  // тогда список начинается со свёрнутых категорий, и это верно:
  // сообщать нечего.
  const [openGroup, setOpenGroup] = useState<string | null>('attention')
  // Засіб, выбранный свайпом по строке: шторка переноса открывается уже
  // с ним. Иначе смысл жеста теряется — человек только что указал
  // пальцем на позицию, а форма спрашивает её заново.
  const [moveItem, setMoveItem] = useState<string>('')

  // ── Счётчики. Считаются по тем же порогам, что и рассылка, ──
  // иначе экран и письмо разойдутся: тут зелено, а письмо уже пришло.
  // Набор счётчиков — из README: Позицій · Дійсні · Закінч. · Прострочені.
  // «Дійсні» (а не «Мало на складі», как было) закрывает ряд по одной оси —
  // СРОК ГОДНОСТИ: сколько всего, сколько в порядке, сколько на исходе,
  // сколько просрочено, и четыре числа складываются в общее. Прежний
  // «Мало» мерил другую величину — остаток, — и в ряду из четырёх читался
  // как часть той же суммы, хотя ею не был.
  const stats = useMemo(() => {
    const items = [
      ...materials.map((m) => expiryState(m.expiry)),
      ...containers.map((c) => expiryState(c.useBy)),
    ]
    return {
      // «Позицій» — это ДЛИНА РЕЄСТРУ, а не всё что есть в разделе.
      // С 19.08.2026 спокойный вид «Всі» показывает только засоби, и число
      // обязано совпадать с подписью «Реєстр · N позицій» под ним: плитка
      // «9» над списком из шести читается как потерянные строки.
      // Состояния (Дійсні / Закінч. / Прострочені) при этом считают И банки
      // — у них выход есть: нажатие ставит фильтр, и банки появляются.
      total: materials.length,
      ok: items.filter((s) => s === 'ok').length,
      soon: items.filter((s) => s === 'soon' || s === 'urgent').length,
      expired: items.filter((s) => s === 'expired').length,
    }
  }, [materials, containers, variants])

  // ── Величины карточки-героя ──────────────────────────────────────────
  //
  // `hasValue` отвечает на вопрос «есть ли чему быть крупным числом».
  // Ноль вместо неизвестной цены — утверждение «запас ничего не стоит»,
  // и его никто не проверял: то же правило, по которому колонка «Сума»
  // в таблице печатает прочерк, а не ноль. Без собівартості крупным
  // идёт длина реєстру, а подпись называет, чего не хватает, — иначе
  // владелец видит «0 ₴» и считает, что сломан склад, а не что пустое
  // поле в карточках.
  const stockCost = totals != null && totals.cost > 0 ? totals.cost : null
  const hasValue = stockCost != null
  // ВЕСЬ реєстр, а не текущий вид: карточка-герой отвечает за склад
  // целиком, а «Реєстр · N позицій» под ней — за то, что видно сейчас.
  // Это та же величина, что печатает подвал таблицы на широком экране
  // («Показано 12 з 15»), и считается она здесь один раз на оба места.
  // Товары без модуля каталога не считаются: их нет ни в одном списке.
  const registryTotal =
    materials.length + containers.length + (hasCatalog ? variants.length : 0)
  // Знаменатель полосы состояний. Считается по тем же трём числам,
  // что и сама полоса: четвёртое («Позицій») — итог, а не доля.
  const stateTotal = stats.ok + stats.soon + stats.expired
  // Список, а не склеенная точками строка: две разные величины
  // (сколько позиций и сколько единиц) разносит ЗАЗОР в разметке —
  // то же решение, что в строке реєстру и в подзаголовке группы.
  const heroMeta: string[] = hasValue
    ? [
        t.plural('inventory.registry.count', registryTotal),
        totals != null && totals.units > 0
          ? t('inventory.hero.units', { n: t.number(totals.units) })
          : null,
      ].filter((x): x is string => Boolean(x))
    : [t('inventory.hero.noCost')]

  // Условие плитки. Собрано ОДНОЙ функцией на все три списка: развести её
  // по спискам значит завести три определения слова «прострочено».
  //
  // У ёмкости нет порога остатка, у товара нет срока — поэтому «Мало»
  // не показывает ёмкостей, а «Прострочені» не показывает товаров.
  // Это не пробел, а честный ответ: такого состояния у них не бывает.
  const passFlag = (state: ExpiryState) =>
    flag === 'all' ? true
      : flag === 'ok' ? state === 'ok'
        : flag === 'soon' ? (state === 'soon' || state === 'urgent')
          : state === 'expired'

  // ⚠️ ПРОБЛЕМНЫЕ ПОЗИЦИИ ВВЕРХ — требование README: «Проблемні позиції
  // сортуються вгору (expired → soon → ok)». Без этого просроченная банка
  // лежит там, куда её положил алфавит, и экран, который существует ради
  // ответа «що горить», прячет ответ в середину списка.
  const RANK: Record<ExpiryState, number> = {
    expired: 0, urgent: 1, soon: 2, ok: 3, none: 4,
  }
  const byProblem = <T,>(items: T[], state: (x: T) => ExpiryState) =>
    [...items].sort((a, b) => RANK[state(a)] - RANK[state(b)])

  const shownMaterials = byProblem(
    materials.filter((m) => passFlag(expiryState(m.expiry))),
    (m) => expiryState(m.expiry))
  const shownContainers = byProblem(
    containers.filter((c) => passFlag(expiryState(c.useBy))),
    (c) => expiryState(c.useBy))
  // У товара срока годности нет вовсе, поэтому он виден только без фильтра
  // состояния — «прострочених товарів» не бывает, и показывать их под этим
  // фильтром значило бы соврать о причине попадания в список.
  const shownVariants = flag === 'all' ? variants : []

  const showMaterials = tab === 'all' || tab === 'materials'
  // ⚠️ Решение владельца 19.08.2026: ёмкости в общем списке ПУТАЮТ —
  // «L'Oréal … Mask» стоит там дважды, засобом и вскрытой банкой, и это
  // читается как задвоение данных, а не как две разные сущности.
  //
  // Но вынести их из «Всі» насовсем нельзя: тем же днём записано, ради
  // чего список вообще плоский — чтобы просроченная банка не легла ниже
  // двадцати здоровых засобів. Экран существует ради ответа «що горить»,
  // и банка горит чаще всего: у неё срок считается от вскрытия.
  //
  // Поэтому банки уходят из СПОКОЙНОГО вида и остаются в тревожном:
  // без фильтра состояния «Всі» показывает только засоби (имена не
  // двоятся), а под «Прострочені» и «Закінчується» — и засоби, и банки.
  // Счётчики считают и то и другое, и это честно: нажатие на число
  // ставит фильтр, то есть у каждого числа есть выход.
  //
  // ⚠️ ПОПРАВКА 20.08.2026, вместе с группой «Потребує уваги». Правило
  // выше оставляло в спокойном виде ДЫРУ: горящая банка не показывалась
  // нигде, пока человек не сообразит нажать «Прострочені». То есть
  // группа, заведённая ради ответа «що горить», отвечала на него
  // не полностью — а именно у банки срок горит чаще всего.
  //
  // Теперь в спокойном виде банки показываются, но ТОЛЬКО горящие:
  // задвоения имён это не создаёт (здоровая банка по-прежнему не
  // показывается рядом со своим засобом), а ответ становится полным.
  const showContainers = tab === 'containers' || tab === 'all'
  // В спокойном виде «Всі» из банок остаются только те, что просят
  // внимания. На вкладке «Ємності» и под фильтром состояния — все,
  // прошедшие фильтр: там их и пришли смотреть.
  const calmView = tab === 'all' && flag === 'all'
  const isAttention = (s: ExpiryState) => s === 'expired' || s === 'urgent' || s === 'soon'
  const listedContainers = calmView
    ? shownContainers.filter((c) => isAttention(expiryState(c.useBy)))
    : shownContainers
  // ⚠️ Без модуля каталога товаров нет НИГДЕ, а не только на своей вкладке.
  // Вкладка «Товари» уже пряталась по `hasCatalog`, но вид «Всі» строки
  // товаров всё равно показывал — и каждая вела в `/app/catalog/<id>`,
  // то есть на экран «модуль вимкнено». Дверь в чужой модуль ПРЯЧЕТСЯ,
  // а не показывает отказ (CLAUDE.md → «Доступ: роли и модули»), и
  // прятать её надо там, где строится список, а не только в ленте вкладок.
  const showGoods = hasCatalog && (tab === 'all' || tab === 'goods')

  const visible =
    (showMaterials ? shownMaterials.length : 0)
    + (showContainers ? listedContainers.length : 0)
    + (showGoods ? shownVariants.length : 0)
  const filtered = flag !== 'all'
  const emptyTenant = stats.total === 0

  // ── Реєстр: ОДИН список, а не три секции ─────────────────────────────
  //
  // README: «Реєстр · N позицій» и под ним строки, проблемные вверху.
  // До 19.08.2026 список был разбит на «Розхідники», «Ємності», «Товари»
  // со своими надзаголовками, и сортировка «проблемные вверх» работала
  // ВНУТРИ каждой группы. Практический итог: просроченная банка лежала
  // ниже двадцати здоровых засобів — то есть экран, который существует
  // ради ответа «що горить», прятал ответ в середину.
  //
  // Вид записи никуда не делся: он и есть ось чипов выше, а в строке его
  // называет миниатюра (коробка — засіб, QR — банка, сумка — товар).
  const registry = [
    ...(showMaterials
      ? shownMaterials.map((m) => ({
          key: `m-${m.id}`, kind: 'material' as const, state: expiryState(m.expiry), m,
        }))
      : []),
    ...(showContainers
      ? listedContainers.map((c) => ({
          key: `c-${c.id}`, kind: 'container' as const, state: expiryState(c.useBy), c,
        }))
      : []),
    // У товара срока годности нет вовсе — он всегда в хвосте ранга.
    ...(showGoods
      ? shownVariants.map((v) => ({
          key: `v-${v.id}`, kind: 'goods' as const, state: 'none' as ExpiryState, v,
        }))
      : []),
  ].sort((a, b) => RANK[a.state] - RANK[b.state])

  // ── ГРУППЫ РЕЄСТРУ ───────────────────────────────────────────────────
  //
  // Бриф владельца 20.08.2026, П4: «список из ~90 позиций одним потоком,
  // без группировки, тяжело сканировать глазами» — группировать по
  // категориям с липкими подзаголовками.
  //
  // Но плоский список тоже был решением, и оно записано выше: экран
  // существует ради ответа «що горить», а в группах просроченная банка
  // ложится внутрь своей категории и снова тонет. Поэтому обе вещи
  // выполняются, а не одна вместо другой:
  //
  //   • «ПОТРЕБУЄ УВАГИ» — первая группа, собирает просроченное и
  //     истекающее ИЗ ВСЕХ категорий. Свернуть её нельзя: это ответ
  //     на главный вопрос экрана, а не раздел справочника;
  //   • дальше категории по алфавиту, «Без категорії» последней —
  //     иначе пустое поле продавца стояло бы во главе списка;
  //   • при наложенном фильтре состояния группировки НЕТ вовсе. Там
  //     весь список и есть один ответ, и делить его на подзаголовки
  //     значит спрятать шесть строк за тремя заголовками.
  //
  // ⚠️ СУММЫ В ПОДЗАГОЛОВКЕ ГРУППЫ БОЛЬШЕ НЕТ (25.08.2026). Она там
  // стояла без названия величины, и владелец спросил прямо: «почему
  // там вообще написаны суммы в гривнах». Вопрос справедливый —
  // это был ребус. Величина осталась там, где у неё есть заголовок:
  // «Топ категорії за вартістю» в разбивке запаса и колонка «Сума»
  // в таблице на широком экране. Обратно сюда не возвращать: подпись
  // группы отвечает на «разворачивать или нет», а на этот вопрос
  // отвечает число позиций, а не деньги.
  type Row = (typeof registry)[number]
  const rowCategory = (r: Row) =>
    r.kind === 'material' ? r.m.category
      : r.kind === 'goods' ? r.v.category
        : null

  // Не `useMemo`: `registry` пересобирается каждой отрисовкой (это обычная
  // константа), и запоминание по нему запоминало бы ничего, только
  // обещая обратное следующему читателю.
  const groups = buildGroups()
  function buildGroups() {
    const mk = (key: string, title: string, rows: Row[], pinned = false) =>
      ({ key, title, rows, pinned })
    // Фильтр состояния уже сам себе ответ — подзаголовки ему не нужны.
    if (flag !== 'all') return [mk('flat', '', registry)]

    const attention: Row[] = []
    const byCategory = new Map<string, Row[]>()
    for (const r of registry) {
      if (r.state === 'expired' || r.state === 'urgent' || r.state === 'soon') {
        attention.push(r)
        continue
      }
      // Ёмкость своей категории не имеет и иметь не может: она —
      // вскрытая банка материнского засоба. Отдельная группа честнее
      // прочерка, который читается как «не заполнено».
      const name = r.kind === 'container'
        ? t('inventory.tab.containers')
        : rowCategory(r) ?? ''
      const list = byCategory.get(name)
      if (list) list.push(r); else byCategory.set(name, [r])
    }

    const rest = [...byCategory.entries()]
      // Без категории — последней. Пустое поле продавца не имеет права
      // стоять во главе его же склада.
      .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
      .map(([name, rows]) =>
        mk(`c:${name}`, name || t('inventory.group.uncategorized'), rows))

    return attention.length > 0
      ? [mk('attention', t('inventory.group.attention'), attention, true), ...rest]
      : rest
  }

  // Короткая дата для плотных списков: «20 трав.». Через `t.date`,
  // а не своей сборкой — месяц называется на языке интерфейса.
  const short = (v: string | null | undefined) =>
    t.date(v, { day: 'numeric', month: 'short' })

  async function lookup(raw: string) {
    const s = raw.trim()
    if (!s) return
    setManual(false)
    setCode('')
    const [contRes, itemsRes] = await Promise.all([
      supabase.rpc('scan_container', { p_tenant_id: tenantId, p_code: s }),
      supabase.rpc('scan_lookup', { p_tenant_id: tenantId, p_code: s }),
    ])
    // Отказ базы — не «код не найдено». Раньше error игнорировался, и
    // пропавшая сеть или отобранное право выглядели как незнакомый код.
    if (contRes.error && itemsRes.error) {
      toast.error(t('inventory.scan.lookupError'), dbErrorText(t, contRes.error))
      return
    }
    const c = (contRes.data ?? [])[0] as ContainerHit | undefined
    const i = (itemsRes.data ?? [])[0] as ScanHit | undefined
    setScan(c ? { container: c } : i ? { item: i } : { miss: s })
  }

  // ── `?scan=1` ОТКРЫВАЕТ КАМЕРУ ────────────────────────────────────────
  //
  // Значок сканера в шапке ведёт сюда адресом `?scan=1`. До 18.08.2026 этот
  // признак лишь переключал строку в режим кода — камера не открывалась, а
  // кнопка камеры в этом режиме вообще не рисовалась. Человек нажимал значок
  // сканера и не видел НИЧЕГО: ни камеры, ни причины. Ровно это владелец
  // и сообщил как «сканер не отвечает» — и починка самого сканера (М27)
  // тут ничего не меняла, потому что до сканера дело не доходило.
  //
  // Признак снимается из адреса СРАЗУ: иначе повторное нажатие значка ведёт
  // на тот же адрес, компонент не перемонтируется, и второй раз камера
  // не откроется. `history.replaceState` вместо `router.replace` —
  // не хочется гонять серверный рендер ради очистки параметра.
  const sp = useSearchParams()
  useEffect(() => {
    if (sp.get('scan') !== '1') return
    setCamera(true)
    window.history.replaceState(null, '', '/app/inventory')
  }, [sp])

  // Курсор в поле ручного ввода — после того, как шторка отрисовалась.
  useEffect(() => {
    if (!manual) return
    const id = setTimeout(() => inputRef.current?.focus(), 60)
    return () => clearTimeout(id)
  }, [manual])

  // Смена статуса ёмкости — то самое действие, которое мастер делает
  // с банкой в руке в подвале без сети. Ошибка сети не роняет действие:
  // оно ложится в офлайн-очередь и уходит само при появлении связи
  // (пункт ТЗ про офлайн). Ошибка данных — честно показывается: класть
  // её в очередь бессмысленно, она не отправится никогда.
  async function setContainerStatus(
    id: string, containerCode: string,
    status: 'opened' | 'finished' | 'disposed',
    label: string,
  ) {
    setBusy(id)
    try {
      const { error } = await supabase.from('material_containers')
        .update({ status }).eq('id', id)
      if (error) throw new Error(error.message)
    } catch (e) {
      setBusy(null)
      if (isNetworkError(e)) {
        await enqueue(`${label} · ${containerCode}`, { kind: 'container.status', containerId: id, status })
        toast.info(t('inventory.offline.saved'), t('inventory.offline.desc'))
        return true
      }
      // Отказ базы — обезличенной подписью, не сырым текстом Postgres (М25).
      toast.error(t('inventory.container.saveError'), dbErrorText(t, e))
      return false
    }
    setBusy(null)
    return true
  }

  // Перемещение — функцией `relocate_stock` (0113), а не правкой
  // `location_id`: функция пишет след в журнал движений («кто, когда,
  // откуда и куда»), прямой UPDATE переносит банку молча.
  async function doRelocate(materialId: string, locationId: string, note: string) {
    setMoveBusy(true)
    const { error } = await supabase.rpc('relocate_stock', {
      p_material_id: materialId,
      p_location_id: locationId || null,
      p_note: note.trim() || null,
    })
    setMoveBusy(false)
    if (error) {
      // Отказ базы — обезличенной подписью, не сырым текстом Postgres (М25).
      toast.error(t('inventory.material.relocate.error'), dbErrorText(t, error))
      return
    }
    setAdding(null)
    toast.success(t('inventory.material.relocate.done'))
    router.refresh()
  }

  async function openContainer(id: string, containerCode: string) {
    const ok = await setContainerStatus(id, containerCode, 'opened', t('inventory.container.open'))
    if (!ok) return
    toast.success(t('inventory.container.opened.title'), t('inventory.container.opened.desc'))
    router.refresh()
    if (scan?.container?.id === id) void lookup(scan.container.code)
  }

  async function finishContainer(id: string, containerCode: string, disposed = false) {
    const ok = await setContainerStatus(
      id, containerCode,
      disposed ? 'disposed' : 'finished',
      disposed ? t('inventory.queue.dispose') : t('inventory.queue.finish'),
    )
    if (!ok) return
    setScan(null)
    router.refresh()
  }

  function switchTab(next: Tab) {
    setTab(next)
    setAdding(null)
  }

  // ── Главное действие экрана ──────────────────────────────────────────
  //
  // Одна плавающая кнопка вместо прежнего куста кнопок в ряду фильтров.
  // Подпись меняется вместе со вкладкой и всегда называет РЕЗУЛЬТАТ:
  // безымянный «+», меняющий смысл под вкладкой, читать нельзя.
  //
  // Товар заводится в каталоге вместе с ценой и фото — второй формы
  // для того же самого на складе быть не должно, поэтому здесь ссылка.
  // ── Вкладки — ОДИН список на обе раскладки ───────────────────────────
  // На телефоне они чипы, на lg — .wtab с чертой. Имена и порядок живут
  // здесь один раз: два списка разъехались бы на первой новой вкладке.
  //
  // ⚠️ ЧИСЛО ИДЁТ ОТДЕЛЬНЫМ ПОЛЕМ, а не приклеено к подписи точкой.
  // Было `Ємності · 3` одной строкой; владелец 25.08.2026: «мне не
  // нравится, что ты используешь точки в качестве разделения». Точка
  // между словом и числом — это и есть склейка двух разных величин
  // в одну строку: имя вкладки переводится, число считается, и жить
  // им в одном литерале незачем. Разделяет их теперь плашка счётчика.
  const tabItems = ([
    ['all', t('inventory.tab.all'), null],
    ['materials', t('inventory.tab.materials'), null],
    ['containers', t('inventory.tab.containers'), containers.length || null],
    // Без модуля каталога товаров не существует вовсе: вкладка отдала бы
    // пустой список и кнопку в отключённый модуль.
    ...(hasCatalog ? [['goods', t('inventory.tab.goods'), null] as const] : []),
  ] as const).filter(Boolean) as readonly (readonly [Tab, string, number | null])[]

  // Колонки таблицы CRESKO Web (экран «Склад»): единственное место,
  // где размеры задаются строкой, — так велит .wtable (грид задаёт экран).
  // Ширины из §8 дословно: Товар · Категорія · Залишок · Од. · Склад ·
  // Собівартість · Сума · Статус · указатель.
  const WGRID = '2.4fr 1.2fr .7fr .5fr 1.1fr .9fr .9fr 1fr 40px'

  // ── Топ категорий по стоимости запаса (§8, правая рейка) ────────────
  //
  // Та же величина, что в колонке «Сума» таблицы: остаток × собівартість.
  // Считается по засобам — у товара категория приходит из справочника
  // платформы и живёт в другом разрезе; складывать две разные оси в один
  // столбик значит показать сумму, которую нельзя проверить ни на одном
  // экране. Четыре строки, как в референсе: пятая уже не про «топ».
  const topCategories = useMemo(() => {
    const by = new Map<string, number>()
    for (const mt of materials) {
      if (!mt.category || mt.cost == null) continue
      by.set(mt.category, (by.get(mt.category) ?? 0) + mt.stock * mt.cost)
    }
    return [...by.entries()]
      .map(([name, sum]) => ({ name, sum }))
      .filter((c) => c.sum > 0)
      .sort((a, b) => b.sum - a.sum)
      .slice(0, 4)
  }, [materials])

  // Имя места хранения по идентификатору. Из уже полученного справочника
  // `locations`, а не вложенной выборкой в запросе списка: второе имя
  // того же места разошлось бы с первым при переименовании.
  const locationName = (id: string | null) =>
    (id ? locations.find((l) => l.id === id)?.name ?? null : null)

  const fab: { label: string; href?: string; onClick?: () => void } = tab === 'goods'
    ? { href: '/app/catalog', label: t('inventory.action.addInCatalog') }
    : tab === 'containers'
      ? { onClick: () => setAdding('container'), label: t('inventory.action.addContainer') }
      : { onClick: () => setAdding('material'), label: t('inventory.action.addMaterial') }

  // ── Швидкі дії: ОДИН орган управления вместо двух ────────────────────
  //
  // До 20.08.2026 входов в операции склада было два, в двух разных местах
  // одного экрана: ряд плиток «Швидкі дії» под счётчиками (сканирование,
  // приход, расход, перенос) и плавающая кнопка с заведением позиции.
  // Ряд при этом стоял ПОСТОЯННО и занимал полосу первого экрана, хотя
  // нужен на секунду.
  //
  // Теперь всё это — стос у плавающей кнопки (`components/quick-fab.tsx`),
  // а ряд плиток с экрана снят. Первый экран отдан числам и списку.
  //
  // ── ЧТО В СТОСЕ И ПОЧЕМУ ИМЕННО ЭТО (сверено с ТЗ 25.08.2026) ────────
  //
  // Вопрос владельца дословно: «почему ты именно добавил эти действия
  // в плюс, насколько они котируются с ТЗ». Разбор:
  //
  //   Приймання, Списання, Переміщення — три операции, которые ДВИГАЮТ
  //   остаток. Других способов его изменить в продукте нет и быть
  //   не может (правило 5: остаток меняется только журналом), значит
  //   это и есть полный список операций склада.
  //
  //   Новий засіб и Нова ємність — заведение записи. По ТЗ 3.1 и 3.2
  //   это две РАЗНЫЕ сущности: засіб — карточка средства с брендом,
  //   INCI и нотификацией; ємність — вскрытая банка с QR-наклейкой,
  //   у которой свой срок по PAO. Раньше здесь был один пункт,
  //   менявший смысл вместе с вкладкой: на «Всі» он заводил засіб,
  //   на «Ємності» — банку. То есть половина действия была доступна
  //   только тому, кто сначала догадался переключить вкладку.
  //
  // ⚠️ СКАНИРОВАНИЯ ЗДЕСЬ БОЛЬШЕ НЕТ. Отзыв владельца 25.08.2026:
  // «сканирование через таб плюса быть не должно, потому что вверху
  // тоже есть кнопка сканирования». Он прав, и это то же правило,
  // ради которого экран уже переделывали: один вход в одно действие.
  // Значок сканера в шапке виден на КАЖДОМ экране кабинета, а стос
  // надо сначала раскрыть — то есть худший из двух входов и лишний.
  //
  // Розлив у дозатор (ТЗ 3.2) сюда НЕ добавлен, и это решение:
  // он делается НАД конкретной банкой и живёт на её экране контроля
  // PAO. Действие, которому нужен выбор источника из ста ёмкостей,
  // в быстрых действиях бесполезно — выбор занял бы больше времени,
  // чем переход на карточку.
  //
  // Порядок — снизу вверх по частоте: ближе всего к пальцу приход
  // и расход, дальше всего — заведение новой записи (работа
  // администратора за столом, а не мастера у кресла).
  //
  // ⚠️ ТОНОВ У ПУНКТОВ НЕТ ВОВСЕ. Первая версия красила все пять
  // в свои тона, вторая оставила акцент у главного — и владелец
  // назвал уже это: «почему стиль кнопки Засіб отличается от других».
  // Он прав дважды: цвет в системе означает СОСТОЯНИЕ, а у пунктов
  // меню состояния нет; и синий кружок с плюсом рядом с синей кнопкой
  // с плюсом — это один и тот же знак дважды в двух сантиметрах.
  // Отличают действия ПОДПИСИ, и они здесь есть у каждого.
  const quickActions: QuickAction[] = [
    // Значок называет РЕЗУЛЬТАТ, а не действие «добавить»: плюс уже
    // нарисован на самой кнопке, и повторять его в пунктах значит
    // сказать «добавить» два раза и не сказать, что именно.
    { key: 'material', label: t('inventory.action.addMaterial'), icon: IconBox,
      onClick: () => setAdding('material') },
    { key: 'container', label: t('inventory.action.addContainer'), icon: IconQr,
      onClick: () => setAdding('container') },
    { key: 'move', label: t('inventory.quick.move'), icon: IconArrows,
      onClick: () => { setMoveItem(''); setAdding('move') } },
    { key: 'writeOff', label: t('inventory.movements.action.writeOff'), icon: IconMinus,
      href: '/app/inventory/movements?new=1' },
    { key: 'receipt', label: t('inventory.quick.receipts'), icon: IconInbox,
      href: '/app/inventory/receipts?new=1' },
  ]

  // ── Действия по свайпу строки ────────────────────────────────────────
  //
  // Бриф владельца, П4: «свайп по строке → быстрые действия вместо
  // обязательного перехода в детальную карточку».
  //
  // «Відкрити» из списка брифа здесь НЕТ намеренно: строка и так
  // открывается нажатием. Третья кнопка, повторяющая нажатие по той же
  // строке, — ровно тот дубляж, из-за которого этот экран уже
  // переделывался; жест нужен для того, чего нажатием не сделать.
  //
  // У ёмкости действия ДРУГИЕ и это не пробел: банку не «списывают»,
  // её вскрывают, закрывают пустой или утилизируют — те же три перехода
  // статуса, что и после сканирования, и той же функцией. Второго пути
  // менять статус банки в продукте нет и заводить его нельзя.
  function swipeFor(row: Row): SwipeAction[] {
    if (row.kind === 'material') {
      return [
        { key: 'off', label: t('inventory.movements.action.writeOff'), icon: IconMinus, tone: 'amber',
          onSelect: () => router.push(`/app/inventory/movements?new=1&item=${row.m.id}`) },
        { key: 'move', label: t('inventory.quick.move'), icon: IconArrows, tone: 'violet',
          onSelect: () => { setMoveItem(row.m.id); setAdding('move') } },
      ]
    }
    if (row.kind === 'container') {
      return row.c.status === 'sealed'
        ? [{ key: 'open', label: t('inventory.container.openShort'), icon: IconCheck, tone: 'emerald',
             onSelect: () => void openContainer(row.c.id, row.c.code) }]
        : [
          { key: 'finish', label: t('inventory.container.finished'), icon: IconCheck, tone: 'emerald',
            onSelect: () => void finishContainer(row.c.id, row.c.code) },
          { key: 'dispose', label: t('inventory.container.dispose'), icon: IconClose, tone: 'rose',
            onSelect: () => void finishContainer(row.c.id, row.c.code, true) },
        ]
    }
    // Товар без учёта остатка списывать не с чего: у него нет числа,
    // которое движение могло бы уменьшить.
    return row.v.tracked
      ? [{ key: 'off', label: t('inventory.movements.action.writeOff'), icon: IconMinus, tone: 'amber',
           onSelect: () => router.push(`/app/inventory/movements?new=1&kind=goods&item=${row.v.id}`) }]
      : []
  }

  // ── Остальные экраны раздела ─────────────────────────────────────────
  // Порядок — по частоте, а не по алфавиту. Печать наклеек показывается
  // только когда есть что печатать: пустой список печати — это лист
  // бумаги, потраченный впустую.
  const more: { href: string; label: string; icon: typeof IconBox; blank?: boolean }[] = [
    { href: '/app/inventory/receipts', label: t('inventory.quick.receipts'), icon: IconInbox },
    { href: '/app/inventory/movements', label: t('inventory.quick.movements'), icon: IconArrows },
    { href: '/app/inventory/counts', label: t('inventory.quick.counts'), icon: IconClipboard },
    { href: '/app/inventory/reorder', label: t('inventory.links.reorder'), icon: IconLow },
    ...(containers.length > 0
      ? [{ href: '/app/inventory/labels', label: t('inventory.action.printLabels'), icon: IconQr, blank: true }]
      : []),
    // «Усі документи» отсюда снято 19.08.2026 решением владельца: это была
    // вторая дверь в раздел «Журнали», где документы и живут. Документы
    // КОНКРЕТНОГО засоба открываются с его карточки — та дверь и нужна,
    // а список всех документов заведения к складу отношения не имеет.
    { href: '/app/inventory/recipes', label: t('inventory.links.recipes'), icon: IconBeaker },
    { href: '/app/inventory/barcodes', label: t('inventory.links.barcodes'), icon: IconBarcode },
  ]

  // ── Строка реєстру (телефон) ─────────────────────────────────────────
  //
  // Одна функция на все три вида записи и на обе раскладки списка
  // (в группе и без групп). До 20.08.2026 это была ветка прямо внутри
  // `map`, и вынести её пришлось ровно потому, что список перестал
  // быть одним: копия ветки под второй список — три определения слова
  // «строка склада», которые разъедутся на первой правке.
  //
  // ⚠️ НУЛЕВОЙ ОСТАТОК ПРИГЛУШАЕТСЯ, А НЕ ПРЯЧЕТСЯ (бриф, П4.2).
  // Спрятанная позиция читается как «её нет в реестре» — и мастер
  // заводит её второй раз; приглушённая говорит «она есть, но её
  // нет на полке», а это разные вещи.
  function renderRow(row: Row) {
    // Метка состояния — ТОЛЬКО когда есть что сказать. Зелёное
    // «Дійсний» на каждой здоровой строке — шум в чистом виде:
    // список из двадцати засобів превращался в двадцать зелёных
    // плашек, и на их фоне красная переставала выделяться.
    const badge = row.state !== 'none' && row.state !== 'ok'
      ? <span className={EXPIRY_BADGE[row.state]}>{t(EXPIRY_KEY[row.state])}</span>
      : null
    const empty = row.kind === 'material' ? row.m.stock <= 0
      : row.kind === 'goods' ? (row.v.tracked && row.v.stock <= 0)
        : row.c.volume != null && row.c.volume <= 0
    const dim = empty ? { opacity: 0.6 } : undefined

    // ── РАСКЛАДКА СТРОКИ, ПЕРЕСОБРАННАЯ 25.08.2026 ───────────────────
    //
    // Владелец: «мне не нравится, что ты используешь точки в качестве
    // разделения, измени на то, что используют все, или вообще просто
    // разные строки используй».
    //
    // Точек в строке было две, и обе склеивали разное: «Партія: B-9003 ·
    // до 22.08.2026» и «Прострочено · В наявності: 12 шт». Убрать их,
    // оставив всё на месте, было бы полумерой — три величины подряд
    // без разделителя читаются как одна фраза. Поэтому строка
    // пересобрана по образцу, который и правда «используют все»:
    //
    //   ГЛАВНОЕ — вверху и по краям: имя слева, количество справа.
    //   ВТОРОСТЕПЕННОЕ — строкой ниже, разнесённое ЗАЗОРОМ, а не знаком.
    //
    // Побочная выгода, ради которой это стоило делать: количество
    // перестало прятаться в третьей строке под меткой состояния. Это
    // величина, за которой на склад и приходят, и в референсах она
    // всегда в правом верхнем углу карточки.
    //
    // Указателя «›» в строке больше нет. Он повторял то, что и так
    // сообщает карточка (её нажимают), и спорил за правый край
    // с количеством — а количество там нужнее.
    const head = (title: string, qty: React.ReactNode) => (
      <span className="flex items-start gap-3">
        <span className="t-md clamp-2 min-w-0 flex-1">{title}</span>
        <span className="shrink-0 text-right">{qty}</span>
      </span>
    )
    // Второстепенная строка: элементы разнесены зазором. `gap` вместо
    // разделителя — то же решение, что у плашки счётчика в подзаголовке.
    const meta = (items: React.ReactNode[]) => {
      const some = items.filter(Boolean)
      if (some.length === 0) return null
      return (
        <span className="mt-1 flex flex-wrap items-center gap-2">
          {some.map((it, i) => <span key={i}>{it}</span>)}
        </span>
      )
    }
    const qtyText = (value: string, low: boolean) => (
      <span className="tabular t-sm font-semibold"
            style={{ color: low ? 'var(--color-warn)' : 'var(--color-text)' }}>
        {value}
      </span>
    )

    const body = (() => {
      if (row.kind === 'material') {
        const mt = row.m
        const low = mt.threshold > 0 && mt.stock <= mt.threshold
        return (
          <Link href={`/app/inventory/materials/${mt.id}`} className="list-card" style={dim}>
            {/* Фото засоба (0111). Нет фото — значок, а не серый
                прямоугольник: пустая рамка читается как «картинка
                не загрузилась», то есть как поломка. */}
            <span className="list-card-thumb">
              {mt.imagePath
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={photoUrl(mt.imagePath)} alt=""
                       style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <IconBox size={22} />}
            </span>
            <span className="min-w-0 flex-1">
              {/* Название, номер партии и срок — данные арендатора. */}
              {head(mt.name, qtyText(`${t.number(mt.stock)} ${mt.unit}`, low))}
              {meta([
                badge,
                // Дата ПОЛНАЯ, а не «25 трав.», как в остальных плотных
                // списках: у срока годности год — половина смысла.
                mt.expiry
                  ? <span className="t-sm prose-muted">
                      {t('inventory.materials.until', { date: t.date(mt.expiry) })}
                    </span>
                  : null,
                mt.batch
                  ? <span className="t-sm" style={{ color: 'var(--color-faint)' }}>
                      {t('inventory.materials.batch', { number: mt.batch })}
                    </span>
                  : null,
              ])}
            </span>
          </Link>
        )
      }

      if (row.kind === 'container') {
        const c = row.c
        return (
          <div className="list-card" style={dim}>
            {/* Ёмкость — это банка с QR-наклейкой, поэтому QR
                в миниатюре: он же нарисован на самой банке. */}
            <span className="list-card-thumb"><IconQr size={22} /></span>
            <span className="min-w-0 flex-1">
              <Link href={`/app/inventory/materials/${c.materialId}/pao`} className="block">
                {head(c.material, c.volume != null
                  ? qtyText(`${t.number(c.volume)} ${c.unit ?? ''}`, false)
                  : null)}
                {meta([
                  badge,
                  c.useBy
                    ? <span className="t-sm prose-muted">
                        {t('inventory.container.until', { date: t.date(c.useBy) })}
                      </span>
                    : <span className="t-sm prose-muted">{t('inventory.container.sealed')}</span>,
                  // Код наклейки — по нему банку и опознают на полке.
                  <span key="code" className="tabular t-sm" style={{ color: 'var(--color-faint)' }}>
                    {c.code}
                  </span>,
                ])}
              </Link>
              {/* Вскрытие осталось кнопкой НА строке, хотя то же действие
                  лежит и под свайпом: это самое частое действие мастера
                  у кресла, и прятать его за жест, о котором надо
                  догадаться, нельзя. Свайп здесь — ускорение для того,
                  кто уже знает. У «Закінчилась» и «Списати» второго
                  входа нет намеренно: они редкие. */}
              {c.status === 'sealed' && (
                <button className="btn-secondary t-sm mt-2" disabled={busy === c.id}
                        onClick={(e) => { e.preventDefault(); void openContainer(c.id, c.code) }}>
                  {t('inventory.container.openShort')}
                </button>
              )}
            </span>
          </div>
        )
      }

      // Строка товара ВЕДЁТ в карточку каталога. До 19.08.2026 товар был
      // единственным элементом склада без входа: выглядел как расходник
      // и ёмкость, но не открывался.
      const v = row.v
      const low = v.tracked && v.threshold > 0 && v.stock <= v.threshold
      return (
        <Link href={`/app/catalog/${v.offeringId}`} className="list-card" style={dim}>
          <span className="list-card-thumb"><IconBag size={22} /></span>
          <span className="min-w-0 flex-1">
            {/* Название позиции и варианта — данные арендатора. */}
            {head(v.title, v.tracked
              ? qtyText(`${t.number(v.stock)} ${v.unit}`, low)
              : <span className="t-sm prose-muted">{t('inventory.goods.untracked')}</span>)}
            {meta([
              <span key="name" className="t-sm prose-muted">{v.name}</span>,
              v.reserved > 0
                ? <span className="t-sm" style={{ color: 'var(--color-faint)' }}>
                    {t('inventory.goods.reserved', { n: t.number(v.reserved) })}
                  </span>
                : null,
            ])}
          </span>
        </Link>
      )
    })()

    return <SwipeRow key={row.key} actions={swipeFor(row)}>{body}</SwipeRow>
  }

  return (
    <div className="flex flex-col gap-5">

      {/* ── CRESKO Web: хедер экрана (только lg) ─────────────────
          Слева имя экрана тем же ключом, что и вкладка браузера;
          справа «Приймання» — ЕДИНСТВЕННАЯ синяя кнопка кабинета
          (README: btn-blue живёт только тут и в модалке приймання).
          `?new=1` открывает форму нового документа сразу — тем же
          приёмом, каким `?scan=1` открывает камеру здесь. */}
      {/* Плашка со значком, имя экрана и подпись под ним — состав §8
          дословно. Подпись здесь не спорит с решением «заголовка над
          содержимым нет»: то решение про ТЕЛЕФОН (панель уже называет
          раздел), а в веб-каркасе имени экрана не пишет никто — сайдбар
          подсвечивает пункт, но заголовка страницы не даёт. */}
      <div className="mb-1 hidden items-center justify-between gap-4 lg:flex">
        <div className="flex min-w-0 items-center gap-3">
          <span aria-hidden className="flex shrink-0 items-center justify-center"
                style={{
                  width: 44, height: 44,
                  borderRadius: 'var(--radius-plate)',
                  background: 'var(--color-accent-soft)',
                  color: 'var(--color-accent-ink)',
                }}>
            <IconBox size={22} />
          </span>
          <div className="min-w-0">
            <h1 className="webh1">{t('app.screen.inventory.title')}</h1>
            <p style={{ fontSize: 14, color: 'var(--color-muted)' }}>
              {t('app.screen.inventory.desc')}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* Действие вкладки — ТО ЖЕ, что у плавающей кнопки на телефоне
              (`fab`), и ровно поэтому кнопка на lg скрыта: одно действие,
              две раскладки, а не два входа. Порядок как в §8: слева
              обводка, справа сплошная. */}
          {fab.href
            ? <Link href={fab.href} className="btn-secondary">{fab.label}</Link>
            : <button type="button" className="btn-secondary" onClick={fab.onClick}>{fab.label}</button>}
          {/* Синяя кнопка — ЕДИНСТВЕННАЯ в кабинете (README: btn-blue живёт
              только тут и в модалке приймання). `?new=1` открывает форму
              нового документа сразу — тем же приёмом, каким `?scan=1`
              открывает камеру здесь. */}
          <Link href="/app/inventory/receipts?new=1" className="btn-blue">
            {t('app.screen.inventory.receipts.title')}
          </Link>
        </div>
      </div>

      {/* ── CRESKO Web: двухколонник (§8) ────────────────────────
          На lg контент делится на основную колонку и правую рейку
          268px (ширина из README дословно). Ниже lg обёртка — обычный
          блок, рейка скрыта, и раскладка не меняется ни на пиксель:
          зазор колонки тот же gap-5, что был у корня. */}
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:gap-6">
      <div className="flex min-w-0 flex-1 flex-col gap-5">

      {/* ── Результат сканирования ───────────────────────────────
          Первым блоком и только после скана. Крестик обязателен:
          без него панель висит до перезагрузки и мешает списку. */}
      {scan && (
        <section className="card rise" style={{ borderColor: 'var(--color-accent)' }}>
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              {scan.container && (
                <>
                  {/* Название засоба и код наліпки — данные арендатора.
                      Код ОТДЕЛЬНОЙ строкой, а не через точку: это две
                      разные вещи — что за средство и какая именно банка,
                      — и на 390px они не помещались в одну строку. */}
                  <p className="t-md">{scan.container.material}</p>
                  <p className="tabular t-sm prose-muted">{scan.container.code}</p>
                  <p className="tabular t-md mt-0.5">
                    {scan.container.expired
                      ? <span style={{ color: 'var(--color-danger)' }}>
                          {t('inventory.container.expired', { date: short(scan.container.use_by) })}
                        </span>
                      : scan.container.use_by
                        ? t('inventory.container.useBy', {
                            date: short(scan.container.use_by),
                            days: t.plural('inventory.days', scan.container.days_left ?? 0),
                          })
                        : t('inventory.container.sealedHint')}
                  </p>
                </>
              )}
              {scan.item && (
                <>
                  <p className="t-md">{scan.item.title}</p>
                  {scan.item.subtitle && (
                    <p className="t-sm prose-muted">{scan.item.subtitle}</p>
                  )}
                  {/* Остаток, место и метка «мало» — три РАЗНЫЕ величины,
                      и разносит их зазор, а не точки. Строка через точку
                      читалась как одно предложение, из которого главное
                      («мало на складі») терялось в конце. */}
                  <p className="mt-1 flex flex-wrap items-center gap-2">
                    <span className="tabular t-md">
                      {t('inventory.scan.item.stock', { n: t.number(Number(scan.item.stock_qty)) })}
                    </span>
                    {scan.item.location && (
                      <span className="t-sm prose-muted">{scan.item.location}</span>
                    )}
                    {scan.item.low_stock && (
                      <span className="badge-warn">{t('inventory.scan.item.low')}</span>
                    )}
                  </p>
                  {/* Скан обязан вести к действию, а не быть справкой:
                      засіб — на карточку, товар — в каталог (0117 даёт
                      offering_id). Тупик «прочитал и закрой» владелец
                      прочитал как «сканер не работает». */}
                  <Link className="btn-secondary mt-2 inline-flex"
                        href={scan.item.kind === 'material'
                          ? `/app/inventory/materials/${scan.item.id}`
                          : `/app/catalog/${scan.item.offering_id ?? ''}`}>
                    {t('inventory.scan.item.open')}
                  </Link>
                </>
              )}
              {scan.miss && (
                <>
                  <p className="field-error">{t('inventory.scan.notFound', { code: scan.miss })}</p>
                  {/* Незнакомый заводской штрихкод — это чаще всего ещё
                      не привязанный код засоба. Выход — экран привязки
                      с уже подставленным кодом, а не тупик. */}
                  <Link className="btn-secondary mt-2 inline-flex"
                        href={`/app/inventory/barcodes?code=${encodeURIComponent(scan.miss)}`}>
                    {t('inventory.scan.bind')}
                  </Link>
                </>
              )}
            </div>
            <button type="button" onClick={() => setScan(null)}
                    aria-label={t('inventory.scan.close')}
                    className="btn-icon shrink-0" style={{ color: 'var(--color-faint)' }}>
              <IconClose size={18} />
            </button>
          </div>

          {scan.container && (
            <div className="mt-3 flex flex-wrap gap-2">
              {scan.container.status === 'sealed' && (
                <button className="btn-primary" disabled={busy === scan.container.id}
                        onClick={() => void openContainer(scan.container!.id, scan.container!.code)}>
                  {t('inventory.container.open')}
                </button>
              )}
              {scan.container.status === 'opened' && (
                <>
                  <button className="btn-secondary" disabled={busy === scan.container.id}
                          onClick={() => void finishContainer(scan.container!.id, scan.container!.code)}>
                    {t('inventory.container.finished')}
                  </button>
                  <button className="btn-danger" disabled={busy === scan.container.id}
                          onClick={() => void finishContainer(scan.container!.id, scan.container!.code, true)}>
                    {t('inventory.container.dispose')}
                  </button>
                </>
              )}
            </div>
          )}
        </section>
      )}

      {/* ── Картка-герой (телефон) ───────────────────────────────
          Заведена 20.08.2026 по референсам владельца: первый экран
          отвечает на ОДИН вопрос крупно, а не на четыре мелко.
          Ряд из четырёх плиток-счётчиков она заменяет целиком.

          ЧТО В НЕЙ ЧИСЛОМ. Вартість запасу — единственная величина
          склада, которую владелец не может посчитать в уме и ради
          которой открывает раздел не мастер, а он сам. Но если
          собівартість не заведена ни у одной позиции, число было бы
          нулём — то есть утверждением «запас ничего не стоит»,
          которого никто не проверял (тем же правилом живёт колонка
          «Сума» в таблице). Тогда крупным идёт длина реєстру,
          а подпись честно говорит, чего не хватает.

          ПОЛОСА — доли одного целого по СРОКУ ГОДНОСТИ, той же
          меркой, что и рассылка предупреждений: экран и письмо
          обязаны говорить одно и то же.

          РАЗБИВКА ПОД ПОЛОСОЙ — ЭТО ФИЛЬТР. Здесь и только здесь:
          статусные чипы, делавшие то же самое, из ряда ниже сняты.
          У числа появился выход — нажал «Прострочені: 3» и видишь
          эти три, — а у экрана перестало быть двух органов управления
          одним и тем же.

          Число без выхода — беда, о которой сообщили и не дали
          способа её увидеть; поэтому же нулевое состояние отключено
          (`disabled`), а не спрятано: пропадающая кнопка сдвигает
          соседние, и ряд «прыгает» при каждом приходе. */}
      <section className="hero rise-1 lg:hidden">
        <button type="button" className="flex w-full items-start justify-between gap-3 text-left"
                aria-haspopup="dialog" onClick={() => setDetails(true)}>
          <span className="min-w-0">
            <span className="eyebrow block">{hasValue
              ? t('inventory.hero.value')
              : t('inventory.hero.positions')}</span>
            <span className="hero-value mt-1 block">{stockCost != null
              ? t.money(stockCost)
              : t.number(registryTotal)}</span>
            <span className="t-sm mt-1 flex flex-wrap items-center gap-3 prose-muted">
              {heroMeta.map((x) => <span key={x}>{x}</span>)}
            </span>
          </span>
          {/* Указатель, а не кнопка «Деталі» словом: подпись рядом
              с крупным числом спорила бы с ним за внимание, а сама
              карточка и так нажимается целиком. */}
          <span aria-hidden className="btn-icon shrink-0"><IconChevronRight size={18} /></span>
        </button>

        {/* Полосы нет, пока нечего делить: пустая дорожка под числом
            читается как «данные не загрузились». */}
        {stateTotal > 0 && (
          <div className="hero-bar mt-4" aria-hidden>
            {([
              { key: 'ok', n: stats.ok, color: 'var(--tone-emerald)' },
              { key: 'soon', n: stats.soon, color: 'var(--tone-amber)' },
              { key: 'expired', n: stats.expired, color: 'var(--tone-rose)' },
            ] as const).filter((s) => s.n > 0).map((s) => (
              <span key={s.key}
                    style={{ width: `${(s.n / stateTotal) * 100}%`, background: s.color }} />
            ))}
          </div>
        )}

        <div className="mt-2 grid grid-cols-3 gap-1">
          {([
            { key: 'ok', n: stats.ok, label: t('inventory.stats.short.ok'), tone: 'emerald' },
            { key: 'soon', n: stats.soon, label: t('inventory.stats.short.soon'), tone: 'amber' },
            { key: 'expired', n: stats.expired, label: t('inventory.stats.short.expired'), tone: 'rose' },
          ] as const).map((s) => {
            const on = flag === s.key
            return (
              <button key={s.key} type="button" className="hero-stat" data-tone={s.tone}
                      aria-pressed={on} disabled={s.n === 0}
                      onClick={() => setFlag(on ? 'all' : s.key)}>
                <span aria-hidden className="hero-dot" />
                <span className="min-w-0">
                  <span className="tabular block font-bold"
                        style={{ fontSize: 'var(--text-lg)', lineHeight: 'var(--lh-lg)' }}>
                    {t.number(s.n)}
                  </span>
                  <span className="block truncate"
                        style={{
                          fontSize: 'calc(10px * var(--type-scale))',
                          lineHeight: 'calc(13px * var(--type-scale))',
                          color: 'var(--color-muted)',
                        }}>
                    {s.label}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      </section>

      {/* ── Чипы-фильтры ─────────────────────────────────────────
          Одной строкой с горизонтальной прокруткой. Перенос на вторую
          строку смешивал бы их с тем, что стоит рядом, — ровно так
          «+ Засіб» оказывался под «Товари» и читался как фильтр.

          ⚠️ ЗДЕСЬ ТОЛЬКО ОДНА ОСЬ — ВИД ЗАПИСИ. Статусные чипы
          («Прострочені», «Закінчуються») отсюда сняты 20.08.2026: тем
          же фильтром управляет разбивка в карточке-герое выше, где
          рядом с состоянием стоит его ЧИСЛО. Две пилюли и три плитки,
          делающие одно и то же в двадцати пикселях друг от друга, —
          тот самый дубляж, из-за которого экран уже переделывался.

          Оси по-прежнему две и по-прежнему НЕЗАВИСИМЫ: «Ємності»
          (здесь) + «Прострочені» (в герое) — осмысленный вопрос
          («какие банки уже нельзя брать»), и схлопывать их в один
          список значило бы отнять его. */}
      <div className="scroll-x rise-1 -mx-4 flex gap-2 px-4 pb-1 lg:hidden sm:mx-0 sm:px-0">
        {tabItems.map(([key, label, count]) => (
          <button key={key} onClick={() => switchTab(key)}
                  className={`${tab === key ? 'chip-active' : 'chip'} shrink-0`}>
            {label}
            {count != null && <span className="count-pill">{t.number(count)}</span>}
          </button>
        ))}
      </div>

      {/* ── CRESKO Web: вкладки чертой (только lg) ───────────────
          Тот же tabItems и тот же switchTab, что и у чипов, —
          отличается только вид.

          Порядок из §8: лента вкладок стоит СРАЗУ под хедером, метрики —
          под ней. Так и должно быть по смыслу: вкладка выбирает, о чём
          вообще экран, а числа считаются уже внутри выбранного. Раньше
          они стояли наоборот, и метрики читались как заголовок всей
          страницы, хотя менялись вместе с вкладкой. */}
      <div className="wtabs hidden lg:flex">
        {tabItems.map(([key, label, count]) => (
          <button key={key} type="button" onClick={() => switchTab(key)}
                  className="wtab" data-active={tab === key}>
            {label}
            {count != null && <span className="count-pill">{t.number(count)}</span>}
          </button>
        ))}
      </div>

      {/* ── CRESKO Web: метрики (только lg) ──────────────────────
          Те же четыре числа и тот же клик-фильтр, что у мобильного
          ряда ниже, — но в виде .wmetric с иконкой-плашкой (README).
          Подписи длинные: на вебе плитке есть где дышать, и «Закінч.»
          выглядело бы обрезком. Активный фильтр — рамка акцентом:
          у .wmetric нет своего активного состояния, а заливать плитку
          кобальтом значит спорить с единственной синей кнопкой выше.

          Третьей строки-примечания из §8 здесь НЕТ, и это решение:
          в хендоффе она уточняет ВЕЛИЧИНУ («на всіх складах», «за
          закупівельними цінами»), а у счётчика состояний уточнять
          нечего — «за терміном придатності» пришлось бы написать
          три раза подряд. Придуманная третья строка ради ровного
          ряда — фикстура, а не оформление. */}
      <section className="hidden gap-4 rise-1 lg:grid lg:grid-cols-4">
        {([
          { key: 'all', n: stats.total, label: t('inventory.stats.total'), tone: 'blue', icon: IconLayers },
          { key: 'ok', n: stats.ok, label: t('inventory.stats.ok'), tone: 'emerald', icon: IconCheck },
          { key: 'soon', n: stats.soon, label: t('inventory.stats.soon'), tone: 'amber', icon: IconClock },
          { key: 'expired', n: stats.expired, label: t('inventory.stats.expired'), tone: 'rose', icon: IconAlert },
        ] as const).map((s) => {
          // «Усі позиції» рамкой НЕ подсвечивается, хотя формально это
          // тоже выбранное состояние: без фильтра оно выбрано ВСЕГДА,
          // и постоянная рамка на первой плитке читается не как «здесь
          // фильтр», а как «эта плитка почему-то другая».
          const on = flag === s.key && s.key !== 'all'
          const dead = s.key !== 'all' && s.n === 0
          return (
            <button key={s.key} type="button" disabled={dead} aria-pressed={on}
                    onClick={() => setFlag(on ? 'all' : s.key)}
                    className="wmetric text-left"
                    style={{
                      cursor: dead ? 'default' : 'pointer',
                      borderColor: on ? 'var(--color-accent)' : undefined,
                    }}>
              <span className="min-w-0">
                <span className="wmetric-label block">{s.label}</span>
                <span className="wmetric-value tabular block">{t.number(s.n)}</span>
              </span>
              <span className="wmetric-icon" data-tone={s.tone}><s.icon size={19} /></span>
            </button>
          )
        })}
      </section>

      {/* ── Что сейчас отфильтровано ─────────────────────────────
          Без этой метки укороченный список выглядит как пропавшие
          данные: человек выбрал «Прострочені» три экрана назад и уже
          не помнит об этом. Крестик снимает фильтр здесь же.

          Строки поиска среди этих меток больше нет: поиск стал общим
          и живёт в шапке, а фильтр состояния — свойство этого экрана. */}
      {/* На телефоне этой метки НЕТ: активный статусный чип выше сам
          показывает наложенный фильтр и сам его снимает, а вторая
          пилюля о том же в двадцати пикселях ниже — дубляж. На lg чипов
          нет (там `.wmetric`), и метка остаётся единственным местом,
          где видно, что список укорочен. */}
      {filtered && (
        <div className="rise-2 hidden flex-wrap items-center gap-2 lg:flex">
          {/* Стиль НЕ `chip-active`, хотя напрашивался. Сплошной кобальт
              здесь уже занят выбранной вкладкой, и две одинаковые синие
              пилюли в двух строках подряд означали бы разное: «я на этой
              вкладке» и «наложен фильтр, нажми чтобы снять». Поэтому
              снимаемый фильтр — обводка и акцентный ТЕКСТ, а не заливка
              (`--color-accent-ink` против `--color-accent`, см. CLAUDE.md
              про два токена акцента). */}
          <button type="button" className="chip" onClick={() => setFlag('all')}
                  style={{ borderColor: 'var(--color-accent)', color: 'var(--color-accent-ink)' }}>
            {t(flag === 'ok' ? 'inventory.stats.ok'
              : flag === 'soon' ? 'inventory.stats.soon'
                : 'inventory.stats.expired')}
            <IconClose size={14} className="ml-1.5" />
          </button>
        </div>
      )}

      {/* ── Пусто: ОДНО состояние на экран ───────────────────────
          Раньше «Розхідники» и «Ємності» рисовали каждое своё, и на
          новом заведении экран состоял из двух одинаковых карточек. */}
      {visible === 0 ? (
        <section className="card rise">
          <div className="empty">
            <span className="empty-icon"><IconBox size={24} /></span>
            <p className="empty-title">
              {emptyTenant ? t('inventory.empty.title') : t('inventory.empty.filteredTitle')}
            </p>
            <p className="empty-desc">
              {emptyTenant ? t('inventory.empty.desc') : t('inventory.empty.filtered')}
            </p>
            <div className="empty-actions">
              {emptyTenant ? (
                <button type="button" className="btn-primary" onClick={() => setAdding('material')}>
                  {t('inventory.materials.add')}
                </button>
              ) : (
                <button type="button" className="btn-secondary"
                        onClick={() => setFlag('all')}>
                  {t('inventory.filter.reset')}
                </button>
              )}
            </div>
          </div>
        </section>
      ) : (
        <>
        {/* ── Реєстр (телефон) ───────────────────────────────────
            ОДИН список карточек вместо трёх секций с надзаголовками;
            на lg вместо него таблица ниже. Обёртка повторяет gap
            родителя, чтобы зазоры секций не изменились ни на пиксель. */}
        {/* `.fab-clear` — запас под плавающую кнопку. Реєстр здесь
            последний мобильный блок, и без запаса его последняя строка
            физически лежит под кнопкой: прокруткой её не увести,
            ниже ничего нет. */}
        <section className="fab-clear rise lg:hidden">
          {/* README: «Реєстр» 12/700/uppercase, справа — состояние
              списка. Счётчик обязателен: без него укороченный фильтром
              список читается как пропавшие данные. Справа — не кнопка,
              а подпись: снимают фильтр там же, где ставили.

              Число ушло из левой подписи в ПРАВЫЙ конец строки —
              там, где раньше стояло имя вкладки. Точки-разделителя
              («Реєстр · 12 позицій») больше нет: два конца одной
              строки разделяют слово и число лучше любого знака.
              Имя вкладки при этом ничего не сообщало — оно и так
              подсвечено чипом в двадцати пикселях выше. */}
          <div className="section-head">
            <p className="eyebrow">{t('inventory.registry.title')}</p>
            <span className="tabular t-sm"
                  style={{ color: filtered ? 'var(--color-accent-ink)' : 'var(--color-muted)' }}>
              {filtered
                ? t(flag === 'ok' ? 'inventory.stats.ok'
                  : flag === 'soon' ? 'inventory.stats.soon'
                    : 'inventory.stats.expired')
                : t.plural('inventory.registry.count', visible)}
            </span>
          </div>

          {/* Карточки с зазором, а не одна карточка с разделителями:
              у строки миниатюра, два уровня текста и метка состояния —
              в сплошном списке они слипаются (README, `.list-card`).

              ⚠️ ГРУППЫ, А НЕ ОДНА ЛЕНТА (бриф владельца 20.08.2026, П4).
              Подзаголовок липнет под шапкой кабинета и сворачивается;
              первой идёт несворачиваемая «Потребує уваги» — почему
              именно так, разобрано у `buildGroups()`. */}
          <div className="flex flex-col gap-2">
            {groups.map((g) => {
              // Открыта РОВНО ОДНА группа: нажатие на вторую закрывает
              // первую. Требование владельца 25.08.2026, и оно же снимает
              // прежнюю жалобу «занимает полотно целое».
              //
              // ⚠️ «ПОТРЕБУЄ УВАГИ» ТЕПЕРЬ ТАКОЙ ЖЕ АККОРДЕОН. До 25.08
              // она одна не сворачивалась, и владелец прочитал это как
              // сбой: «почему вверху аккордеона нет, а внизу аккордеоны».
              // Он прав — два одинаковых на вид подзаголовка, ведущих
              // себя по-разному, объяснить нечем. Особое положение группы
              // осталось там, где ему и место: она первая, помечена
              // красной точкой и РАСКРЫТА по умолчанию (`openGroup`
              // стартует с её ключа). То есть ответ «що горить» виден
              // сразу, но человек волен его закрыть.
              // Безымянная группа — это список под наложенным фильтром
              // состояния (`buildGroups`, ветка `flat`). У неё нет
              // подзаголовка, значит нечем и раскрывать: она видна всегда.
              const shown = g.title === '' || openGroup === g.key
              return (
                <div key={g.key} className="flex flex-col gap-2">
                  {g.title && (
                    <button type="button" className="group-head" aria-expanded={shown}
                            onClick={() => setOpenGroup(shown ? null : g.key)}>
                      {g.pinned && (
                        <span aria-hidden className="hero-dot"
                              style={{ background: 'var(--tone-rose)' }} />
                      )}
                      {/* Имя категории — данные арендатора. */}
                      <span className="group-head-title">{g.title}</span>
                      {/* ⚠️ СУММЫ ЗДЕСЬ БОЛЬШЕ НЕТ. Стояли гривны без
                          подписи, и владелец спросил прямо: «почему там
                          вообще написаны суммы в гривнах, что это такое».
                          Вопрос справедливый — число без названия величины
                          это ребус, а не сведение. Та же сумма никуда
                          не делась: она в разбивке запаса («Топ категорії
                          за вартістю»), где у неё есть заголовок.
                          В подзаголовке остаётся ровно то, что нужно для
                          решения «разворачивать или нет», — сколько
                          позиций внутри. */}
                      <span className="count-pill shrink-0" style={{ color: 'var(--color-muted)' }}>
                        {t.number(g.rows.length)}
                      </span>
                      <span className="group-caret"><IconChevronRight size={16} /></span>
                    </button>
                  )}
                  {shown && g.rows.map(renderRow)}
                </div>
              )
            })}
          </div>

          {/* Итоги склада — только на вкладке товаров: посреди смешанного
              списка три денежные плитки перебивают счётчики сверху. */}
          {tab === 'goods' && totals && totals.units > 0 && (
            <div className="mt-3 grid grid-cols-3 gap-3">
              {[
                [t('inventory.goods.units'), t.number(totals.units)],
                [t('inventory.goods.cost'), t.money(totals.cost)],
                [t('inventory.goods.retail'), t.money(totals.retail)],
              ].map(([label, val]) => (
                <div key={label} className="card-flat !p-4 text-center">
                  <p className="tabular t-xl">{val}</p>
                  <p className="t-xs mt-0.5 prose-muted">{label}</p>
                </div>
              ))}
            </div>
          )}
        </section>


        {/* ── CRESKO Web: таблица склада (только lg) ─────────────
            Колонки и ширины — из §8 ДОСЛОВНО: Товар (мініатюра 42px +
            назва + бренд/обʼєм), Категорія (чип), Залишок, Од., Склад,
            Собівартість, Сума, Статус и указатель.

            Прежняя версия этой таблицы заменяла «Категорію» и «Склад»
            на «Тип» и «Термін» с объяснением «категорий и мест хранения
            в пропсах НЕТ». Пропсы — наши: `page.tsx` теперь берёт
            `category`, `cost_per_unit` и `location_id` из ТОЙ ЖЕ строки
            `materials` (лишней поездки нет), а имя места хранения
            подставляется из уже запрошенного справочника. Колонка «Тип»
            снята: вид записи называет миниатюра (коробка — засіб,
            QR — банка, сумка — товар), ровно как в мобильном списке,
            и повторять его словом в отдельном столбце незачем.

            «Термін» въехал ВТОРЫМ ЯРУСОМ в клетку статуса — §8 прямо
            допускает двухъярусную клетку («рядок 48–64px залежить від
            двоярусної клітинки»). Своей колонки он лишился, но не смысла:
            под бейджем «Прострочено» стоит дата, из-за которой он такой.

            Источник строк — ТОТ ЖЕ `registry`, что и у мобильного списка:
            одно место фильтрации, одна сортировка «проблемные вверх».
            До этого таблица шла тремя отдельными списками подряд, и
            просроченная банка лежала ниже двадцати здоровых засобів —
            то самое, что для карточек уже чинили. */}
        <section className="hidden rise lg:block">
          <div className="wtable">
            <div className="wtable-head" style={{ gridTemplateColumns: WGRID }}>
              <span>{t('inventory.web.table.item')}</span>
              <span>{t('inventory.web.table.category')}</span>
              <span>{t('inventory.web.table.stock')}</span>
              <span>{t('inventory.material.row.unit')}</span>
              <span>{t('inventory.web.table.location')}</span>
              <span className="text-right">{t('inventory.web.table.cost')}</span>
              <span className="text-right">{t('inventory.web.table.sum')}</span>
              <span>{t('inventory.material.row.status')}</span>
              <span aria-hidden />
            </div>

            {registry.map((row) => {
              // Одна строка на все три вида записи. Разводить её по видам
              // значит завести три определения слова «залишок» и три
              // раскладки одной и той же сетки — они разъедутся на первой
              // правке ширины колонки.
              const cell = (() => {
                if (row.kind === 'material') {
                  const mt = row.m
                  const low = mt.threshold > 0 && mt.stock <= mt.threshold
                  return {
                    href: `/app/inventory/materials/${mt.id}`,
                    // Фото засоба (0111); нет фото — значок вида записи.
                    thumb: mt.imagePath
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={photoUrl(mt.imagePath)} alt=""
                             style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : <IconBox size={20} />,
                    title: mt.name,
                    sub: [mt.brand, mt.sku].filter(Boolean).join(' · '),
                    category: mt.category,
                    qty: mt.stock, unit: mt.unit, low,
                    location: locationName(mt.locationId),
                    cost: mt.cost,
                    date: mt.expiry,
                    badge: row.state !== 'none'
                      ? <span className={EXPIRY_BADGE[row.state]}>{t(EXPIRY_KEY[row.state])}</span>
                      : low
                        ? <span className="badge-warn">{t('inventory.stats.short.low')}</span>
                        : null,
                  }
                }
                if (row.kind === 'container') {
                  const c = row.c
                  // Категория и место у банки — материнского засоба: своих
                  // у неё нет и быть не может, а прочерк в двух колонках
                  // читался бы как «не заполнено», хотя заполнено.
                  const parent = materials.find((mt) => mt.id === c.materialId)
                  return {
                    href: `/app/inventory/materials/${c.materialId}/pao`,
                    thumb: <IconQr size={20} />,
                    title: c.material,
                    sub: [c.code, c.openedAt
                      ? t('inventory.container.openedAt', { date: short(c.openedAt) })
                      : null].filter(Boolean).join(' · '),
                    category: parent?.category ?? null,
                    qty: c.volume, unit: c.unit ?? '', low: false,
                    location: locationName(parent?.locationId ?? null),
                    cost: null,
                    date: c.useBy,
                    badge: c.useBy
                      ? <span className={EXPIRY_BADGE[row.state]}>{t(EXPIRY_KEY[row.state])}</span>
                      : c.status === 'sealed'
                        ? <span className="badge">{t('inventory.container.sealed')}</span>
                        : null,
                  }
                }
                const v = row.v
                const low = v.tracked && v.threshold > 0 && v.stock <= v.threshold
                return {
                  href: `/app/catalog/${v.offeringId}`,
                  thumb: <IconBag size={20} />,
                  title: v.title,
                  sub: [v.name, v.reserved > 0
                    ? t('inventory.goods.reserved', { n: t.number(v.reserved) })
                    : null].filter(Boolean).join(' · '),
                  category: v.category,
                  qty: v.tracked ? v.stock : null, unit: v.unit, low,
                  // Место хранения — свойство засоба, а не позиции каталога:
                  // у товара его в модели нет вовсе.
                  location: null,
                  cost: v.cost,
                  date: null,
                  badge: !v.tracked
                    ? <span className="badge">{t('inventory.goods.untracked')}</span>
                    : low
                      ? <span className="badge-warn">{t('inventory.stats.short.low')}</span>
                      : null,
                }
              })()

              // Сумма — остаток × собівартість, и только когда есть оба
              // множителя. Ноль вместо неизвестной цены — это утверждение
              // «запас ничего не стоит», а его никто не проверял.
              const sum = cell.qty != null && cell.cost != null ? cell.qty * cell.cost : null

              return (
                <Link key={row.key} href={cell.href}
                      className="wtable-row" style={{ gridTemplateColumns: WGRID }}>
                  <span className="flex min-w-0 items-center gap-3">
                    {/* Миниатюра 42px из §8. Она же называет вид записи —
                        поэтому отдельной колонки «Тип» в таблице нет. */}
                    <span aria-hidden className="flex shrink-0 items-center justify-center overflow-hidden"
                          style={{
                            width: 42, height: 42,
                            borderRadius: 'var(--radius-plate)',
                            background: 'var(--web-surface-tint, var(--color-surface-2))',
                            color: 'var(--color-faint)',
                          }}>
                      {cell.thumb}
                    </span>
                    <span className="min-w-0">
                      {/* Название и бренд — данные арендатора. */}
                      <span className="block truncate font-semibold" style={{ color: 'var(--color-text)' }}>
                        {cell.title}
                      </span>
                      {cell.sub && (
                        <span className="block truncate" style={{ fontSize: 12, color: 'var(--color-faint)' }}>
                          {cell.sub}
                        </span>
                      )}
                    </span>
                  </span>

                  {/* Категорія — чипом, как в §8. Нет категории — пусто,
                      а не «—»: прочерк в чипе выглядит как заполненное поле.
                      Чип ПЕРЕНОСИТСЯ, а не обрезается: «Догляд за волоссям»
                      в одну строку не влезает ни при какой ширине колонки,
                      и «Догляд за…» не отличить от «Догляд за тілом».
                      Двухъярусная клетка §8 разрешена прямо. */}
                  <span className="min-w-0">
                    {cell.category
                      ? <span className="badge inline-block max-w-full text-left"
                              // Высота у `.badge` фиксированная (h-6) — на
                              // двух строках текст вылезал бы за пилюлю.
                              // Здесь чип прямоугольный, как в §8: радиус
                              // 7px из шкалы геометрии, высота по содержимому.
                              style={{
                                whiteSpace: 'normal', lineHeight: 1.35,
                                height: 'auto', padding: '4px 8px', borderRadius: 7,
                              }}>
                          {cell.category}
                        </span>
                      : null}
                  </span>

                  <span className="tabular font-semibold"
                        style={row.state === 'expired'
                          ? { color: 'var(--color-danger)' }
                          : (cell.low || row.state === 'soon' || row.state === 'urgent')
                            ? { color: 'var(--tone-amber)' }
                            : { color: 'var(--color-text)' }}>
                    {cell.qty != null ? t.number(cell.qty) : '—'}
                  </span>
                  <span>{cell.unit || '—'}</span>
                  {/* Место хранения переносится по той же причине, что и
                      чип категории: «Основний склад» и «Основний стелаж»
                      обрезаются в одинаковое «Основний с…». */}
                  <span className="min-w-0" style={{ lineHeight: 1.35 }}>{cell.location ?? '—'}</span>
                  <span className="tabular text-right">
                    {cell.cost != null ? t.money(cell.cost) : '—'}
                  </span>
                  <span className="tabular text-right font-semibold" style={{ color: 'var(--color-text)' }}>
                    {sum != null ? t.money(sum) : '—'}
                  </span>
                  {/* Двухъярусная клетка §8: бейдж и под ним дата, из-за
                      которой он такой. Без даты «Прострочено» не отвечает
                      на вопрос «наскільки». */}
                  <span className="min-w-0">
                    {cell.badge}
                    {cell.date && (
                      <span className="tabular mt-0.5 block truncate"
                            style={{ fontSize: 12, color: 'var(--color-faint)' }}>
                        {short(cell.date)}
                      </span>
                    )}
                    {!cell.badge && !cell.date ? '—' : null}
                  </span>
                  <span aria-hidden className="text-right" style={{ color: 'var(--color-faint)' }}>›</span>
                </Link>
              )
            })}

            {/* «Показано N з M» из §8. Пагинации нет и не подделываем:
                список приходит одной выборкой, и кнопки страниц под ним
                были бы органом управления, который ничего не переключает. */}
            <div className="wtable-foot">
              <span className="tabular">
                {t('inventory.web.table.shown', {
                  n: t.number(visible),
                  // `registryTotal`, а не сумма трёх массивов по месту:
                  // без модуля каталога товаров нет ни в одном списке,
                  // и «Показано 12 з 15» обещало бы три строки, которых
                  // на экране не бывает ни при какой вкладке.
                  total: t.number(registryTotal),
                })}
              </span>
              {/* Денежные итоги — только на вкладке товаров, как и мобильные
                  плитки: посреди смешанного списка они перебивали бы метрики. */}
              {tab === 'goods' && totals && totals.units > 0 && (
                <span className="tabular">
                  {t('inventory.goods.cost')}: {t.money(totals.cost)}
                  {' · '}
                  {t('inventory.goods.retail')}: {t.money(totals.retail)}
                </span>
              )}
            </div>
          </div>
        </section>
        </>
      )}

      {/* ⚠️ КАРТЫ «ЩЕ У СКЛАДІ» ЗДЕСЬ БОЛЬШЕ НЕТ. Владелец 25.08.2026:
          «мне не нравится раздел ще у складі внизу, далеко до него
          листать». Список разделов переехал ЦЕЛИКОМ в шторку огляду
          (её открывает карточка-герой, то есть первый экран, одно
          нажатие) — см. ниже. Второго списка тех же ссылок на странице
          не заводить: дверь, стоящая в двух местах, — тот самый дубляж,
          из-за которого этот экран уже переделывался. */}

      </div>{/* конец основной колонки */}

      {/* ── CRESKO Web: права рейка (§8, только lg) ──────────────
          «Швидкі дії» — тот же массив `more` плюс «Довідники», что и
          в «Ще у складі» ниже lg: рейка ЗАМЕНЯЕТ ту карту на десктопе,
          а не дублирует её (карта на lg скрыта). Свой список ссылок
          рейка не заводит — два списка разъехались бы на первом новом
          экране раздела.
          «Останні рухи» — реальные строки `stock_movements` (шесть
          свежих, запрос в page.tsx), тем же переводчиком типов, что
          экран «Рухи».
          «Топ категорії за вартістю» — третья карточка §8. Прежде её
          здесь не было с объяснением «категорий у записей склада
          в данных экрана не существует»; теперь `category` и
          `cost_per_unit` приезжают той же строкой `materials`, и карта
          считается по НАСТОЯЩИМ запасам, а не по нарисованным полоскам. */}
      <aside className="hidden shrink-0 flex-col gap-4 lg:flex"
             style={{ width: 268 }}>
        <section className="webcard rise-1">
          <p className="webh2 mb-1">{t('inventory.quick.title')}</p>
          {more.map((it) => (
            <Link key={`rail-${it.href}${it.label}`} href={it.href}
                  className="flex items-center gap-3 py-2"
                  {...(it.blank ? { target: '_blank', rel: 'noreferrer' } : {})}>
              {/* Плашка 28px из §8. `.list-anchor` без тона в веб-палитре
                  невидима: её фон — `surfaceMuted` (#FCFCFD) на белой
                  карточке. Тон акцента даёт ровно ту лавандовую плашку,
                  что в референсе. */}
              <span className="list-anchor" data-tone="accent"
                    style={{ width: 28, height: 28, borderRadius: 9 }}>
                <it.icon size={16} />
              </span>
              <span className="t-sm min-w-0 flex-1 truncate">{it.label}</span>
              <span aria-hidden style={{ color: 'var(--color-faint)' }}>›</span>
            </Link>
          ))}
          <button type="button" onClick={() => setAdding('refs')}
                  className="flex w-full items-center gap-3 py-2 text-left">
            <span className="list-anchor" data-tone="accent"
                  style={{ width: 28, height: 28, borderRadius: 9 }}>
              <IconList size={16} />
            </span>
            <span className="t-sm min-w-0 flex-1 truncate">{t('inventory.action.refs')}</span>
            <span aria-hidden style={{ color: 'var(--color-faint)' }}>›</span>
          </button>
        </section>

        {/* Пустой журнал карточку не рисует: заголовок над пустотой —
            обещание данных, которых нет. */}
        {movements.length > 0 && (
          <section className="webcard rise-2">
            <p className="webh2 mb-1">{t('inventory.web.rail.movements')}</p>
            {/* У последней строки черты нет: следом идёт пунктир
                ссылки .webcard-link, и две линии подряд — грязь. */}
            {movements.map((mv, i) => (
              <div key={mv.id} className="flex items-center justify-between gap-3 py-2"
                   style={{
                     borderBottom: i === movements.length - 1
                       ? undefined
                       : '1px solid var(--web-border-row, var(--color-border))',
                   }}>
                <span className="min-w-0">
                  <span className="t-sm block truncate font-semibold"
                        style={{ color: MOVE_INK[mv.type] ?? 'var(--color-text)' }}>
                    {movementLabel(t, mv.type)}
                  </span>
                  {/* Название позиции — данные арендатора. */}
                  <span className="t-xs block truncate" style={{ color: 'var(--color-faint)' }}>
                    {mv.title} · {t.dateTime(mv.createdAt, {
                      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                    })}
                  </span>
                </span>
                {/* Количество в журнале уже со знаком (0003). */}
                <span className="tabular t-sm shrink-0"
                      style={{ color: MOVE_INK[mv.type] ?? 'var(--color-text)' }}>
                  {mv.qty > 0 ? '+' : ''}{t.number(mv.qty)} {mv.unit}
                </span>
              </div>
            ))}
            <Link href="/app/inventory/movements" className="webcard-link">
              {t('inventory.web.rail.allMovements')}
            </Link>
          </section>
        )}

        {/* ── Топ категорії за вартістю (§8) ───────────────────
            Считается по тем же строкам, что и колонка «Сума» в таблице:
            остаток × собівартість, сгруппированные по категории засоба.
            Полоска — доля от САМОЙ ДОРОГОЙ категории, а не от общей
            суммы: в референсе первая полоска всегда полная, и это
            читается как «вот эта — главная», а доли от целого
            на четырёх строках дают четыре одинаково коротких обрубка.

            Без категорий карточка не рисуется вовсе: заголовок над
            одной строкой «— 0 ₴» обещает разрез, которого нет. */}
        {topCategories.length > 0 && (
          <section className="webcard rise-3">
            <p className="webh2 mb-2">{t('inventory.web.rail.topCategories')}</p>
            {topCategories.map((c, i) => (
              <div key={c.name} className={i === 0 ? '' : 'mt-3'}>
                <div className="flex items-baseline justify-between gap-2">
                  {/* Имя категории — данные арендатора. */}
                  <span className="t-sm min-w-0 truncate">{c.name}</span>
                  <span className="tabular t-sm shrink-0 font-semibold"
                        style={{ color: 'var(--color-text)' }}>
                    {t.money(c.sum)}
                  </span>
                </div>
                <div className="mt-1.5 overflow-hidden"
                     style={{ height: 5, borderRadius: 99, background: 'var(--web-border-dash, var(--color-border))' }}>
                  <div style={{
                    height: '100%',
                    width: `${Math.max(4, Math.round((c.sum / topCategories[0].sum) * 100))}%`,
                    borderRadius: 99,
                    background: BAR_TONE[i % BAR_TONE.length],
                  }} />
                </div>
              </div>
            ))}
          </section>
        )}
      </aside>
      </div>{/* конец двухколонника */}

      {/* ── Главное действие ─────────────────────────────────────
          `.fab-wide`, а не круглый плюс: «+ Банка» и «+ Засіб» —
          разные действия, и значком их не различить. */}
      {/* На пустом заведении плавающей кнопки НЕТ: там же, в карточке
          пустого состояния, уже стоит «Додати засіб», и это то же самое
          действие. Две кнопки одного действия в двадцати сантиметрах
          друг от друга — ровно тот дубляж, из-за которого экран
          и переделывался. */}
      {/* На lg плавающей кнопки НЕТ: то же действие стоит в хедере экрана
          рядом с «Прийманням» (§8 — два действия в правом углу). Плавающая
          пилюля поверх таблицы — мобильный приём, и на широком экране она
          была бы вторым входом в то же самое. */}
      {!(visible === 0 && emptyTenant) && <QuickFab actions={quickActions} />}

      {/* ── Формы заведения ──────────────────────────────────── */}
      <Sheet
        open={adding === 'container'}
        onClose={() => setAdding(null)}
        title={t('inventory.sheet.container')}
      >
        <ContainerForm
          tenantId={tenantId} userId={userId}
          materials={materials} batches={batches} suppliers={suppliers}
          onDone={() => setAdding(null)}
        />
      </Sheet>

      <Sheet
        open={adding === 'material'}
        onClose={() => setAdding(null)}
        title={t('inventory.sheet.material')}
      >
        <MaterialForm
          tenantId={tenantId} suppliers={suppliers} locations={locations}
          onDone={() => setAdding(null)}
        />
      </Sheet>

      <Sheet
        open={adding === 'refs'}
        onClose={() => setAdding(null)}
        title={t('inventory.sheet.refs')}
      >
        <RefsForm
          tenantId={tenantId} suppliers={suppliers} locations={locations}
          onDone={() => setAdding(null)}
        />
      </Sheet>

      {/* ── Переміщення ──────────────────────────────────────────
          Четвёртое быстрое действие README. Перенос делает функция
          `relocate_stock` (0113) — та же, что зовёт карточка засоба:
          она пишет след в журнал движений парой transfer-строк, а
          прямой UPDATE `location_id` перенёс бы банку молча. Отличие
          от карточки одно — здесь сначала спрашивается, ЧТО переносим:
          на карточку человек уже пришёл с выбранным засобом, а сюда
          с ряда действий. Поэтому форма здесь, а не импортом: у той
          нет и не должно быть выбора позиции.
          Ёмкости и товары в списке отсутствуют намеренно — место
          хранения есть только у засоба. */}
      <Sheet
        open={adding === 'move'}
        onClose={() => setAdding(null)}
        title={t('inventory.material.relocate.sheet')}
      >
        <MoveForm
          key={moveItem || 'blank'}
          initialMaterialId={moveItem}
          materials={materials} locations={locations} busy={moveBusy}
          onSave={(materialId, locationId, note) => void doRelocate(materialId, locationId, note)}
        />
      </Sheet>

      {/* ── Огляд складу: шторка СВЕРХУ ──────────────────────────
          То, что человек СМОТРИТ и КУДА уходит, а не то, что делает:
          снизу открываются формы с кнопкой сохранения под большим
          пальцем, сверху — обзор, который закрывают тем же движением,
          каким открыли.

          Содержимое не выдумано под красивый блок. Числа, «Топ
          категорії» и «Останні рухи» — ровно те карточки, что на
          широком экране стоят в правой рейке (§8) и до 20.08.2026
          с телефона были недоступны вовсе. А список РАЗДЕЛОВ приехал
          сюда 25.08.2026 с самого низа страницы: владелец назвал
          прямо — «не нравится раздел ще у складі внизу, далеко до
          него листать». Теперь до любого раздела одно нажатие
          с первого экрана, и страница перестала быть длинной.

          Порядок внутри: сначала числа (ради них карточку и нажали),
          потом двери, потом разрезы. */}
      <Sheet open={details} side="top" onClose={() => setDetails(false)}
             title={t('inventory.hero.details')}>
        <div className="flex flex-col gap-4">
          {/* Числа плитками 2×2, а не четырьмя строками во всю ширину.
              Строками они занимали половину шторки, и список разделов
              под ними начинался за краем экрана — то есть до дверей
              снова надо было листать, ровно от чего этот переезд
              и делался. */}
          <div className="grid grid-cols-2 gap-2">
            {([
              [t('inventory.stats.total'), t.number(registryTotal)],
              ...(totals ? [
                [t('inventory.goods.units'), t.number(totals.units)],
                [t('inventory.goods.cost'), t.money(totals.cost)],
                [t('inventory.goods.retail'), t.money(totals.retail)],
              ] as [string, string][] : []),
            ] as [string, string][]).map(([label, val]) => (
              <div key={label} className="card-flat !p-3">
                <p className="t-xs prose-muted">{label}</p>
                <p className="tabular t-lg mt-0.5 font-semibold">{val}</p>
              </div>
            ))}
          </div>

          {/* ── Розділи складу ──────────────────────────────────
              Тот же массив `more`, что держит правая рейка на широком
              экране, плюс «Довідники». Второго списка тех же ссылок
              в продукте нет: рейка ЗАМЕНЯЕТ эту шторку на десктопе,
              а не дублирует её.

              `prefetch` здесь ОСМЫСЛЕН и не расточителен: ссылки
              существуют, только пока шторка открыта, то есть греются
              ровно в ту секунду, когда человек выбирает, куда идти,
              — и к нажатию ответ уже в руках. Вешать то же самое
              на постоянно висящий список внизу было бы восемь
              серверных отрисовок на каждое открытие склада. */}
          <div>
            <p className="eyebrow mb-2">{t('inventory.more.title')}</p>
            <div className="card-flat !p-0">
              {more.map((it) => (
                <Link key={it.href + it.label} href={it.href} className="row px-4"
                      prefetch
                      style={{ minHeight: 'var(--tap-min)' }}
                      onClick={() => setDetails(false)}
                      {...(it.blank ? { target: '_blank', rel: 'noreferrer' } : {})}>
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="list-anchor"><it.icon size={17} /></span>
                    <span className="t-md truncate">{it.label}</span>
                  </span>
                  <span aria-hidden className="shrink-0" style={{ color: 'var(--color-faint)' }}>
                    <IconChevronRight size={16} />
                  </span>
                </Link>
              ))}
              {/* Справочники — шторка, а не экран, поэтому кнопкой.
                  Открывается ПОСЛЕ закрытия этой: две шторки разом
                  запирают прокрутку дважды и вторая не закрывается. */}
              <button type="button"
                      onClick={() => { setDetails(false); setAdding('refs') }}
                      className="row w-full px-4 text-left" style={{ minHeight: 'var(--tap-min)' }}>
                <span className="flex min-w-0 items-center gap-3">
                  <span className="list-anchor"><IconList size={17} /></span>
                  <span className="t-md truncate">{t('inventory.action.refs')}</span>
                </span>
                <span aria-hidden className="shrink-0" style={{ color: 'var(--color-faint)' }}>
                  <IconChevronRight size={16} />
                </span>
              </button>
            </div>
          </div>

          {/* Полоска — доля от САМОЙ ДОРОГОЙ категории, а не от общей
              суммы: доли от целого на четырёх строках дают четыре
              одинаково коротких обрубка. Та же мерка, что в рейке. */}
          {topCategories.length > 0 && (
            <div>
              <p className="eyebrow mb-2">{t('inventory.web.rail.topCategories')}</p>
              {topCategories.map((c, i) => (
                <div key={c.name} className={i === 0 ? '' : 'mt-3'}>
                  <div className="flex items-baseline justify-between gap-2">
                    {/* Имя категории — данные арендатора. */}
                    <span className="t-sm min-w-0 truncate">{c.name}</span>
                    <span className="tabular t-sm shrink-0 font-semibold">{t.money(c.sum)}</span>
                  </div>
                  <div className="mt-1.5 overflow-hidden"
                       style={{ height: 5, borderRadius: 99, background: 'var(--color-surface-2)' }}>
                    <div style={{
                      height: '100%',
                      width: `${Math.max(4, Math.round((c.sum / topCategories[0].sum) * 100))}%`,
                      borderRadius: 99,
                      background: BAR_TONE[i % BAR_TONE.length],
                    }} />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Пустой журнал заголовка не получает: подпись над пустотой —
              обещание данных, которых нет. */}
          {movements.length > 0 && (
            <div>
              <p className="eyebrow mb-2">{t('inventory.web.rail.movements')}</p>
              {/* Две колонки по два яруса, и ни одной точки-разделителя:
                  слева ЧТО (тип и позиция), справа СКОЛЬКО и КОГДА.
                  Раньше название и время стояли одной строкой через
                  точку — на 390px эта строка уезжала в многоточие,
                  и первым обрезалось как раз время. */}
              {movements.map((mv, i) => (
                <div key={mv.id} className="flex items-start justify-between gap-3 py-2"
                     style={{
                       borderBottom: i === movements.length - 1
                         ? undefined
                         : '1px solid var(--color-border)',
                     }}>
                  <span className="min-w-0">
                    <span className="t-sm block truncate font-semibold"
                          style={{ color: MOVE_INK[mv.type] ?? 'var(--color-text)' }}>
                      {movementLabel(t, mv.type)}
                    </span>
                    {/* Название позиции — данные арендатора. */}
                    <span className="t-xs block truncate" style={{ color: 'var(--color-faint)' }}>
                      {mv.title}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    {/* Количество в журнале уже со знаком (0003). */}
                    <span className="tabular t-sm block font-semibold"
                          style={{ color: MOVE_INK[mv.type] ?? 'var(--color-text)' }}>
                      {mv.qty > 0 ? '+' : ''}{t.number(mv.qty)} {mv.unit}
                    </span>
                    <span className="tabular t-xs block" style={{ color: 'var(--color-faint)' }}>
                      {t.dateTime(mv.createdAt, {
                        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                      })}
                    </span>
                  </span>
                </div>
              ))}
              <Link href="/app/inventory/movements" className="btn-secondary mt-3 inline-flex"
                    onClick={() => setDetails(false)}>
                {t('inventory.web.rail.allMovements')}
              </Link>
            </div>
          )}
        </div>
      </Sheet>

      {/* ── Ручной ввод кода ─────────────────────────────────────
          Запасной путь для стёртой наклейки и отказавшей камеры.
          Шторкой, а не полем на странице: постоянное поле ввода кода
          рядом со строкой поиска в шапке и было главным дубляжом,
          из-за которого экран читался как две разные формы поиска. */}
      <Sheet open={manual} onClose={() => { setManual(false); setCode('') }}
             title={t('inventory.manual.title')}>
        <div className="flex flex-col gap-3">
          <p className="t-sm prose-muted">{t('inventory.manual.hint')}</p>
          <input
            ref={inputRef}
            className="input"
            placeholder={t('inventory.manual.placeholder')}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void lookup(code) } }}
            autoComplete="off"
            aria-label={t('inventory.manual.title')}
          />
          <button type="button" className="btn-primary" disabled={!code.trim()}
                  onClick={() => void lookup(code)}>
            {t('inventory.search.find')}
          </button>
        </div>
      </Sheet>

      <Scanner open={camera} onClose={() => setCamera(false)}
               onManual={() => setManual(true)}
               onResult={(v) => { setCode(v); void lookup(v) }} />

    </div>
  )
}

// ── Форма переміщення ───────────────────────────────────────────────────────
//
// Своё состояние держит сама форма, а не экран: поля живут ровно столько,
// сколько открыта шторка, и подниматься в родителя им незачем — иначе
// закрытая шторка продолжала бы помнить наполовину заполненный перенос.
// `initialMaterialId` приходит от свайпа по строке: человек уже указал
// пальцем на позицию, и спрашивать её второй раз значит отменить смысл
// жеста. Родитель монтирует форму заново (`key`), поэтому значение
// читается один раз при создании состояния — эффект синхронизации
// здесь был бы третьим местом, где живёт «что переносим».
function MoveForm({
  materials, locations, busy, onSave, initialMaterialId = '',
}: {
  materials: Material[]
  locations: RefItem[]
  busy: boolean
  initialMaterialId?: string
  onSave: (materialId: string, locationId: string, note: string) => void
}) {
  const t = useT()
  const [materialId, setMaterialId] = useState(initialMaterialId)
  const [locationId, setLocationId] = useState('')
  const [note, setNote] = useState('')

  // Без мест хранения переносить не во что, и пустой список выбора
  // читается как поломка. Отправляем туда, где место заводится.
  if (locations.length === 0 || materials.length === 0) {
    return <p className="t-sm prose-muted">{t('inventory.move.empty')}</p>
  }

  return (
    <form className="grid gap-3"
          onSubmit={(e) => { e.preventDefault(); onSave(materialId, locationId, note) }}>
      <div>
        <label className="field-label" htmlFor="move-item">
          {t('inventory.move.item.label')}
        </label>
        <select id="move-item" className="select" value={materialId} required
                onChange={(e) => setMaterialId(e.target.value)}>
          <option value="">{t('inventory.move.item.placeholder')}</option>
          {/* Имена засобів — данные арендатора, не переводятся. */}
          {materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </div>
      <div>
        <label className="field-label" htmlFor="move-to">
          {t('inventory.material.relocate.to.label')}
        </label>
        <select id="move-to" className="select" value={locationId}
                onChange={(e) => setLocationId(e.target.value)}>
          <option value="">{t('inventory.material.relocate.none')}</option>
          {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </div>
      <div>
        <label className="field-label" htmlFor="move-note">
          {t('inventory.material.relocate.note.label')}
        </label>
        <input id="move-note" className="input" value={note}
               placeholder={t('inventory.material.relocate.note.placeholder')}
               onChange={(e) => setNote(e.target.value)} />
      </div>
      <p className="field-hint">{t('inventory.material.relocate.hint')}</p>
      <button type="submit" className="btn-primary" disabled={busy || !materialId}>
        {busy ? t('common.saving') : t('inventory.material.relocate.submit')}
      </button>
    </form>
  )
}
