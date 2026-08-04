// Общий каркас и реквизиты для юридических страниц.
//
// Вынесено отдельно по одной причине: реквизиты владельца встречаются
// в политике, в порядке удаления данных и потом в оферте. Разъедутся —
// и документы начнут противоречить друг другу, что для юридического
// текста хуже, чем отсутствие текста.

// ⚠️ ЗАГЛУШКА. Юридическое лицо ещё не зарегистрировано — это блокер
// номер один по проекту. До регистрации политику публиковать МОЖНО
// (Meta и магазины требуют доступный URL), но перед приёмом первого
// платежа и перед подачей в App Store реквизиты обязаны стать
// настоящими: политику выдаёт конкретное лицо, иначе документ
// юридически пустой.
export const OWNER = {
  name: 'Падалко Даниїл Віталійович',
  code: '—',                       // ← РНОКПП / ЄДРПОУ після реєстрації
  address: 'Україна, м. Харків',   // ← адреса для листування
  email: 'privacy@cres-ca.com',    // ← має приймати вхідну пошту
}

export const POLICY_VERSION = '1.0'
export const POLICY_DATE = '4 серпня 2026 року'

export function Legal({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-3xl px-4 pt-12 pb-8 sm:px-6 sm:pt-16">
      <h1 className="display rise t-4xl">{title}</h1>
      <article className="rise-1 mt-8">{children}</article>
    </main>
  )
}

export function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="display mt-10 mb-3 t-xl">{children}</h2>
}

export function P({ children }: { children: React.ReactNode }) {
  return <p className="t-md mb-4 leading-relaxed prose-muted">{children}</p>
}

export function Ul({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="mb-4 flex flex-col gap-2">
      {items.map((item, i) => (
        <li key={i} className="t-md flex gap-3 leading-relaxed prose-muted">
          <span aria-hidden style={{ color: 'var(--color-accent)' }}>—</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}
