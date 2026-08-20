'use client'

// Клиентский компонент явно: раскладку входа рисуют только клиентские
// экраны (`login`, `register`, `forgot`, `reset`), и она давно приезжала
// в браузерный бандл вместе с ними. Пометка нужна `useT`.

import Link from 'next/link'
import { Brand } from '@/components/auth-ui'
import { useT } from '@/lib/i18n/client'

// Раскладка входа взята из первой крес-ки: тонкая верхняя полоса,
// форма справа, градиентная панель слева. Панель не украшение —
// человек, пришедший по ссылке из инстаграма, за две секунды
// читает на ней, куда попал и зачем ему заводить аккаунт.
//
// Цвета и шкала — общие с остальным интерфейсом (globals.css),
// поэтому страница работает и в тёмной теме, и в светлой без
// отдельного набора переменных. Именно это в первой версии
// разъехалось: там у входа была своя палитра.
// В массиве лежат КЛЮЧИ, а не строки: список обещаний переводится
// целиком, и порядок пунктов — вёрстка, а не текст.
const PANEL_FEATURES = [
  'auth.panel.feature.storefront',
  'auth.panel.feature.stock',
  'auth.panel.feature.bookings',
  'auth.panel.feature.customers',
] as const

// title необязателен: экраны-результаты (успех, блокировка) рисуют
// собственный заголовок под знаком, и второй сверху был бы повтором.
export function AuthShell({ title, subtitle, children }: {
  title?: string; subtitle?: string; children: React.ReactNode
}) {
  const t = useT()
  return (
    // paddingBottom: --kb — запас под клавиатуру.
    //
    // Высота уже в `dvh` (`.auth-page` в globals.css), и в браузере этого
    // хватает: `dvh` при выезде клавиатуры уменьшается сам. В ОБЁРТКЕ не
    // хватает: там `Keyboard.resize: 'none'`, веб-вью не ужимается, и
    // `dvh` остаётся прежним — кнопка «Увійти» и поле пароля уезжают ПОД
    // клавиатуру, а прокрутить к ним нечего: страница ровно в экран.
    // Запас снизу возвращает ту прокрутку, которой не хватает. Без
    // клавиатуры `--kb` равен нулю, и правило не меняет ничего.
    // Меряет его `components/keyboard-fit.tsx` — тот же источник, что
    // у шторок кабинета и у `.m-scroll`.
    <div className="auth-page" style={{ paddingBottom: 'var(--kb, 0px)' }}>
      <div className="auth-topbar">
        {/* ── `web-only` НА ОБЕИХ ССЫЛКАХ ─────────────────────────────
            Это ХРОМ САЙТА: словесный знак, ведущий на продающую главную,
            и «На головну» рядом. В браузере он на месте — человек пришёл
            на сайт и должен уметь вернуться. В ОБЁРТКЕ его быть не может:
            приложение показывало бы рекламу самого себя, а нажатие
            уводило бы из приложения на витрину без пути назад. Тот же
            разбор и то же правило, что закрыли публичный хром 20.08.2026
            (globals.css, `html[data-native] .topbar`).

            Прячем содержимое полосы, а не саму полосу: её отступ сверху
            считается от `env(safe-area-inset-top)` и в обёртке остаётся
            единственным, что держит заголовок из-под выреза.

            Зона нажатия у знака — 44px (`--tap-min`): сам он высотой
            в строку, и без запаса это цель в 15 пикселей. Высоту знака
            это не меняет — только невидимый запас клика, тот же приём,
            что у `.btn-ghost` и `.iconbtn` в globals.css. */}
        <Link
          href="/"
          className="brand-topbar web-only inline-flex items-center"
          style={{ minHeight: 'var(--tap-min)' }}
        >
          <Brand />
        </Link>
        {/* Переключателя темы здесь НЕТ намеренно (решение владельца
            18.08.2026): тема выбирается в профиле, потому что это
            настройка аккаунта, а не действие входа. До входа аккаунта
            ещё нет, и предлагать его настройку — предлагать решение
            задачи, которой у человека сейчас не стоит. */}
        <Link href="/" className="btn-ghost web-only">← {t('auth.shell.home')}</Link>
      </div>

      <div className="auth-split">
        <section className="auth-form-col">
          <div className="auth-form">
            {title && <h1 className="display rise t-3xl">{title}</h1>}
            {subtitle && <p className="rise-1 t-md mt-2 prose-muted">{subtitle}</p>}
            <div className={title ? 'rise-2 mt-7' : 'rise-2'}>{children}</div>
          </div>
        </section>

        <aside className="auth-panel rise-1">
          <div className="auth-panel-title">
            <span aria-hidden>◈</span>
            CRESKO
          </div>
          <p className="auth-panel-tagline">{t('auth.panel.tagline')}</p>
          <div className="auth-panel-list">
            {PANEL_FEATURES.map((key) => (
              <div key={key} className="auth-panel-item">
                <span className="auth-panel-check" aria-hidden>✓</span>
                {t(key)}
              </div>
            ))}
          </div>
          <p className="auth-panel-foot">{t('auth.panel.foot')}</p>
        </aside>
      </div>
    </div>
  )
}
