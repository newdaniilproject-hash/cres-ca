import Link from 'next/link'
import { ThemeToggle } from '@/components/theme'
import { Brand } from '@/components/auth-ui'

// Раскладка входа взята из первой крес-ки: тонкая верхняя полоса,
// форма справа, градиентная панель слева. Панель не украшение —
// человек, пришедший по ссылке из инстаграма, за две секунды
// читает на ней, куда попал и зачем ему заводить аккаунт.
//
// Цвета и шкала — общие с остальным интерфейсом (globals.css),
// поэтому страница работает и в тёмной теме, и в светлой без
// отдельного набора переменных. Именно это в первой версии
// разъехалось: там у входа была своя палитра.
const PANEL_FEATURES = [
  'Вітрина, що відчувається власним сайтом',
  'Склад із термінами придатності й журналами',
  'Запис і замовлення в одному кабінеті',
  'База клієнтів — ваша, з вивантаженням',
]

// title необязателен: экраны-результаты (успех, блокировка) рисуют
// собственный заголовок под знаком, и второй сверху был бы повтором.
export function AuthShell({ title, subtitle, children }: {
  title?: string; subtitle?: string; children: React.ReactNode
}) {
  return (
    <div className="auth-page">
      <div className="auth-topbar">
        <Link href="/" className="brand-topbar">
          <Brand />
        </Link>
        <div className="flex items-center gap-1 sm:gap-2">
          <ThemeToggle />
          <Link href="/" className="btn-ghost">← На головну</Link>
        </div>
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
          <p className="auth-panel-tagline">
            Одна підписка замість чотирьох сервісів. Без комісії за замовлення,
            які ви привели самі.
          </p>
          <div className="auth-panel-list">
            {PANEL_FEATURES.map((f) => (
              <div key={f} className="auth-panel-item">
                <span className="auth-panel-check" aria-hidden>✓</span>
                {f}
              </div>
            ))}
          </div>
          <p className="auth-panel-foot">Склад для майстрів — облік, терміни, журнали</p>
        </aside>
      </div>
    </div>
  )
}
