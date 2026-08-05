'use client'

import { useEffect } from 'react'

// Клавиатура и высота экрана.
//
// ЧТО БЫЛО СЛОМАНО ДВАЖДЫ. Первый раз — раскладка в 100dvh: в веб-вью
// dvh про клавиатуру не знает, страница остаётся во весь экран,
// клавиатура ложится поверх, нижние поля недостижимы.
//
// Второй раз — попытка вычесть высоту клавиатуры как
// innerHeight - visualViewport.height. В веб-вью с Capacitor Keyboard
// (resize: 'body') оба числа уменьшаются ОДИНАКОВО, разность выходит
// нулём, и поправка не применяется вовсе. Поле «Місто» так и осталось
// под клавиатурой.
//
// ВЫВОД, ради которого переписано: не вычислять клавиатуру, а взять
// то единственное, что и так означает «видимая часть экрана», —
// visualViewport.height. Оно верно в любом из режимов: если веб-вью
// уже ужали нативно, там ужатая высота; если не ужали — высота над
// клавиатурой. Разность больше нигде не считается.
//
// И вторая, независимая страховка — класс kb-open на body по фокусу
// в поле. Она работает даже если visualViewport врёт или его нет:
// прокручиваемому экрану добавляется запас снизу, и поле поднимается
// к верхней кромке. Две защиты вместо одной сознательно — на этом
// уже дважды обожглись.
export function KeyboardFit() {
  useEffect(() => {
    const root = document.documentElement

    // ── 1. Реальная видимая высота ──────────────────────────────
    const vv = window.visualViewport
    let raf = 0
    const apply = () => {
      if (!vv) return
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        root.style.setProperty('--vvh', `${Math.round(vv.height)}px`)
        root.style.setProperty('--vvt', `${Math.round(vv.offsetTop)}px`)
      })
    }
    apply()
    vv?.addEventListener('resize', apply)
    vv?.addEventListener('scroll', apply)

    // ── 2. Признак «сейчас печатают» ────────────────────────────
    // Не зависит ни от каких измерений: событие фокуса есть везде.
    const isField = (t: EventTarget | null) => {
      const el = t as HTMLElement | null
      if (!el) return false
      const tag = el.tagName
      return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable
    }
    let blurTimer = 0
    const onIn = (e: FocusEvent) => {
      if (!isField(e.target)) return
      clearTimeout(blurTimer)
      document.body.classList.add('kb-open')
    }
    const onOut = (e: FocusEvent) => {
      if (!isField(e.target)) return
      // Переход между полями не должен схлопывать запас и дёргать экран.
      clearTimeout(blurTimer)
      blurTimer = window.setTimeout(() => {
        if (!isField(document.activeElement)) document.body.classList.remove('kb-open')
      }, 120)
    }
    document.addEventListener('focusin', onIn)
    document.addEventListener('focusout', onOut)

    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(blurTimer)
      vv?.removeEventListener('resize', apply)
      vv?.removeEventListener('scroll', apply)
      document.removeEventListener('focusin', onIn)
      document.removeEventListener('focusout', onOut)
      root.style.removeProperty('--vvh')
      root.style.removeProperty('--vvt')
      document.body.classList.remove('kb-open')
    }
  }, [])

  return null
}
