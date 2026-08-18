'use client'

import { useEffect, useState } from 'react'
import { useT } from '@/lib/i18n/client'

// ── Размер текста ───────────────────────────────────────────────────────────
//
// Решение владельца 18.08.2026: человек должен уметь сделать шрифт крупнее
// или мельче ползунком. Мастеру за сорок нужен весь текст крупнее, а не
// «настройки для слабовидящих» отдельным режимом.
//
// Как это устроено. Ползунок двигает ОДИН множитель `--type-scale` на
// корне документа, а вся типографическая шкала выражена через него
// (`app/globals.css`). Второй шкалы «крупный вид» не заводится: она
// разъедется с первой на первой же правке, а половина текста останется
// прежнего размера — ровно то, из-за чего такие режимы и выглядят
// недоделанными.
//
// Отступы и зона нажатия множителем НЕ трогаются: они в пикселях
// и остаются как заданы. Растянуть заодно раскладку значит проверять
// заново каждый экран, а `--tap-min` и так 44px — крупному тексту
// есть где стоять.
const KEY = 'text-scale'

// Границы выбраны по тому, что видно на экране, а не «покрасивее».
// 0.9 — нижняя: мельче поля упираются в порог 16px (ниже него iOS зумит
// страницу и обратно не отъезжает), и дальнейшее уменьшение перестало бы
// что-либо менять в формах. 1.4 — верхняя: на 390px заголовок раздела
// в две строки ещё читается, дальше начинает рвать строки списка.
const MIN = 0.9
const MAX = 1.4
const STEP = 0.05

const clamp = (v: number) => Math.min(MAX, Math.max(MIN, v))

// Загрузочный скрипт — синхронно в <head>, ДО первой отрисовки, ровно как
// у темы. Иначе первый кадр рисуется прежним размером, и человек с крупным
// шрифтом видит, как страница дёргается и переверстывается у него на глазах.
export const textScaleBootScript =
  `(function(){try{var v=parseFloat(localStorage.getItem('${KEY}'));` +
  `if(v&&v>=${MIN}&&v<=${MAX}&&v!==1){document.documentElement.style.setProperty('--type-scale',String(v))}}catch(e){}})()`

function apply(v: number) {
  const root = document.documentElement
  // Ровно 1 — это умолчание из таблицы стилей, и его надо СНИМАТЬ, а не
  // записывать: оставленное инлайновое значение перекрыло бы правку шкалы
  // в globals.css, если она когда-нибудь изменится.
  if (v === 1) root.style.removeProperty('--type-scale')
  else root.style.setProperty('--type-scale', String(v))
  try { localStorage.setItem(KEY, String(v)) } catch { /* приватный режим */ }
}

export function TextSize({ className = '' }: { className?: string }) {
  const t = useT()
  const [value, setValue] = useState(1)

  useEffect(() => {
    // Читаем не localStorage, а само свойство: его уже поставил загрузочный
    // скрипт, и это единственное место, где состояние совпадает с картинкой.
    const cur = getComputedStyle(document.documentElement).getPropertyValue('--type-scale')
    const n = parseFloat(cur)
    setValue(Number.isFinite(n) && n > 0 ? clamp(n) : 1)
  }, [])

  function pick(next: number) {
    const v = clamp(Math.round(next / STEP) * STEP)
    setValue(v)
    apply(v)
  }

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="t-md">{t('textsize.title')}</span>
        {/* Процент, а не «маленький / средний / большой»: три слова не
            дают понять, насколько шаг велик, и человек дёргает ползунок
            наугад. Число сразу говорит, где он относительно обычного. */}
        <span className="tabular t-sm prose-muted">{Math.round(value * 100)}%</span>
      </div>

      <div className="flex items-center gap-3">
        {/* Буквы по краям — единственная подпись, которая не требует
            перевода и читается мгновенно: маленькая «А» слева,
            большая справа. */}
        <span aria-hidden style={{ fontSize: 13, color: 'var(--color-faint)' }}>А</span>
        <input
          type="range"
          className="flex-1"
          min={MIN}
          max={MAX}
          step={STEP}
          value={value}
          onChange={(e) => pick(parseFloat(e.target.value))}
          aria-label={t('textsize.aria')}
          aria-valuetext={`${Math.round(value * 100)}%`}
          style={{ accentColor: 'var(--color-accent)', minHeight: 'var(--tap-min)' }}
        />
        <span aria-hidden style={{ fontSize: 22, color: 'var(--color-faint)' }}>А</span>
      </div>

      {/* Сброс появляется только когда есть что сбрасывать. Без него
          вернуться ровно к 100% ползунком можно, но попадать пальцем
          в одно деление из одиннадцати — занятие на несколько попыток. */}
      {value !== 1 && (
        <button type="button" onClick={() => pick(1)} className="btn-ghost t-sm self-start">
          {t('textsize.reset')}
        </button>
      )}
    </div>
  )
}
