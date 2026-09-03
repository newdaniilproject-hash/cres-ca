// Санитарные журналы. Три журнала Техрегламента №65 на одном экране.
//
// Вопрос, с которым мастер сюда заходит, — «что сегодня ещё не сделано»,
// и ответ стоит выше всего: сколько задач уборки закрыто из скольких.
// Дезрастворы и стерилизация — это история, и она ниже, под липкими
// подзаголовками.
//
// ⚠️ ТОЛЬКО ПРОСМОТР, и это не лень, а следствие устройства журналов.
// У них нет политик UPDATE и DELETE, и запись идёт функциями базы
// с ключом идемпотентности (0128) — чтобы досылка из офлайна не завела
// вторую отметку об одной уборке. Кнопка «відмітити», написанная без
// этого ключа, при первом же разрыве связи задвоила бы запись
// в НЕИЗМЕНЯЕМОМ журнале, а исправить его нельзя по определению.
// Пока очередь офлайна не перенесена в приложение — просмотр.

import { RefreshControl, SectionList, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { fetchJournals, type SolutionRow, type SterilizationRow } from '../../../shared/journals'
import { ModuleScreen } from '../../components/module-screen'
import { Card, Centered, Empty, LoadError, ScreenTitle, Spinner } from '../../components/ui'
import { t } from '../../lib/i18n'
import { supabase } from '../../lib/supabase'
import { RADIUS, TAP_MIN, TEXT, usePalette } from '../../lib/theme'
import { useLoader } from '../../lib/use-loader'

export default function JournalsTab() {
  return (
    <ModuleScreen route="journals">
      {(tenantId) => <Journals tenantId={tenantId} />}
    </ModuleScreen>
  )
}

type Row =
  | { kind: 'solution'; row: SolutionRow }
  | { kind: 'cycle'; row: SterilizationRow }

function Journals({ tenantId }: { tenantId: string }) {
  const { c } = usePalette()
  const insets = useSafeAreaInsets()
  const { data, loading, error, refreshing, reload, refresh } = useLoader(
    () => fetchJournals(supabase, tenantId), [tenantId],
  )

  if (loading) return <Centered><Spinner /></Centered>

  const done = new Set((data?.doneToday ?? []).map((e) => e.task_id))
  const tasks = data?.tasks ?? []

  const sections = [
    {
      title: t('mobile.journals.solutions'),
      data: (data?.solutions ?? []).map((row): Row => ({ kind: 'solution', row })),
    },
    {
      title: t('mobile.journals.cycles'),
      data: (data?.cycles ?? []).map((row): Row => ({ kind: 'cycle', row })),
    },
  ].filter((s) => s.data.length > 0)

  return (
    <SectionList
      style={{ backgroundColor: c.bg }}
      contentContainerStyle={{
        padding: 16, paddingTop: insets.top + 12, paddingBottom: 24, gap: 8,
      }}
      sections={sections}
      keyExtractor={(item) => `${item.kind}:${item.row.id}`}
      stickySectionHeadersEnabled
      refreshControl={
        <RefreshControl refreshing={refreshing} tintColor={c.muted} onRefresh={refresh} />
      }
      ListHeaderComponent={
        <View style={{ gap: 12, marginBottom: 4 }}>
          <ScreenTitle>{t('app.screen.journals.title')}</ScreenTitle>
          <Text style={{ color: c.faint, ...TEXT.base }}>{t('mobile.readOnly')}</Text>
          {error ? <LoadError onRetry={reload} /> : (
            <CleaningToday tasks={tasks} done={done} />
          )}
        </View>
      }
      ListEmptyComponent={
        error || tasks.length > 0 ? null : (
          <Empty title={t('mobile.journals.empty')} desc={t('mobile.journals.emptyDesc')} />
        )
      }
      renderSectionHeader={({ section }) => (
        // Липкий подзаголовок обязан быть НЕПРОЗРАЧНЫМ: под ним едут
        // карточки, и на полупрозрачном фоне они читаются сквозь текст.
        <View style={{ backgroundColor: c.bg, paddingTop: 12, paddingBottom: 6 }}>
          <Text style={{ color: c.muted, ...TEXT.md }}>{section.title}</Text>
        </View>
      )}
      renderItem={({ item }) =>
        item.kind === 'solution'
          ? <SolutionCard s={item.row} />
          : <CycleCard s={item.row} />
      }
    />
  )
}

/** Ответ на вопрос экрана: сколько уборки закрыто сегодня. */
function CleaningToday({ tasks, done }: { tasks: { id: string; name: string }[]; done: Set<string> }) {
  const { c } = usePalette()
  if (tasks.length === 0) return null
  const n = tasks.filter((x) => done.has(x.id)).length
  const all = n === tasks.length

  return (
    <Card style={{ borderRadius: RADIUS.hero, padding: 16, gap: 12 }}>
      <View style={{ gap: 2 }}>
        <Text style={{ color: c.muted, ...TEXT.base }}>{t('mobile.journals.cleaning')}</Text>
        <Text style={{ color: all ? c.success : c.text, ...TEXT['4xl'] }}>
          {t('mobile.journals.doneOf', { done: n, total: tasks.length })}
        </Text>
      </View>

      <View style={{ gap: 8 }}>
        {tasks.map((task) => {
          const ok = done.has(task.id)
          return (
            <View key={task.id}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 28 }}>
              {/* Состояние несёт НЕ ТОЛЬКО цвет: точка меняет и заливку,
                  и цвет подписи. Цветом одним пользоваться нельзя —
                  восьмой процент мужчин его не различает. */}
              <View style={{
                width: 10, height: 10, borderRadius: 5,
                backgroundColor: ok ? c.success : 'transparent',
                borderWidth: ok ? 0 : 1.5, borderColor: c.borderStrong,
              }} />
              <Text style={{ color: ok ? c.text : c.muted, ...TEXT.md, flex: 1 }}
                    numberOfLines={1}>
                {task.name}
              </Text>
            </View>
          )
        })}
      </View>
    </Card>
  )
}

function SolutionCard({ s }: { s: SolutionRow }) {
  const { c } = usePalette()
  // Просроченный раствор — это не «старая запись», а то, чем нельзя
  // работать прямо сейчас. Поэтому метка, а не приглушение.
  const expired = s.expires_at ? new Date(s.expires_at) < new Date() : false
  return (
    <Card style={{ minHeight: TAP_MIN }}>
      <Text style={{ color: c.text, ...TEXT.lg }} numberOfLines={1}>{s.agent_name}</Text>
      {s.concentration ? (
        <Text style={{ color: c.muted, ...TEXT.base }}>{s.concentration}</Text>
      ) : null}
      <Text style={{ color: expired ? c.danger : c.faint, ...TEXT.sm, marginTop: 4 }}>
        {expired
          ? t('inventory.expiry.expired')
          : t.dateTime(s.prepared_at)}
      </Text>
    </Card>
  )
}

function CycleCard({ s }: { s: SterilizationRow }) {
  const { c } = usePalette()
  const bad = s.indicator_ok === false
  return (
    <Card style={{ minHeight: TAP_MIN }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: c.text, ...TEXT.lg }} numberOfLines={1}>
            {s.device ?? t('common.noValue')}
          </Text>
          <Text style={{ color: c.faint, ...TEXT.sm }}>{t.dateTime(s.performed_at)}</Text>
        </View>
        {s.temperature_c === null ? null : (
          <Text style={{ color: bad ? c.danger : c.text, ...TEXT.xl }}>
            {t.number(s.temperature_c)}°
          </Text>
        )}
      </View>
    </Card>
  )
}
