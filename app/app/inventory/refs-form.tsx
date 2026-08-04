'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { RefItem } from './material-form'

// Справочники поставщиков и мест хранения. Заводятся отсюда, а не
// свободным текстом в карточке материала: иначе один поставщик появляется
// как «Розетка», «розетка» и «Розетка ТОВ» — та самая причина, по которой
// в 0009 поставщик стал таблицей.
export function RefsForm({
  tenantId, suppliers, locations, onDone,
}: {
  tenantId: string
  suppliers: RefItem[]
  locations: RefItem[]
  onDone: () => void
}) {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState('')

  const [sName, setSName] = useState('')
  const [sPhone, setSPhone] = useState('')
  const [sEmail, setSEmail] = useState('')
  const [lName, setLName] = useState('')

  async function addSupplier(e: React.FormEvent) {
    e.preventDefault()
    setBusy('supplier'); setErr('')
    const { error } = await supabase.from('suppliers').insert({
      tenant_id: tenantId,
      name: sName.trim(),
      phone: sPhone.trim() || null,
      email: sEmail.trim() || null,
    })
    setBusy(null)
    if (error) {
      setErr(error.code === '23505' ? 'Такий постачальник вже є' : error.message)
      return
    }
    setSName(''); setSPhone(''); setSEmail('')
    router.refresh()
  }

  async function addLocation(e: React.FormEvent) {
    e.preventDefault()
    setBusy('location'); setErr('')
    const { error } = await supabase.from('storage_locations').insert({
      tenant_id: tenantId,
      name: lName.trim(),
      // position оставляем по умолчанию: порядок полок никто не сортирует
      // руками, пока их меньше десятка.
    })
    setBusy(null)
    if (error) {
      setErr(error.code === '23505' ? 'Таке місце зберігання вже є' : error.message)
      return
    }
    setLName('')
    router.refresh()
  }

  return (
    <div className="card rise flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <p className="display t-lg">Довідники</p>
        <button type="button" className="btn-ghost ml-auto" onClick={onDone}>Закрити</button>
      </div>

      {err && <p className="field-error">{err}</p>}

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-3">
          <p className="t-md">Постачальники</p>
          {suppliers.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {suppliers.map((s) => <span key={s.id} className="badge">{s.name}</span>)}
            </div>
          ) : (
            <p className="t-xs prose-muted">Поки жодного</p>
          )}
          <form onSubmit={addSupplier} className="grid gap-2">
            <input required className="input" placeholder="Назва постачальника"
                   value={sName} onChange={(e) => setSName(e.target.value)} />
            <input className="input" placeholder="Телефон" inputMode="tel"
                   value={sPhone} onChange={(e) => setSPhone(e.target.value)} />
            <input className="input" type="email" placeholder="Пошта"
                   value={sEmail} onChange={(e) => setSEmail(e.target.value)} />
            <button className="btn-secondary" disabled={!sName.trim() || busy === 'supplier'}>
              Додати постачальника
            </button>
          </form>
        </div>

        <div className="flex flex-col gap-3">
          <p className="t-md">Місця зберігання</p>
          {locations.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {locations.map((l) => <span key={l.id} className="badge">{l.name}</span>)}
            </div>
          ) : (
            <p className="t-xs prose-muted">Поки жодного</p>
          )}
          <form onSubmit={addLocation} className="grid gap-2">
            <input required className="input" placeholder="Шафа біля дзеркала"
                   value={lName} onChange={(e) => setLName(e.target.value)} />
            <button className="btn-secondary" disabled={!lName.trim() || busy === 'location'}>
              Додати місце
            </button>
          </form>
          <p className="field-hint">
            Місце — це підказка «де лежить», а не окремий склад:
            залишок у засобу один на всі полиці.
          </p>
        </div>
      </div>
    </div>
  )
}
