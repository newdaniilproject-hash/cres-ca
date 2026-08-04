import Link from 'next/link'

export function AuthShell({ title, subtitle, children }: {
  title: string; subtitle?: string; children: React.ReactNode
}) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-5 py-12">
      <Link href="/" className="display rise mb-10 t-xl">
        Маркет<span style={{ color: 'var(--color-gold)' }}>.</span>
      </Link>
      <h1 className="display rise-1 t-2xl">{title}</h1>
      {subtitle && <p className="rise-1 t-sm mt-1.5 prose-muted">{subtitle}</p>}
      <div className="rise-2 mt-8">{children}</div>
    </main>
  )
}
