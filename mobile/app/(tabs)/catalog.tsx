// Каталог: товары и услуги одним списком.
//
// Одна модель на оба вида (правило 4) — здесь это видно буквально:
// список один, `kind` только меняет подпись. Заводить две вкладки
// «Товари» и «Послуги» нельзя: у салона это одна и та же работа,
// а различие живёт в карточке позиции.
//
// ⚠️ В ПРИЛОЖЕНИИ ЭТО ПОКА ТОЛЬКО ПРОСМОТР, и экран говорит об этом
// прямо. Создание позиции требует категории со схемой характеристик,
// вариантов, цен и медиа — это форма на пять экранов, и делать её
// «наполовину» хуже, чем честно отправить в кабинет. Молчаливое
// отсутствие кнопки человек читает как поломку.

import { FlatList, RefreshControl, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { fetchOfferings, type OfferingRow } from '../../../shared/catalog'
import { ModuleScreen } from '../../components/module-screen'
import { Card, Centered, Empty, LoadError, ScreenTitle, Spinner } from '../../components/ui'
import { t } from '../../lib/i18n'
import { supabase } from '../../lib/supabase'
import { RADIUS, TAP_MIN, TEXT, usePalette } from '../../lib/theme'
import { useLoader } from '../../lib/use-loader'

export default function CatalogTab() {
  return (
    <ModuleScreen route="catalog">
      {(tenantId) => <CatalogList tenantId={tenantId} />}
    </ModuleScreen>
  )
}

function CatalogList({ tenantId }: { tenantId: string }) {
  const { c } = usePalette()
  const insets = useSafeAreaInsets()
  const { data, loading, error, refreshing, reload, refresh } = useLoader(
    () => fetchOfferings(supabase, tenantId), [tenantId],
  )

  if (loading) return <Centered><Spinner /></Centered>

  return (
    <FlatList
      style={{ backgroundColor: c.bg }}
      contentContainerStyle={{
        padding: 16, paddingTop: insets.top + 12, paddingBottom: 24, gap: 8,
      }}
      data={data ?? []}
      keyExtractor={(o) => o.id}
      refreshControl={
        <RefreshControl refreshing={refreshing} tintColor={c.muted} onRefresh={refresh} />
      }
      ListHeaderComponent={
        <View style={{ gap: 12, marginBottom: 4 }}>
          <ScreenTitle>{t('app.screen.catalog.title')}</ScreenTitle>
          <Text style={{ color: c.faint, ...TEXT.base }}>{t('mobile.readOnly')}</Text>
          {error ? <LoadError onRetry={reload} /> : null}
        </View>
      }
      ListEmptyComponent={
        error ? null : (
          <Empty title={t('mobile.catalog.empty')} desc={t('mobile.catalog.emptyDesc')} />
        )
      }
      renderItem={({ item }) => <OfferingCard o={item} />}
    />
  )
}

function OfferingCard({ o }: { o: OfferingRow }) {
  const { c } = usePalette()
  // Черновик приглушается и подписывается, а не прячется: позиция
  // существует, просто покупатель её не видит. Спрятанная строка
  // читается как «я её не заводил».
  const draft = o.status !== 'active'
  return (
    <Card style={{ minHeight: TAP_MIN, opacity: draft ? 0.6 : 1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: c.text, ...TEXT.lg }} numberOfLines={1}>{o.title}</Text>
          {o.subtitle ? (
            <Text style={{ color: c.muted, ...TEXT.base }} numberOfLines={1}>{o.subtitle}</Text>
          ) : null}
          {draft ? (
            <Text style={{ color: c.warn, ...TEXT.sm }}>{t('mobile.catalog.draft')}</Text>
          ) : null}
        </View>

        {o.price === null ? null : (
          <Text style={{ color: c.text, ...TEXT.xl }}>{t.money(o.price)}</Text>
        )}
      </View>
    </Card>
  )
}
