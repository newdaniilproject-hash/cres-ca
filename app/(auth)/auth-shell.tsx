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
    <div className="auth-page">
      <div className="auth-topbar">
        <Link href="/" className="brand-topbar">
          <Brand />
        </Link>
        {/* Переключателя темы здесь НЕТ намеренно (решение владельца
            18.08.2026): тема выбирается в профиле, потому что это
            настройка аккаунта, а не действие входа. До входа аккаунта
            ещё нет, и предлагать его настройку — предлагать решение
            задачи, которой у человека сейчас не стоит. */}
        <Link href="/" className="btn-ghost">← {t('auth.shell.home')}</Link>
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
