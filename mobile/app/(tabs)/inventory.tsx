// Склад — приоритет номер один продукта.
//
// Порядок сборки — по «Одиннадцати проверкам» из CLAUDE.md:
//   1. Сначала вопрос: с чем мастер открывает склад. Ответ — стоимость
//      запаса и что горит; он стоит выше всего и читается без нажатий.
//   2. Каждое число на экране имеет выход: три счётчика героя — это
//      фильтры списка, а не украшение. Плитка, которая никуда не ведёт,
//      читается как сломанная кнопка.
//   3. Пустое состояние ОДНО и с объяснением; «ничего не найдено
//      в фильтре» и «склад пуст» — разные тексты, и путать их нельзя.
//   4. Отсутствие вещи не весит столько же, сколько вещь: нулевой
//      остаток приглушается, а не прячется.
//
// Обе оси доступа — в `<ModuleScreen>`: право берётся из реестра
// модулей, а не пишется здесь второй раз.

import { useMemo, useState } from 'react'
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { expiryState } from '../../../lib/expiry'
import {
  fetchInventoryOverview, isLowStock, type MaterialRow,
} from '../../../shared/inventory'
import { ModuleScreen } from '../../components/module-screen'
import { Card, Centered, Empty, LoadError, ScreenTitle, Spinner } from '../../components/ui'
import { t } from '../../lib/i18n'
import { supabase } from '../../lib/supabase'
import { PRESS_DIM, RADIUS, TAP_MIN, TEXT, usePalette } from '../../lib/theme'
import { useLoader } from '../../lib/use-loader'

type Filter = 'all' | 'low' | 'expired'

export default function InventoryTab() {
  return (
    <ModuleScreen route="inventory">
      {(tenantId) => <InventoryList tenantId={tenantId} />}
    </ModuleScreen>
  )
}

function InventoryList({ tenantId }: { tenantId: string }) {
  const { c } = usePalette()
  const insets = useSafeAreaInsets()
  const [filter, setFilter] = useState<Filter>('all')
  const { data, loading, error, refreshing, reload, refresh } = useLoader(
    () => fetchInventoryOverview(supabase, tenantId), [tenantId],
  )

  const stats = useMemo(() => {
    const materials = data?.materials ?? []
    const containers = data?.containers ?? []
    return {
      total: materials.length,
      low: materials.filter(isLowStock).length,
      expired: containers.filter((x) => expiryState(x.use_by) === 'expired').length,
    }
  }, [data])

  const rows = useMemo(() => {
    const materials = data?.materials ?? []
    if (filter === 'low') return materials.filter(isLowStock)
    if (filter === 'expired') {
      // Просрочены БАНКИ, а не расходники: срок живёт на ёмкости
      // (его считает триггер из партии и PAO). Поэтому фильтр показывает
      // засоби, у которых есть хоть одна просроченная банка.
      const bad = new Set(
        (data?.containers ?? [])
          .filter((x) => expiryState(x.use_by) === 'expired')
          .map((x) => x.material_id),
      )
      return materials.filter((m) => bad.has(m.id))
    }
    return materials
  }, [data, filter])

  if (loading) return <Centered><Spinner /></Centered>

  return (
    <FlatList
      style={{ backgroundColor: c.bg }}
      contentContainerStyle={{
        padding: 16, paddingTop: insets.top + 12, paddingBottom: 24, gap: 8,
      }}
      data={rows}
      keyExtractor={(m) => m.id}
      refreshControl={
        <RefreshControl refreshing={refreshing} tintColor={c.muted} onRefresh={refresh} />
      }
      ListHeaderComponent={
        <View style={{ gap: 12, marginBottom: 4 }}>
          <ScreenTitle>{t('app.screen.inventory.title')}</ScreenTitle>
          {error ? <LoadError onRetry={reload} /> : (
            <Hero
              value={data?.value?.total_value ?? null}
              stats={stats}
              filter={filter}
              onFilter={setFilter}
            />
          )}
        </View>
      }
      ListEmptyComponent={
        error ? null : filter === 'all'
          ? <Empty title={t('inventory.empty.title')} desc={t('inventory.empty.desc')} />
          : <Empty title={t('inventory.empty.filtered')} />
      }
      renderItem={({ item }) => <MaterialCard m={item} />}
    />
  )
}

function Hero({
  value, stats, filter, onFilter,
}: {
  value: number | null
  stats: { total: number; low: number; expired: number }
  filter: Filter
  onFilter: (f: Filter) => void
}) {
  const { c } = usePalette()
  return (
    <Card style={{ borderRadius: RADIUS.hero, padding: 16, gap: 14 }}>
      <View style={{ gap: 2 }}>
        <Text style={{ color: c.muted, ...TEXT.base }}>{t('inventory.hero.value')}</Text>
        <Text style={{ color: c.text, ...TEXT['4xl'] }}>
          {value === null ? t('inventory.hero.noCost') : t.money(value)}
        </Text>
      </View>

      {/* Счётчики — это ФИЛЬТРЫ. Число без выхода читается как кнопка,
          которая не работает; поэтому каждое здесь переключает список. */}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Counter label={t('inventory.hero.positions')} n={stats.total}
          active={filter === 'all'} onPress={() => onFilter('all')} />
        <Counter label={t('inventory.stats.low')} n={stats.low} tone={c.warn}
          active={filter === 'low'} onPress={() => onFilter('low')} />
        <Counter label={t('inventory.expiry.expired')} n={stats.expired} tone={c.danger}
          active={filter === 'expired'} onPress={() => onFilter('expired')} />
      </View>
    </Card>
  )
}

function Counter({
  label, n, tone, active, onPress,
}: {
  label: string
  n: number
  tone?: string
  active: boolean
  onPress: () => void
}) {
  const { c } = usePalette()
  return (
    <Pressable
      onPress={onPress}
      // Нажатый и ВЫБРАННЫЙ — разные состояния, и путать их нельзя:
      // выбранный держит фон постоянно, нажатый гаснет на мгновение.
      // Без второго счётчик-фильтр отзывается только сменой списка,
      // то есть после запроса — а это уже не отклик, а результат.
      style={({ pressed }) => ({
        flex: 1,
        minHeight: TAP_MIN,
        borderRadius: RADIUS.plate,
        paddingVertical: 8,
        paddingHorizontal: 10,
        backgroundColor: active ? c.surface2 : 'transparent',
        borderWidth: 1,
        borderColor: active ? c.borderStrong : c.border,
        opacity: pressed ? PRESS_DIM : 1,
      })}
    >
      <Text style={{ color: tone && n > 0 ? tone : c.text, ...TEXT['2xl'] }}>{n}</Text>
      <Text style={{ color: c.muted, ...TEXT.xs }} numberOfLines={2}>{label}</Text>
    </Pressable>
  )
}

function MaterialCard({ m }: { m: MaterialRow }) {
  const { c } = usePalette()
  const low = isLowStock(m)
  const stock = m.current_stock ?? 0
  return (
    <Card style={{
      minHeight: TAP_MIN,
      // Нулевой остаток ПРИГЛУШЁН, а не спрятан: спрятанное читается
      // как «этого засоба у меня нет», а он есть — просто кончился.
      opacity: stock === 0 ? 0.55 : 1,
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: c.text, ...TEXT.lg }} numberOfLines={1}>{m.name}</Text>
          {/* Величины разделяются СТРОКАМИ, а не точками: на 390px
              подпись переносится, и точка встаёт в начало второй строки,
              читаясь как маркер списка (решение владельца 25.08.2026). */}
          {m.brand ? (
            <Text style={{ color: c.muted, ...TEXT.base }} numberOfLines={1}>{m.brand}</Text>
          ) : null}
        </View>

        <View style={{ alignItems: 'flex-end', gap: 2 }}>
          <Text style={{ color: low ? c.warn : c.text, ...TEXT.xl }}>{t.number(stock)}</Text>
          <Text style={{ color: c.faint, ...TEXT.xs }}>{m.unit}</Text>
        </View>
      </View>

      {low ? (
        <Text style={{ color: c.warn, ...TEXT.sm, marginTop: 8 }}>
          {t('inventory.stats.low')}
        </Text>
      ) : null}
    </Card>
  )
}
