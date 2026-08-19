import { createClient } from '@/lib/supabase/server'
import { can, currentUserId, type Membership } from '@/lib/tenant'
import type { TechCardsData } from './techcards-client'

// ── Данные экрана техкарт: ОДИН загрузчик на два входа ─────────────────────
//
// Входов у техкарт с 19.08.2026 два: свой адрес `/app/techcards` (там же
// живёт десктопный вид — карточка §6 и визард §7) и вкладка «Техкарти»
// на экране «Послуги», как в макете CRESKO. Второй запрос, написанный
// «по образцу» первого, — это второй источник правды: расходятся такие
// пары всегда и молча (CLAUDE.md → «Один источник правды»). Поэтому
// выборка живёт здесь, а обе страницы её ЗОВУТ.
//
// Права проверяет ВЫЗЫВАЮЩИЙ, а не этот файл: отказ по праву — `redirect`
// на своём экране, отказ по модулю — `<ModuleOff>`, а на вкладке каталога
// её просто нет вовсе. Загрузчик, который сам решает, что показать,
// стал бы третьим местом, где описан доступ.
export async function loadTechCards(m: Membership): Promise<TechCardsData> {
  const supabase = await createClient()
  const userId = await currentUserId()

  // Привязывать карту к услуге можно только с `catalog.read`: список для
  // выпадающего списка читается из самой `offerings`. У инспектора этого
  // права нет (0035) — и запрос ему не уходит вовсе, чтобы не изображать
  // «список услуг пуст» там, где на деле «вам его не показывают».
  const canLink = can(m, 'catalog.read')

  // Карт мало по природе (регламент салона — это единицы документов),
  // поэтому забираем сразу все версии и группируем на клиенте:
  // без этого нельзя показать историю, а история здесь и есть смысл таблицы.
  const [{ data: cards, error: cardsError }, { data: titles }, services] =
    await Promise.all([
      supabase.from('tech_cards')
        .select('id, title, version, steps, is_active, offering_id, created_at')
        .eq('tenant_id', m.tenantId)
        .order('title')
        .order('version', { ascending: false })
        .limit(300),
      // Название услуги — ОТДЕЛЬНЫМ запросом к компланс-проекции, а не
      // вложенной связью `offerings(title)`. Связь к таблице, закрытой
      // чужим правом, возвращает `null`, а не отказ: у инспектора техкарта
      // приезжала без названия услуги, к которой относится, — документ
      // из ТЗ 3.4 без половины смысла и без единой ошибки на экране.
      // `compliance_offerings` (0083) отдаёт три колонки по `compliance.read`
      // и ничего из коммерции.
      supabase.from('compliance_offerings')
        .select('id, title')
        .eq('tenant_id', m.tenantId)
        .limit(500),
      canLink
        ? supabase.from('offerings')
            .select('id, title')
            .eq('tenant_id', m.tenantId)
            .eq('kind', 'service')
            .order('title')
            .limit(200)
        : null,
    ])

  const titleOf = new Map((titles ?? []).map((o) => [o.id, o.title]))

  return {
    tenantId: m.tenantId,
    userId: userId ?? '',
    // Выпуск версии — `compliance.write` (`tech_cards_write`, 0014).
    // Мастер с одним `compliance.journal.write` (0039) сюда не входит:
    // регламент утверждает заведение, а не смена. Инспектор — тем более.
    canWrite: can(m, 'compliance.write'),
    loadError: cardsError?.message ?? '',
    cards: (cards ?? []).map((c) => ({
      id: c.id,
      title: c.title,
      version: c.version,
      steps: c.steps,
      isActive: c.is_active,
      offeringId: c.offering_id,
      offeringTitle: c.offering_id ? titleOf.get(c.offering_id) ?? null : null,
      createdAt: c.created_at,
    })),
    services: (services?.data ?? []).map((s) => ({ id: s.id, title: s.title })),
  }
}
