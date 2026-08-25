'use client'

import { IconChevronRight } from '@/components/icons'

// ── Сворачиваемая секция экрана ─────────────────────────────────────────────
//
// Вынесена из экрана склада 25.08.2026, когда та же механика понадобилась
// карточке засоба. Разметку там писали по месту, и второй такой же блок
// в другом файле разъехался бы с первым на первой правке: у липкого
// подзаголовка есть отступ сверху (`--apphead-h`), поворот стрелки
// и зона нажатия — три величины, которые обязаны совпадать на всех
// экранах, иначе секции «прыгают» при переходе между ними.
//
// ПРАВИЛО ОДНОЙ ОТКРЫТОЙ живёт у РОДИТЕЛЯ, а не здесь: компонент не знает
// о соседях и не должен. Родитель держит ключ раскрытой секции и передаёт
// `open` — так же, как это сделано на складе.
//
// Зачем это вообще (требование владельца 25.08.2026): экран, где восемь
// секций лежат одна под другой, — это полотно, по которому листают вслепую.
// Свёрнутые секции превращают его в оглавление: видно, что есть, и видно,
// сколько внутри.
export function Fold({
  title, count, open, onToggle, tone, children,
}: {
  title: string
  /** Сколько внутри. Без числа заголовок не отвечает «стоит ли открывать». */
  count?: number
  open: boolean
  onToggle: () => void
  /** Красная точка у секции, которая просит внимания. */
  tone?: 'alert'
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      <button type="button" className="group-head" aria-expanded={open} onClick={onToggle}>
        {tone === 'alert' && (
          <span aria-hidden className="hero-dot" style={{ background: 'var(--tone-rose)' }} />
        )}
        <span className="group-head-title">{title}</span>
        {count != null && (
          <span className="count-pill shrink-0" style={{ color: 'var(--color-muted)' }}>
            {count}
          </span>
        )}
        <span className="group-caret"><IconChevronRight size={16} /></span>
      </button>
      {open && children}
    </div>
  )
}
