'use client'

import { useEffect, useRef, useState } from 'react'
import { Sheet } from '@/components/sheet'
import { useT } from '@/lib/i18n/client'

// ── Робота за техкартою: крок за кроком, з таймером витримки ────────────────
//
// ТЗ 3.4 вимагає «електронні регламенти вимочування/підготовки волокна
// (використані розчини, пропорції, ЧАС ВИТРИМКИ) для забезпечення безпеки
// клієнта та запобігання алергічним реакціям». До 25.08.2026 карта була
// СПИСКОМ У РОЗГОРНУТІЙ ВЕРСІЇ — довідником, який читають, а не тим,
// за чим працюють. А витримка і температура з бази до екрана не доходили
// взагалі (див. `normalizeSteps`).
//
// Різниця не косметична. Крок пресету 0040 звучить так: «Занурити пасма
// повністю. Витримка 20 хвилин. Понад 30 хвилин не тримати — волокно
// втрачає форму». Двадцять хвилин у списку — це число, яке майстер
// тримає в голові між клієнтами; двадцять хвилин таймером — це те, чого
// не можна перетримати.
//
// ЧОГО ЦЕЙ ЕКРАН НЕ РОБИТЬ І ЧОМУ. Він нічого не пише в базу. Карта веде
// порядок дій — це регламент, а не журнал. ТЗ перелічує, що потрапляє
// в незмінюваний журнал подій, і виконання техкарти там не названо;
// заводити під це таблицю значить вигадати вимогу за замовника. Підпис
// під екраном каже це прямо, щоб ніхто не вирішив, що «пройшов карту»
// десь зафіксовано.
export type RunStep = {
  step: string
  solution: string
  proportion: string
  minutes: string
  holdMinutes: string
  temperature: string
  note: string
}

// Скільки секунд лишилось. Рахується від МОМЕНТУ ЗАПУСКУ, а не
// відніманням одиниці щосекунди: телефон гасне в кишені, вкладка
// присипляється, і лічильник, що зменшує сам себе, після пробудження
// показує неправду — саме ту, через яку волокно перетримують.
function leftSeconds(startedAt: number, totalSec: number, now: number) {
  return Math.max(0, totalSec - Math.floor((now - startedAt) / 1000))
}

const mmss = (sec: number) =>
  `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`

export function CardRunner({
  open, onClose, title, steps,
}: {
  open: boolean
  onClose: () => void
  title: string
  steps: RunStep[]
}) {
  const t = useT()
  const [i, setI] = useState(0)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  // Момент відкриття шторки — щоб перезапуск починався з першого кроку,
  // а не з того, де людину перервали минулого разу.
  const wasOpen = useRef(false)

  useEffect(() => {
    if (open && !wasOpen.current) { setI(0); setStartedAt(null) }
    wasOpen.current = open
  }, [open])

  // Тікає, лише поки таймер запущено: постійний інтервал на закритій
  // шторці — це щосекундна перемальовка екрана ні за чим.
  useEffect(() => {
    if (!open || startedAt === null) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [open, startedAt])

  const s: RunStep | undefined = steps[i]
  if (!s) return null

  // Таймер веде ВИТРИМКУ, а не тривалість кроку. Це різні величини:
  // «крок займає 5 хвилин» і «тримати рівно 20» — друге можна
  // перетримати, перше ні. Витримки немає — немає й таймера, і крок
  // просто читається.
  const holdSec = Number(s.holdMinutes) > 0 ? Number(s.holdMinutes) * 60 : 0
  const left = startedAt !== null ? leftSeconds(startedAt, holdSec, now) : holdSec
  const ringing = startedAt !== null && left === 0
  const last = i === steps.length - 1

  const go = (next: number) => { setI(next); setStartedAt(null) }

  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div className="flex flex-col gap-4">
        {/* Смуга поступу — де людина в карті. Без неї покроковий режим
            перетворює регламент із семи кроків на нескінченну стрічку:
            видно один крок і невідомо, скільки ще. */}
        <div>
          {/* ⚠️ БЕЗ КАПСЛОКА, і це не смак. `.eyebrow` піднімає регістр,
              а в «Крок 3 з 3» прийменник «з» стає «З» — заглавна З
              в цьому гротеску не відрізняється від трійки, і рядок
              читається як «КРОК 3 3 3». Видно тільки на рендері. */}
          <p className="t-sm mb-2" style={{ color: 'var(--color-muted)' }}>
            {t('techcards.run.title', {
              n: String(i + 1), total: String(steps.length),
            })}
          </p>
          <div className="hero-bar">
            {steps.map((_, n) => (
              <span key={n}
                    style={{
                      width: `${100 / steps.length}%`,
                      background: n <= i ? 'var(--color-accent)' : 'transparent',
                    }} />
            ))}
          </div>
        </div>

        {/* Текст кроку, розчин, пропорція і примітка — регламент закладу,
            тобто дані орендаря: вони не перекладаються. */}
        <p className="display t-2xl">{s.step}</p>

        {(s.solution || s.proportion || s.temperature) && (
          <div className="kv">
            {s.solution && (
              <div className="kv-row">
                <span className="kv-key">{t('techcards.step.solution.label')}</span>
                <span className="kv-val">{s.solution}</span>
              </div>
            )}
            {s.proportion && (
              <div className="kv-row">
                <span className="kv-key">{t('techcards.step.proportion.label')}</span>
                <span className="kv-val tabular">{s.proportion}</span>
              </div>
            )}
            {s.temperature && (
              <div className="kv-row">
                {/* Підпис БЕЗ одиниці: вона вже стоїть у значенні,
                    і «Температура, °C … 45 °C» називала градуси двічі.
                    У формі правки підпис лишається з одиницею — там
                    вона підказує, в чому вводити. */}
                <span className="kv-key">{t('techcards.run.tempLabel')}</span>
                <span className="kv-val tabular">
                  {t('techcards.run.temp', { n: s.temperature })}
                </span>
              </div>
            )}
          </div>
        )}

        {s.note && <p className="t-sm prose-muted">{s.note}</p>}

        {holdSec > 0 && (
          <div className="card-flat flex flex-col items-center gap-3">
            <p className="eyebrow">{t('techcards.run.hold')}</p>
            {/* Кегль зі шкали (`--text-3xl`), а не своє число: таймер
                читають з відстані витягнутої руки, і 30px — найбільший,
                що в шкалі є. */}
            <p className="hero-value tabular"
               style={{ color: ringing ? 'var(--color-success)' : undefined }}>
              {mmss(left)}
            </p>
            {ringing ? (
              <p className="t-sm" style={{ color: 'var(--color-success)' }}>
                {t('techcards.run.done')}
              </p>
            ) : (
              <button type="button"
                      className={startedAt === null ? 'btn-primary' : 'btn-secondary'}
                      onClick={() => setStartedAt(startedAt === null ? Date.now() : null)}>
                {t(startedAt === null ? 'techcards.run.startTimer' : 'techcards.run.stopTimer')}
              </button>
            )}
          </div>
        )}

        <p className="field-hint">{t('techcards.run.hint')}</p>

        <div className="flex gap-2">
          <button type="button" className="btn-secondary flex-1"
                  disabled={i === 0} onClick={() => go(i - 1)}>
            {t('techcards.run.back')}
          </button>
          <button type="button" className="btn-primary flex-1"
                  onClick={() => (last ? onClose() : go(i + 1))}>
            {t(last ? 'techcards.run.finish' : 'techcards.run.next')}
          </button>
        </div>
      </div>
    </Sheet>
  )
}
