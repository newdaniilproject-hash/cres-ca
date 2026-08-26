#!/usr/bin/env node
// Сторож единого источника стиля.
//
// Читает `app/globals.css`, достаёт значения переменных и сверяет их
// с `lib/design/tokens.ts`. Расходятся — падает.
//
// ── Зачем ───────────────────────────────────────────────────────────────────
//
// Значения цвета обязаны существовать в двух видах: переменными CSS для
// экрана и строками TypeScript для того, что живёт вне браузера, — печати,
// писем и нативной оболочки (разбор в шапке `lib/design/tokens.ts`).
//
// Две записи одной таблицы расходятся ВСЕГДА, и расходятся молча: правят
// одну, вторую не замечают. Именно так в продукте оказались четыре палитры,
// и отчёт для проверки Держпродспоживслужби печатался цветами оформления,
// которого в интерфейсе нет с 18.08.2026.
//
// Поэтому «один источник правды» здесь не соглашение, а проверка: пока
// она стоит в сборке, разъехаться нельзя. Соглашение без проверки —
// это то же самое, что комментарий «не забудь поправить второе место».
//
// Запуск: node scripts/check-tokens.mjs

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const css = readFileSync(join(root, 'app/globals.css'), 'utf8')
const ts = readFileSync(join(root, 'lib/design/tokens.ts'), 'utf8')

// ── Значения из CSS ─────────────────────────────────────────────────────────
//
// Берём ровно два блока: `:root` (светлая) и `.dark` (тёмная). Внутри
// @media и прочих обёрток переменные не ищем: их там нет, а если появятся —
// это отдельное решение, и сторож должен о нём узнать падением, а не
// молча подхватить.
// Ищем ОБЪЯВЛЕНИЕ блока — с начала строки и со скобкой, а не первое
// упоминание имени. Первое упоминание `html.dark` в этом файле — внутри
// комментария в шапке, и поиск подстрокой брал его, после чего сверял
// светлые значения с тёмными и «находил» двадцать расхождений там,
// где их нет.
function block(name) {
  const decl = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{`, 'm')
  const found = decl.exec(css)
  if (!found) throw new Error(`в globals.css нет блока ${name}`)
  const start = found.index
  const open = css.indexOf('{', start)
  let depth = 0
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1
    else if (css[i] === '}') {
      depth -= 1
      if (depth === 0) return css.slice(open + 1, i)
    }
  }
  throw new Error(`блок ${name} не закрыт`)
}

function vars(text) {
  const out = new Map()
  for (const m of text.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    out.set(m[1], m[2].trim())
  }
  return out
}

// Светлая тема живёт в `@theme` (так её объявляет Tailwind v4 — оттуда же
// он берёт свою шкалу), тёмная перекрывает её в `html.dark`. Имена блоков
// заданы явно и здесь: подставлять «первый попавшийся `:root`» значит
// однажды сверить не тот блок и получить зелёную проверку впустую.
const light = vars(block('@theme'))
const dark = vars(block('html.dark'))

// ── Значения из TypeScript ──────────────────────────────────────────────────
//
// Разбираем текстом, а не импортом: скрипт запускается до сборки, когда
// TypeScript ещё не собран, и тянуть ради одной таблицы транспайлер незачем.
function objectOf(name) {
  const at = ts.indexOf(`export const ${name} = {`)
  if (at < 0) throw new Error(`в tokens.ts нет ${name}`)
  const end = ts.indexOf('} as const', at)
  const body = ts.slice(ts.indexOf('{', at) + 1, end)
  const out = new Map()
  for (const m of body.matchAll(/(\w+)\s*:\s*'([^']+)'/g)) out.set(m[1], m[2])
  return out
}

const tsLight = objectOf('LIGHT')
const tsDark = objectOf('DARK')

// ── Сверка ──────────────────────────────────────────────────────────────────
//
// Пары «ключ в tokens.ts → имя переменной в CSS». Список ЯВНЫЙ: угадывать
// имя по правилу (`accentInk` → `--color-accent-ink`) нельзя — тогда
// опечатка в имени превращается в «пары нет, значит и сверять нечего»,
// то есть в зелёную проверку на разъехавшемся значении.
const PAIRS = [
  ['bg', 'color-bg'],
  ['surface', 'color-surface'],
  ['surface2', 'color-surface-2'],
  ['border', 'color-border'],
  ['borderStrong', 'color-border-strong'],
  ['text', 'color-text'],
  ['muted', 'color-muted'],
  ['faint', 'color-faint'],
  ['accent', 'color-accent'],
  ['accentInk', 'color-accent-ink'],
  ['accentText', 'color-accent-text'],
  ['danger', 'color-danger'],
  ['success', 'color-success'],
  ['warn', 'color-warn'],
]

const DARK_PAIRS = [
  ['bg', 'color-bg'],
  ['surface', 'color-surface'],
  ['surface2', 'color-surface-2'],
  ['text', 'color-text'],
  ['accent', 'color-accent'],
]

const problems = []

function compare(theme, pairs, tsMap, cssMap) {
  for (const [key, cssName] of pairs) {
    const a = tsMap.get(key)
    const b = cssMap.get(cssName)
    if (a === undefined) { problems.push(`${theme}: в tokens.ts нет ключа ${key}`); continue }
    if (b === undefined) { problems.push(`${theme}: в globals.css нет --${cssName}`); continue }
    if (a.toLowerCase() !== b.toLowerCase()) {
      problems.push(`${theme}: ${key} = ${a}, а --${cssName} = ${b}`)
    }
  }
}

compare('світла', PAIRS, tsLight, light)
compare('темна', DARK_PAIRS, tsDark, dark)

// Радиусы — та же лестница и та же опасность разъехаться.
const RADII = [
  ['plate', 'radius-plate'], ['control', 'radius-control'], ['card', 'radius-card'],
  ['calendar', 'radius-calendar'], ['dialog', 'radius-dialog'], ['hero', 'radius-hero'],
]
const tsRadius = new Map(
  [...ts.slice(ts.indexOf('export const RADIUS = {')).matchAll(/(\w+)\s*:\s*(\d+)/g)]
    .map((m) => [m[1], `${m[2]}px`]),
)
for (const [key, cssName] of RADII) {
  const a = tsRadius.get(key)
  const b = light.get(cssName)
  if (a !== b) problems.push(`радіус: ${key} = ${a}, а --${cssName} = ${b}`)
}

// ── Зайвий `*/` вимикає цілий блок правил, і мовчки ────────────────────────
//
// Оплачено 25.08.2026. Правило проти перетягування карток пальцем було
// написано і не діяло: перед ним стояв закритий коментар, а далі — ще
// один абзац і другий `*/`. Абзац став CSS-джерелом, зайвий `*/` —
// сміттям, і Lightning CSS «відновився» тим, що з'їв `@media` і випустив
// селектор `:is() .appshell` — порожній `:is()` не збігається НІ З ЧИМ.
//
// Ні `next build`, ні `tsc --noEmit` цього не бачать: файл валідний,
// збірка зелена, а на телефоні картку так само можна тягнути. Знайшлось
// це лише зчитуванням обчисленого стилю в браузері.
//
// Перевірка тупа і саме тому надійна: скільки відкритих коментарів,
// стільки й закритих. Рівність не доводить, що кожен `*/` на своєму
// місці, але ловить те, що сталось насправді.
for (const [name, text] of [['globals.css', css]]) {
  const opens = (text.match(/\/\*/g) ?? []).length
  const closes = (text.match(/\*\//g) ?? []).length
  if (opens !== closes) {
    problems.push(
      `${name}: коментарів відкрито ${opens}, закрито ${closes} — зайвий «*/» `
      + 'вимикає блок правил мовчки (розбір у цьому файлі вище)',
    )
  }
}

// ── СТОРОЖ ТРЕТІЙ: ключ права, якого немає в role_grants ────────────────────
//
// Оплачено дефектом, знайденим аудитом 25.08.2026. На головному екрані
// стояло `can(m, 'finance.read')` — права з таким ключем у `role_grants`
// немає взагалі, там `finances.read`, у множині. Перевірка повертала
// false у ВСІХ, крім власника: у нього в токені `"*"`, і `tenant_can`
// пропускає будь-що. Тобто у власника картка фінансів була, у менеджера
// й бухгалтера — ніколи, і без жодної помилки на екрані.
//
// Чому цього не бачить ні `tsc`, ні `next build`: аргумент `can()` — це
// рядок, і будь-який рядок валідний. Помилка тиха за побудовою.
//
// Джерело правди — сіди `role_grants` у міграціях. Сторож бере ключі
// звідти і звіряє з тим, що просить код. Не «список у скрипті»: список
// у скрипті став би третім місцем, де живе та сама правда.
// Права видаються міграціями НЕ однією формою: 0001 вставляє парами
// ('admin','catalog.read'), 0039 — через unnest(array[…]), політики
// згадують ключ усередині tenants_with('…'). Перший підхід ловив лише
// першу форму і одразу дав ХИБНЕ спрацювання на `compliance.journal.write`
// (право є, видане unnest-ом). Хибне спрацювання гірше за відсутність
// сторожа: його вимикають, і разом із ним зникає справжня перевірка.
//
// Тому беремо всі рядки виду `щось.щось` з міграцій, крім тих, що
// починаються іменем схеми. Набір виходить ширшим за справжній перелік
// прав — і це свідомий обмін: сторож ловить ОПЕЧАТКУ (ключ, якого немає
// в базі ніде), а не звіряє повний перелік. `finance.read` не зустрічається
// в міграціях жодного разу, і саме тому був спійманий.
const SCHEMAS = /^(public|auth|storage|extensions|net|cron|vault|graphql|pg_catalog|information_schema|realtime)\./
const perms = new Set()
for (const f of readdirSync(join(root, 'supabase/migrations'))) {
  if (!f.endsWith('.sql')) continue
  const sql = readFileSync(join(root, 'supabase/migrations', f), 'utf8')
  for (const m of sql.matchAll(/'([a-z_]+\.[a-z_.]+)'/g)) {
    if (!SCHEMAS.test(m[1])) perms.add(m[1])
  }
}

// Ключі, які код просить у `can()` і `tenants_with()`.
const asked = new Map()
const walk = (dir) => {
  for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue
    const rel = `${dir}/${e.name}`
    if (e.isDirectory()) { walk(rel); continue }
    if (!/\.(ts|tsx)$/.test(e.name)) continue
    const src = readFileSync(join(root, rel), 'utf8')
    for (const m of src.matchAll(/\b(?:can|tenants_with)\(\s*(?:m|membership)?\s*,?\s*'([a-z_]+\.[a-z_.]+)'/g)) {
      if (!asked.has(m[1])) asked.set(m[1], rel)
    }
  }
}
for (const d of ['app', 'lib', 'components']) walk(d)

// Порожній набір ключів із міграцій означає, що зламався розбір, а не що
// прав немає. Мовчазно «все зійшлося» тут гірше за падіння.
if (perms.size === 0) {
  problems.push('role_grants: не вдалося витягти жодного ключа права з міграцій — зламався розбір сторожа')
} else {
  for (const [key, where] of asked) {
    if (!perms.has(key)) {
      problems.push(
        `${where}: право «${key}» не видається жодною міграцією. `
        + 'Перевірка мовчки хибна у всіх, крім власника (у нього в токені «*»)',
      )
    }
  }
}

// ── Сторож 4: скорочений запис ПІСЛЯ докладного в тому самому правилі ───────
//
// Оплачено дефектом 25.08.2026, який жив невідомо скільки і виглядав як
// «клавіатура закриває форму, і система її не помічає». У `.sheet-layer
// .sheet` стояло:
//
//     padding-bottom: var(--kb, 0px);   ← поправка на клавіатуру
//     ...
//     padding: 8px 20px 0;              ← і вона стерта нулем
//
// Скорочений запис нижче ЗАВЖДИ перетирає докладний вище. Правило було,
// коментар про нього був, а до елемента воно не доходило жодного разу.
// Ні `next build`, ні `tsc`, ні око при читанні коду цього не бачать:
// обидва рядки правильні поодинці.
//
// Перевіряються лише ті пари, де такий порядок практично ніколи не буває
// навмисним. `background` сюди НЕ входить: `background: x` + пізніше
// `background-size` — звичайний і правильний порядок (докладний ПІСЛЯ
// скороченого), а зворотний трапляється в темах. Хибне спрацювання
// гірше за відсутність сторожа — його вимикають разом зі справжньою
// перевіркою.
const SHORTHANDS = {
  padding: /^padding-(top|right|bottom|left|inline|block)/,
  margin: /^margin-(top|right|bottom|left|inline|block)/,
  inset: /^(top|right|bottom|left|inset-inline|inset-block)$/,
  'border-radius': /^border-(start|end)-(start|end)-radius$/,
}
// Коментарі знімаються ПЕРШИМИ, і без цього сторож мовчав: у цьому файлі
// майже перед кожним оголошенням стоїть пояснення, і `padding` після
// `/* … */` розбирався як властивість з іменем «/* … */ padding».
// Спіймано спробою порушення — правило проекту: запрет перевіряється
// ПОПЫТКОЙ його порушити, а не наявністю коду.
const bare = css.replace(/\/\*[\s\S]*?\*\//g, '')
// Тіла правил: від `{` до найближчої `}` — тобто найглибші блоки.
// Медіа-запити і `@layer` містять правила, а не оголошення, тому
// зовнішні дужки в вибірку не потрапляють.
for (const block of bare.matchAll(/\{([^{}]*)\}/g)) {
  const decls = block[1].split(';').map((d) => d.trim()).filter(Boolean)
  const seen = new Map()
  decls.forEach((d, i) => {
    const prop = d.split(':')[0].trim()
    if (!prop) return
    seen.set(prop, i)
    const re = SHORTHANDS[prop]
    if (!re) return
    for (const [earlier, at] of seen) {
      if (at < i && re.test(earlier)) {
        problems.push(
          `globals.css: «${prop}» стоїть ПІСЛЯ «${earlier}» в одному правилі — `
          + 'скорочений запис перетирає докладний, і той не діє взагалі',
        )
      }
    }
  })
}

// ── СТОРОЖ 5: у кожної теми має бути ПАРА ─────────────────────────────────
//
// Правило проекту сказано давно і прямо: «правка кольору в одній темі
// без парної правки у другій — помилка приймання, а не дрібниця:
// половина людей побачить рівно те, що не доробили». Правило було,
// перевірки не було ЖОДНОЇ.
//
// Ціна пропуску не косметична і не однакова для всіх. Токен, оголошений
// у світлій і забутий у темній, не «стає сірим» — він успадковує
// СВІТЛЕ значення, тобто дає світлу пляму на темній сторінці. Побачить
// її тільки той, хто ввімкнув темну тему, тобто не той, хто цю правку
// робив.
//
// Палітр дві, і обидві повні пари:
//   • телефон — `@theme` (світла) ↔ `html.dark`;
//   • десктопний веб (CRESKO Web) — `body:has([data-webapp])` ↔
//     `html.dark body:has([data-webapp])`.
//
// Перевіряються КОЛЬОРОВІ токени і тіні. Геометрія (радіуси, відступи,
// шкала кеглів) свідомо поза перевіркою: вона одна на обидві теми,
// і вимагати для неї пари означало б дублювати однакові числа.
const COLORISH = /^--(color|tone|shadow|web)-/

// Тіло блоку за його заголовком: від `{` до парної `}`, з урахуванням
// вкладених дужок. Проста вибірка «до першої }» тут не годиться —
// у `@theme` є вкладені правила.
function bodyOf(marker) {
  const i = bare.indexOf(marker)
  if (i < 0) return null
  const j = bare.indexOf('{', i)
  let depth = 0
  for (let k = j; k < bare.length; k += 1) {
    if (bare[k] === '{') depth += 1
    else if (bare[k] === '}') {
      depth -= 1
      if (depth === 0) return bare.slice(j + 1, k)
    }
  }
  return null
}

const declsOf = (body) => new Set(
  [...body.matchAll(/(--[a-z0-9-]+)\s*:/g)]
    .map((m) => m[1])
    .filter((n) => COLORISH.test(n)),
)

const PALETTES = [
  ['телефон', '@theme', 'html.dark {'],
  ['веб', 'body:has([data-webapp]) {', 'html.dark body:has([data-webapp]) {'],
]
for (const [name, lightMarker, darkMarker] of PALETTES) {
  const lightBody = bodyOf(lightMarker)
  const darkBody = bodyOf(darkMarker)
  if (lightBody === null || darkBody === null) {
    problems.push(`палітра «${name}»: не знайдено блок теми в globals.css`)
    continue
  }
  const l = declsOf(lightBody)
  const d = declsOf(darkBody)
  for (const n of [...l].sort()) {
    if (!d.has(n)) {
      problems.push(
        `палітра «${name}»: ${n} є у світлій темі і ВІДСУТНІЙ у темній — `
        + 'він успадкує світле значення і дасть світлу пляму на темній сторінці',
      )
    }
  }
  for (const n of [...d].sort()) {
    if (!l.has(n)) {
      problems.push(
        `палітра «${name}»: ${n} є у темній темі і ВІДСУТНІЙ у світлій — `
        + 'значення нізвідки взятись не може, отже правило мертве',
      )
    }
  }
}

// ── СТОРОЖ 6: у кожного екрана кабінету має бути стан завантаження ────────
//
// Правило 6 проекту: «ОТВЕТ на нажатие и ЗАГРУЗКА данных — разные сроки,
// и первый не имеет права ждать второго… Экран вне бюджета не принимается
// так же, как экран без состояния загрузки».
//
// Сторінки кабінету — `force-dynamic` і ходять у базу в Ірландію. Без
// `loading.tsx` натискання відповідає ПОРОЖНЕЧЕЮ, поки їде відповідь,
// і людина читає це як кнопку, що не спрацювала. Найгірше — на екранах,
// куди заходять щодня.
//
// Перевірку не замінити оком: новий екран заводять папкою з `page.tsx`,
// і забутий скелетон нічого не ламає — просто робить перехід «липким».
// Знайдено 26.08.2026: без стану завантаження стояли ДЕВʼЯТЬ екранів,
// серед них Клієнти, Фінанси, Замовлення і Налаштування.
{
  const appDir = join(root, 'app', 'app')
  const check = (dir, label) => {
    if (existsSync(join(dir, 'page.tsx')) && !existsSync(join(dir, 'loading.tsx'))) {
      problems.push(
        `${label}: є page.tsx, але немає loading.tsx — `
        + 'натискання на цей екран відповідає порожнечею, поки їде запит',
      )
    }
  }
  const walk = (dir, label) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue
      check(join(dir, e.name), `${label}/${e.name}`)
      walk(join(dir, e.name), `${label}/${e.name}`)
    }
  }
  check(appDir, 'app/app')
  walk(appDir, 'app/app')
}

if (problems.length > 0) {
  console.error('РОЗХОДЖЕННЯ токенів (globals.css ↔ lib/design/tokens.ts):')
  for (const p of problems) console.error('  •', p)
  console.error('\nЗначення кольору і геометрії живуть у двох виглядах — змінюйте ОБИДВА.')
  process.exit(1)
}

console.log(
  `Токени зійшлися: ${PAIRS.length} світлих, ${DARK_PAIRS.length} темних, `
  + `${RADII.length} радіусів; обидві палітри мають пару в темній темі, `
  + 'у кожного екрана кабінету є стан завантаження.',
)
