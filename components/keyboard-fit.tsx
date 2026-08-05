'use client'

import { useEffect } from 'react'

// Клавиатура и высота экрана.
//
// ГРАБЛИ, из-за которых форма создания заклада наполовину уходила под
// клавиатуру: 100dvh про клавиатуру НЕ знает. В обычном мобильном
// браузере строка адреса и клавиатура уменьшают видимую область, и dvh
// пересчитывается. В веб-вью приложения этого не происходит: страница
// остаётся высотой в целый экран, клавиатура ложится поверх, и нижняя
// треть формы — вместе с кнопкой «Створити заклад» — становится
// недостижимой. scrollIntoView спасает только то поле, в которое уже
// поставили курсор, а кнопку и переключатели — нет.
//
// Единственный источник правды о том, сколько экрана реально осталось, —
// visualViewport. Он есть и в WKWebView, и в Android WebView, и в обычном
// браузере. Разница между окном и видимой областью и есть высота
// клавиатуры; кладём её в переменную --kb, а раскладка сама ужимается
// на эту величину (app/m/layout.tsx, .appshell в globals.css).
//
// Без визуального вьюпорта (старые движки) переменная остаётся нулём —
// поведение ровно то, что было, ничего не ломается.
export function KeyboardFit() {
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return

    const root = document.documentElement
    let raf = 0

    const apply = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        // offsetTop учитывает случай, когда страницу подняли вверх:
        // без него при поднятой клавиатуре получается отрицательный
        // остаток и раскладка дёргается.
        const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
        // Порог: мелкие колебания в 1–2 пикселя даёт строка адреса,
        // и перерисовывать из-за них всю раскладку незачем.
        root.style.setProperty('--kb', kb > 60 ? `${Math.round(kb)}px` : '0px')
      })
    }

    apply()
    vv.addEventListener('resize', apply)
    vv.addEventListener('scroll', apply)
    return () => {
      cancelAnimationFrame(raf)
      vv.removeEventListener('resize', apply)
      vv.removeEventListener('scroll', apply)
      root.style.removeProperty('--kb')
    }
  }, [])

  return null
}
