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
// ТРЕТИЙ РАЗ, 18.08.2026, и уже в обратную сторону: поправка стала
// сама себе дефектом. Она ТАЩИЛА поле к верхней кромке всегда, а форме
// добавляла запас снизу в пол-экрана, чтобы дотащить было куда. Пока
// веб-вью не ужималось, это спасало; после перехода на
// `Keyboard.resize: 'native'` спасать стало нечего, а рывок и пустота
// остались. Владелец: «клавиатура очень некрасиво обрезает всё».
//
// Теперь здесь МИНИМАЛЬНОЕ вмешательство: пока поле видно — не
// двигается ничего вообще; если поле ушло за кромку — доводим его до
// кромки и не дальше. Запас в пол-экрана снят из globals.css в том же
// коммите: это была одна механика, и половинками она не работает.
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
    // ── ПОДВИНУТЬ ЭКРАН ТОЛЬКО ЕСЛИ ПОЛЕ РЕАЛЬНО ЗАКРЫТО ────────
    //
    // Здесь стояло `scrollIntoView({ block: 'start' })` дважды — оно
    // ТАЩИЛО поле к верхней кромке всегда, даже когда поле и так было
    // прекрасно видно. Вместе с запасом `padding-bottom: 55vh` (снят
    // из globals.css) это давало картину, которую владелец описал как
    // «клавиатура очень некрасиво обрезает всё» (18.08.2026): заголовок
    // экрана уезжал за верх, а под кнопкой зияла пустота в пол-экрана.
    //
    // Настоящее приложение так себя не ведёт. Там при фокусе НЕ
    // ДВИГАЕТСЯ НИЧЕГО, пока поле видно, — и подъезжает ровно на
    // столько, на сколько нужно, если поле оказалось под клавиатурой.
    // Это и есть `block: 'nearest'`: минимальная прокрутка, и полный
    // ноль, когда поле уже в кадре.
    //
    // Почему это стало возможно. Прежний ход был написан под
    // `Keyboard.resize: 'body'`, когда веб-вью оставалось во весь экран
    // и браузер считал видимую высоту неверно. Сейчас в обёртке стоит
    // `resize: 'native'` — веб-вью ужимается само, рамка `/m` уже равна
    // `--vvh`, то есть видимой части. Раз высота честная, тащить руками
    // нечего: браузер доводит поле сам, а мы только проверяем итог.
    //
    // Проверка отложена: клавиатура выезжает около трети секунды, и
    // измерять раньше бессмысленно. Два захода — на случай медленной
    // анимации; оба ничего не делают, если поле в кадре.
    const covered = (el: HTMLElement) => {
      const r = el.getBoundingClientRect()
      const top = vv?.offsetTop ?? 0
      const h = vv?.height ?? window.innerHeight
      // По 8px запаса с каждой стороны: поле, край которого совпал
      // с кромкой пиксель в пиксель, человек читает как обрезанное.
      return r.top < top + 8 || r.bottom > top + h - 8
    }
    const timers: number[] = []
    const nudge = (el: HTMLElement) => {
      timers.forEach(clearTimeout)
      timers.length = 0
      for (const ms of [350, 650]) {
        timers.push(window.setTimeout(() => {
          if (document.activeElement !== el) return
          if (!covered(el)) return
          el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
        }, ms))
      }
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
      nudge(e.target as HTMLElement)
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
      timers.forEach(clearTimeout)
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
