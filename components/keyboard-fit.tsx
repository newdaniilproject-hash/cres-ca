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
    // Последние ЗАПИСАННЫЕ значения. Без этой пары запись шла на каждое
    // событие, в том числе когда число не изменилось, — и любой подписчик
    // на эти переменные пересчитывал раскладку впустую.
    //
    // ГРАБЛЯ 12.08.2026, стоила отказа обёртки: m/layout.tsx держал на
    // --vvh высоту С АНИМАЦИЕЙ. Повторная запись перезапускала transition,
    // едущая высота меняла область прокрутки, visualViewport стрелял
    // 'scroll', сюда приходило новое событие — кольцо на каждый кадр,
    // WebContent-процесс съедал память, iOS его убивал, человек видел
    // «This page couldn't load». Анимацию из layout убрали, но сторож
    // остаётся: следующий, кто повесит на эти переменные что-то тяжёлое,
    // не должен заново оплачивать тот же урок.
    let lastH = -1
    let lastT = -1
    const apply = () => {
      if (!vv) return
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const h = Math.round(vv.height)
        const t = Math.round(vv.offsetTop)
        if (h === lastH && t === lastT) return
        lastH = h
        lastT = t
        root.style.setProperty('--vvh', `${h}px`)
        root.style.setProperty('--vvt', `${t}px`)
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
    // Поднять поле к верхней кромке экрана.
    //
    // block: 'start', а НЕ 'center'. Центр — это середина той высоты,
    // которую браузер СЧИТАЕТ видимой; в веб-вью он считает её неверно
    // и «центрирует» поле ровно под клавиатуру. Верхняя кромка от
    // измерений не зависит: выше неё клавиатуры не бывает. Отступ под
    // подпись поля даёт scroll-margin-top в globals.css.
    //
    // Дважды: сразу плавно и через 420 мс — рывком. Клавиатура выезжает
    // около трети секунды, и первый расчёт делается по ещё не сжатому
    // экрану. Второй заход намеренно МГНОВЕННЫЙ: плавная прокрутка
    // асинхронна, её может съесть что угодно — палец, перерисовка,
    // заморозка анимаций. Мгновенная выполняется всегда, и именно она
    // гарантирует, что поле окажется наверху.
    const lift = (el: HTMLElement) => {
      setTimeout(() => el.scrollIntoView({ block: 'start', behavior: 'smooth' }), 60)
      setTimeout(() => el.scrollIntoView({ block: 'start', behavior: 'instant' as ScrollBehavior }), 420)
    }

    let blurTimer = 0
    const onIn = (e: FocusEvent) => {
      if (!isField(e.target)) return
      clearTimeout(blurTimer)
      document.body.classList.add('kb-open')
      // Прокрутка здесь, а не в onFocus каждого поля. Причина та же,
      // что у отклика на касание: расставленное руками где-нибудь
      // забудут, и половина форм будет вести себя правильно, а
      // половина — нет. Здесь это работает для всех полей приложения,
      // включая кабинет, без единой правки в компонентах.
      lift(e.target as HTMLElement)
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
