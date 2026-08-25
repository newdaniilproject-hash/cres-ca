'use client'

import { useEffect } from 'react'

// ── Свайп назад с ПРЕДЫДУЩИМ экраном под пальцем ────────────────────────────
//
// Требование владельца 19.08.2026: «продумай систему возврата назад, чтобы
// как в инсте было свайпом бесшовно и чтобы под этим показывалась страница
// предыдущая».
//
// ЧТО БЫЛО НЕ ТАК. Жест существовал с 11.08.2026, но уводил страницу вправо
// НА ПУСТОТУ: под ней оказывался фон документа. Механика правильная,
// ощущение — нет. В iOS (и в инстаграме, который просто берёт системный
// контроллер) под уезжающим экраном лежит предыдущий и подтягивается
// параллаксом; именно это и читается как «приложение», а не «сайт».
//
// ПОЧЕМУ ЭТО НЕЛЬЗЯ ВЗЯТЬ У БРАУЗЕРА. Обёртка — один WebView на удалённом
// адресе, вся навигация внутри него. Системного жеста здесь нет: на iOS
// он выключен, на Android назначен аппаратной кнопке. А предыдущую
// СТРАНИЦУ никто не хранит: Next отрисует её только после `history.back()`,
// то есть уже после того, как жест закончился.
//
// ЧТО СДЕЛАНО. Предыдущий экран сохраняется САМ, до ухода с него:
// в момент нажатия на внутреннюю ссылку живое дерево `#page` клонируется
// (`cloneNode`, не строка — ни сериализации, ни разбора) и кладётся
// в стек. Жест достаёт верхний снимок и показывает его под уезжающей
// страницей с тем же параллаксом, что у системного: −25% ширины → 0
// плюс затемнение, которое гаснет к концу.
//
// Снимок — КАРТИНКА, а не работающий экран: обработчиков в клоне нет,
// и это правильно. Он живёт доли секунды и заменяется настоящей
// страницей, как только `history.back()` отработает.
//
// Правила самого жеста (проверены на устройстве, не менять «на глаз»):
//  • начинается ТОЛЬКО у самого края (24px), иначе крадёт горизонтальную
//    прокрутку у вкладок и лент;
//  • вертикальное движение отменяет жест: человек листает список;
//  • порог — треть ширины либо быстрый рывок; не дотянул — возврат
//    с пружиной;
//  • возвращаться некуда — жеста нет вовсе: пустой отклик хуже
//    отсутствующего;
//  • отклик пальцу в момент, когда переход стал неизбежен.

type Snap = { node: HTMLElement; scrollY: number }

// Стек снимков. Глубина три: дальше человек по одному жесту не уходит,
// а каждый снимок — это дерево целого экрана в памяти.
const stack: Snap[] = []
const DEPTH = 3

export function SwipeBack() {
  useEffect(() => {
    if (typeof document === 'undefined') return
    if (!document.documentElement.hasAttribute('data-native')) return

    const page = () => document.getElementById('page')

    // ── Снимок экрана, с которого уходим ────────────────────────────────
    //
    // Ловим нажатие по внутренней ссылке в ФАЗЕ ЗАХВАТА: до того, как
    // Next начнёт переход. Клонируем, а не сериализуем в строку —
    // `cloneNode` не трогает разметку текстом и на дереве кабинета
    // укладывается в единицы миллисекунд, то есть нажатие остаётся
    // мгновенным (правило 6: ответ на нажатие и загрузка данных —
    // разные сроки).
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!a || a.target === '_blank') return
      let url: URL
      try { url = new URL(a.href, location.href) } catch { return }
      if (url.origin !== location.origin) return
      // Якорь на той же странице переходом не является.
      if (url.pathname === location.pathname) return
      const el = page()
      if (!el) return
      const copy = el.cloneNode(true) as HTMLElement
      // ⚠️ У КЛОНА СНИМАЕТСЯ `id`, и это не косметика. Клон — копия `#page`
      // целиком, включая идентификатор; подложка вставляется ПЕРВЫМ узлом
      // body, поэтому `getElementById('page')` начинал возвращать КОПИЮ.
      // Жест двигал снимок, живая страница стояла на месте, и со стороны
      // это выглядело как «свайп не работает» — при том что все замеры
      // (transform, координаты) показывали правильные числа: они снимались
      // с того же клона. Поймано на прогоне в браузере.
      copy.removeAttribute('id')
      stack.push({ node: copy, scrollY: window.scrollY })
      if (stack.length > DEPTH) stack.shift()
    }

    // Вернулись назад — верхний снимок стал настоящей страницей
    // и больше не нужен. Без этого стек растёт, а под жестом
    // показывался бы экран через один.
    const onPop = () => { stack.pop() }

    const EDGE = 24
    let x0 = 0
    let y0 = 0
    let dx = 0
    let t0 = 0
    let active = false
    let armed = false
    let under: HTMLElement | null = null
    let scrim: HTMLElement | null = null
    // Живая страница берётся ОДИН раз на жест: пока подложка в дереве,
    // повторный поиск по документу дороже и опаснее (см. снятый `id`).
    let live: HTMLElement | null = null

    // Подложка собирается на КАЖДЫЙ жест и на нём же умирает: держать
    // её в дереве постоянно значит держать вторую копию экрана вживую.
    const mountUnder = () => {
      const snap = stack[stack.length - 1]
      if (!snap) return
      under = document.createElement('div')
      under.id = 'swipe-under'
      // Снимок был сделан у прокрученной страницы: сдвигаем его вверх
      // ровно на ту прокрутку, иначе под пальцем окажется начало экрана,
      // а не то место, где человек был.
      const inner = document.createElement('div')
      inner.style.cssText =
        `position:absolute;left:0;right:0;top:${-snap.scrollY}px;`
      inner.appendChild(snap.node.cloneNode(true))
      under.appendChild(inner)

      scrim = document.createElement('div')
      scrim.id = 'swipe-scrim'
      under.appendChild(scrim)
      document.body.insertBefore(under, document.body.firstChild)
    }

    const unmountUnder = () => {
      under?.remove()
      under = null
      scrim = null
      document.documentElement.style.overflowX = ''
    }

    const paint = (v: number) => {
      const el = live
      if (!el) return
      el.style.transition = 'none'
      el.style.transform = v ? `translateX(${v}px)` : ''
      if (under) {
        // Параллакс: предыдущий экран идёт следом вчетверо медленнее
        // и «догоняет» ровно к концу жеста. Числа те же, что у системного
        // контроллера iOS, — с другими жест ощущается чужим.
        const p = Math.min(1, v / window.innerWidth)
        under.firstElementChild?.setAttribute(
          'style',
          `position:absolute;left:0;right:0;top:${-(stack[stack.length - 1]?.scrollY ?? 0)}px;`
          + `transform:translateX(${(p - 1) * 25}%);`,
        )
        if (scrim) scrim.style.opacity = String((1 - p) * 0.16)
      }
    }

    const reset = (animate: boolean) => {
      const el = live
      if (el) {
        el.style.transition = animate ? 'transform var(--dur-base) var(--ease-out-soft)' : 'none'
        el.style.transform = ''
      }
      if (animate && under) {
        // Подложка уезжает вместе со страницей, а не пропадает мгновенно:
        // исчезающий под пальцем экран читается как сбой отрисовки.
        const inner = under.firstElementChild as HTMLElement | null
        if (inner) {
          inner.style.transition = 'transform var(--dur-base) var(--ease-out-soft)'
          inner.style.transform = 'translateX(-25%)'
        }
        if (scrim) scrim.style.opacity = '0.16'
        setTimeout(unmountUnder, 220)
      } else {
        unmountUnder()
      }
      active = false
      armed = false
      dx = 0
      live = null
    }

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      const t = e.touches[0]
      if (t.clientX > EDGE) return
      if (window.history.length <= 1) return
      x0 = t.clientX; y0 = t.clientY; t0 = Date.now()
      active = true; armed = false; dx = 0
      live = page()
      // Уехавшая вправо страница расширяет документ вбок, и появляется
      // горизонтальная прокрутка — палец, соскользнувший с жеста, начинает
      // таскать страницу вбок. `clip`, а не `hidden`: `hidden` завёл бы
      // ещё один контейнер прокрутки, и липкая шапка перестала бы липнуть.
      document.documentElement.style.overflowX = 'clip'
      mountUnder()
    }

    const onMove = (e: TouchEvent) => {
      if (!active) return
      const t = e.touches[0]
      const mx = t.clientX - x0
      const my = t.clientY - y0
      if (Math.abs(my) > Math.abs(mx) && Math.abs(my) > 12) { reset(true); return }
      if (mx <= 0) { dx = 0; paint(0); return }
      dx = mx
      const need = window.innerWidth / 3
      if (!armed && dx > need) armed = true
      paint(dx > need ? need + (dx - need) * 0.4 : dx)
      if (e.cancelable) e.preventDefault()
    }

    const onEnd = () => {
      if (!active) return
      const fast = Date.now() - t0 < 300 && dx > 60
      const far = dx > window.innerWidth / 3
      if (far || fast) {
        const el = live
        const w = window.innerWidth
        if (el) {
          el.style.transition = 'transform var(--dur-exit) var(--ease-out-soft)'
          el.style.transform = `translateX(${w}px)`
        }
        // Предыдущий экран доводится до места ТОЙ ЖЕ анимацией: он и есть
        // то, ради чего жест начинали, и появиться рывком не имеет права.
        const inner = under?.firstElementChild as HTMLElement | null
        if (inner) {
          inner.style.transition = 'transform var(--dur-exit) var(--ease-out-soft)'
          inner.style.transform = 'translateX(0)'
        }
        if (scrim) scrim.style.opacity = '0'
        active = false; armed = false; dx = 0
        live = null
        setTimeout(() => {
          if (el) { el.style.transition = 'none'; el.style.transform = '' }
          // Снимок снимается ЗДЕСЬ, а не в `popstate`: до отрисовки
          // настоящей страницы подложка обязана остаться на экране,
          // иначе в стык между ними видно пустой фон.
          window.history.back()
          setTimeout(unmountUnder, 220)
        }, 130)
        return
      }
      reset(true)
    }

    document.addEventListener('click', onClick, true)
    window.addEventListener('popstate', onPop)
    document.addEventListener('touchstart', onStart, { passive: true })
    document.addEventListener('touchmove', onMove, { passive: false })
    document.addEventListener('touchend', onEnd, { passive: true })
    document.addEventListener('touchcancel', onEnd, { passive: true })
    return () => {
      document.removeEventListener('click', onClick, true)
      window.removeEventListener('popstate', onPop)
      document.removeEventListener('touchstart', onStart)
      document.removeEventListener('touchmove', onMove)
      document.removeEventListener('touchend', onEnd)
      document.removeEventListener('touchcancel', onEnd)
      reset(false)
    }
  }, [])

  return null
}
