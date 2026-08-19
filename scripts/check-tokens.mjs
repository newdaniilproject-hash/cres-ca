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

import { readFileSync } from 'node:fs'
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

if (problems.length > 0) {
  console.error('РОЗХОДЖЕННЯ токенів (globals.css ↔ lib/design/tokens.ts):')
  for (const p of problems) console.error('  •', p)
  console.error('\nЗначення кольору і геометрії живуть у двох виглядах — змінюйте ОБИДВА.')
  process.exit(1)
}

console.log(`Токени зійшлися: ${PAIRS.length} світлих, ${DARK_PAIRS.length} темних, ${RADII.length} радіусів.`)
