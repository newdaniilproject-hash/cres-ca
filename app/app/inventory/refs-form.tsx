'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/lib/i18n/client'
import { useConfirm } from '@/components/confirm'
import { dbErrorText } from '@/lib/errors/db'
import { IconTrash } from '@/components/icons'
import type { RefItem } from './material-form'

// Справочники поставщиков и мест хранения. Заводятся отсюда, а не
// свободным текстом в карточке материала: иначе один поставщик появляется
// как «Розетка», «розетка» и «Розетка ТОВ» — та самая причина, по которой
// в 0009 поставщик стал таблицей.
export function RefsForm({
  tenantId, suppliers, locations, onDone, onCreated,
}: {
  tenantId: string
  suppliers: RefItem[]
  locations: RefItem[]
  onDone: () => void
  /**
   * Заведённая строка — тому, кто позвал форму из ДРУГОГО места
   * (карточка засоба: «+» рядом с селектом). Форма при этом одна:
   * вторая копия «добавить поставщика» разъехалась бы с этой на первой
   * же правке, а справочник — то самое место, где расхождение даёт
   * «Розетка», «розетка» и «Розетка ТОВ» тремя строками.
   *
   * Не задан — ничего не меняется: со склада форма открывается как
   * открывалась, `router.refresh()` подтягивает список сам.
   */
  onCreated?: (kind: 'supplier' | 'location', item: RefItem) => void
}) {
  const t = useT()
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const confirm = useConfirm()
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState('')

  const [sName, setSName] = useState('')
  const [sPhone, setSPhone] = useState('')
  const [sEmail, setSEmail] = useState('')
  const [lName, setLName] = useState('')

  async function addSupplier(e: React.FormEvent) {
    e.preventDefault()
    setBusy('supplier'); setErr('')
    // `select().single()` — не «на всякий случай»: заведённую строку
    // ждёт тот, кто позвал форму из карточки засоба, чтобы сразу
    // подставить её в селект. Без возврата id пришлось бы искать
    // поставщика по имени, а имена не уникальны в глазах человека.
    const { data, error } = await supabase.from('suppliers').insert({
      tenant_id: tenantId,
      name: sName.trim(),
      phone: sPhone.trim() || null,
      email: sEmail.trim() || null,
    }).select('id, name').single()
    setBusy(null)
    if (error) {
      // Экранная подпись для дубля; запасной путь — общий разбор (М25).
      setErr(error.code === '23505' ? t('inventory.refs.supplier.duplicate') : dbErrorText(t, error))
      return
    }
    setSName(''); setSPhone(''); setSEmail('')
    if (data) onCreated?.('supplier', { id: data.id, name: data.name })
    router.refresh()
  }

  async function addLocation(e: React.FormEvent) {
    e.preventDefault()
    setBusy('location'); setErr('')
    const { data, error } = await supabase.from('storage_locations').insert({
      tenant_id: tenantId,
      name: lName.trim(),
      // position оставляем по умолчанию: порядок полок никто не сортирует
      // руками, пока их меньше десятка.
    }).select('id, name').single()
    setBusy(null)
    if (error) {
      setErr(error.code === '23505' ? t('inventory.refs.location.duplicate') : dbErrorText(t, error))
      return
    }
    setLName('')
    if (data) onCreated?.('location', { id: data.id, name: data.name })
    router.refresh()
  }

  // Прибрати рядок довідника — через `remove_entity` (0134), а не
  // прямим `update is_active = false`, як було до 26.08.2026.
  //
  // Різниця не в акуратності, а в результаті для людини. Прямий UPDATE
  // ЗАВЖДИ лише ховав рядок: помилково заведений постачальник, на якого
  // ніколи нічого не посилалось, лишався в базі назавжди. Тепер база
  // сама дивиться, чи є за ним історія: немає — стирає, є — прибирає
  // з очей. Це те саме одне натискання, але чесне.
  //
  // Другий довід — той самий, що всюди в цьому проекті: правило
  // «прибрати можна лише те, за чим нічого не стоїть» тепер живе
  // в ОДНОМУ місці. Прямий UPDATE поруч із функцією був би другим
  // шляхом до тієї ж дії, і розійшлися б вони мовчки.
  async function deactivate(kind: 'supplier' | 'location', item: RefItem) {
    const ok = await confirm({
      title: t('inventory.refs.deactivate.title'),
      body: t('inventory.refs.deactivate.body', { name: item.name }),
      action: t('inventory.refs.deactivate.action'),
      tone: 'danger',
    })
    if (!ok) return
    setBusy(item.id); setErr('')
    const { error } = await supabase.rpc('remove_entity', {
      p_kind: kind, p_id: item.id,
    })
    setBusy(null)
    if (error) { setErr(dbErrorText(t, error)); return }
    router.refresh()
  }

  // Строка справочника: имя + кнопка удаления. Именно строками, а не
  // бейджами: у кнопки обязана быть зона нажатия 44px, в бейдж она не влезает.
  //
  // Значок — корзина, а не крестик. Крестик читается как «закрыть» или
  // «снять выбор»; здесь же строка исчезает из справочника, а иногда
  // и из базы (0134). Значок обязан обещать ровно то, что произойдёт.
  function refRow(kind: 'supplier' | 'location', item: RefItem) {
    return (
      <div key={item.id} className="row px-4">
        <span className="t-md min-w-0 flex-1 truncate">{item.name}</span>
        <button type="button" className="btn-icon shrink-0"
                aria-label={t('inventory.refs.deactivate.action')}
                disabled={busy === item.id}
                onClick={() => void deactivate(kind, item)}>
          <IconTrash size={18} />
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">

      {err && <p className="field-error">{err}</p>}

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-3">
          <p className="t-md">{t('inventory.refs.suppliers.title')}</p>
          {suppliers.length > 0 ? (
            <div className="card !p-0">
              {suppliers.map((s) => refRow('supplier', s))}
            </div>
          ) : (
            // Компактное пустое состояние: заголовок и подпись классами
            // шаблона, без иконки — в шторке она съедала бы пол-экрана.
            <div className="empty !py-4">
              <p className="empty-title">{t('inventory.refs.suppliers.emptyTitle')}</p>
              <p className="empty-desc">{t('inventory.refs.suppliers.emptyDesc')}</p>
            </div>
          )}
          <form onSubmit={addSupplier} className="grid gap-2">
            <input required className="input" placeholder={t('inventory.refs.supplier.name.placeholder')}
                   value={sName} onChange={(e) => setSName(e.target.value)} />
            <input className="input" placeholder={t('inventory.refs.supplier.phone.placeholder')} inputMode="tel"
                   value={sPhone} onChange={(e) => setSPhone(e.target.value)} />
            <input className="input" type="email" placeholder={t('inventory.refs.supplier.email.placeholder')}
                   value={sEmail} onChange={(e) => setSEmail(e.target.value)} />
            <button className="btn-secondary" disabled={!sName.trim() || busy === 'supplier'}>
              {t('inventory.refs.supplier.submit')}
            </button>
          </form>
        </div>

        <div className="flex flex-col gap-3">
          <p className="t-md">{t('inventory.refs.locations.title')}</p>
          {locations.length > 0 ? (
            <div className="card !p-0">
              {locations.map((l) => refRow('location', l))}
            </div>
          ) : (
            <div className="empty !py-4">
              <p className="empty-title">{t('inventory.refs.locations.emptyTitle')}</p>
              <p className="empty-desc">{t('inventory.refs.locations.emptyDesc')}</p>
            </div>
          )}
          <form onSubmit={addLocation} className="grid gap-2">
            <input required className="input" placeholder={t('inventory.refs.location.name.placeholder')}
                   value={lName} onChange={(e) => setLName(e.target.value)} />
            <button className="btn-secondary" disabled={!lName.trim() || busy === 'location'}>
              {t('inventory.refs.location.submit')}
            </button>
          </form>
          <p className="field-hint">{t('inventory.refs.location.hint')}</p>
        </div>
      </div>

      {confirm.element}
    </div>
  )
}
