// Склад — первый экран приложения и приоритет номер один продукта.
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
// Обе оси доступа проверяются ЗДЕСЬ, на самой странице, а не в навигации:
// право `stock.read` и модуль `inventory`. Отказы разные и по тексту,
// и по смыслу — «вам сюда нельзя» против «заведение это не подключало».

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View,
} from 'react-native'
import { Redirect } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { expiryState } from '../../lib/expiry'
import { can, hasModule, type Membership } from '../../shared/access'
import {
  fetchInventoryOverview, isLowStock,
  type InventoryOverview, type MaterialRow,
} from '../../shared/inventory'
import { t } from '../lib/i18n'
import { useSession } from '../lib/session'
import { supabase } from '../lib/supabase'
import { INPUT_SIZE, PRESS_DIM, RADIUS, TAP_MIN, TEXT, usePalette } from '../lib/theme'

type Filter = 'all' | 'low' | 'expired'

export default function InventoryScreen() {
  const { loading, session, membership } = useSession()

  if (loading) return <Centered><Spinner /></Centered>
  if (!session) return <Redirect href="/" />
  if (!can(membership, 'stock.read')) {
    return <Gate title={t('mobile.gate.right.title')} desc={t('mobile.gate.right.desc')} m={membership} />
  }
  if (!hasModule(membership, 'inventory')) {
    return <Gate title={t('mobile.gate.module.title')} desc={t('mobile.gate.module.desc')} m={membership} />
  }

  return <InventoryList tenantId={membership!.tenantId} />
}

function InventoryList({ tenantId }: { tenantId: string }) {
  const { c } = usePalette()
  const insets = useSafeAreaInsets()
  const [data, setData] = useState<InventoryOverview | null>(null)
  const [error, setError] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')

  const load = useCallback(async () => {
    try {
      setError(false)
      setData(await fetchInventoryOverview(supabase, tenantId))
    } catch {
      // Текст ошибки базы человеку не показываем: Postgres при нарушении
      // уникальности печатает ЗНАЧЕНИЕ поля, то есть на экран уезжает
      // телефон клиента (CLAUDE.md, М25). Здесь чтение, но правило одно
      // на весь продукт — общая подпись, подробности в консоль.
      setError(true)
    }
  }, [tenantId])

  useEffect(() => { void load() }, [load])

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
      // (её считает триггер из партии и PAO). Поэтому фильтр показывает
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

  if (!data && !error) return <Centered><Spinner /></Centered>

  return (
    <FlatList
      style={{ backgroundColor: c.bg }}
      contentContainerStyle={{
        padding: 16,
        paddingTop: insets.top + 12,
        paddingBottom: insets.bottom + 24,
        gap: 8,
      }}
      data={rows}
      keyExtractor={(m) => m.id}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={c.muted}
          onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false) }}
        />
      }
      ListHeaderComponent={
        <View style={{ gap: 12, marginBottom: 4 }}>
          <Text style={{ color: c.text, ...TEXT['3xl'] }}>
            {t('app.screen.inventory.title')}
          </Text>

          {error ? (
            <Pressable
              onPress={load}
              style={({ pressed }) => ({
                minHeight: TAP_MIN, justifyContent: 'center', paddingHorizontal: 14,
                borderRadius: RADIUS.card,
                backgroundColor: pressed ? c.surface2 : c.surface,
                borderWidth: 1, borderColor: c.danger,
              })}
            >
              <Text style={{ color: c.danger, ...TEXT.md }}>{t('mobile.loadError')}</Text>
              <Text style={{ color: c.muted, ...TEXT.base }}>{t('mobile.retry')}</Text>
            </Pressable>
          ) : (
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
        error ? null : (
          <View style={{ paddingVertical: 32, gap: 6 }}>
            <Text style={{ color: c.text, ...TEXT.xl }}>
              {filter === 'all' ? t('inventory.empty.title') : t('inventory.empty.filtered')}
            </Text>
            {filter === 'all' ? (
              <Text style={{ color: c.muted, ...TEXT.md }}>{t('inventory.empty.desc')}</Text>
            ) : null}
          </View>
        )
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
    <View
      style={{
        backgroundColor: c.surface,
        borderRadius: RADIUS.hero,
        borderWidth: 1,
        borderColor: c.border,
        padding: 16,
        gap: 14,
      }}
    >
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
    </View>
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
      <Text style={{ color: tone && n > 0 ? tone : c.text, ...TEXT['2xl'] }}>
        {n}
      </Text>
      <Text style={{ color: c.muted, ...TEXT.xs }} numberOfLines={2}>{label}</Text>
    </Pressable>
  )
}

function MaterialCard({ m }: { m: MaterialRow }) {
  const { c } = usePalette()
  const low = isLowStock(m)
  const stock = m.current_stock ?? 0
  return (
    <View
      style={{
        backgroundColor: c.surface,
        borderRadius: RADIUS.card,
        borderWidth: 1,
        borderColor: c.border,
        padding: 14,
        minHeight: TAP_MIN,
        // Нулевой остаток ПРИГЛУШЁН, а не спрятан: спрятанное читается
        // как «этого засоба у меня нет», а он есть — просто кончился.
        opacity: stock === 0 ? 0.55 : 1,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: c.text, ...TEXT.lg }} numberOfLines={1}>
            {m.name}
          </Text>
          {/* Величины разделяются СТРОКАМИ, а не точками: на 390px
              подпись переносится, и точка встаёт в начало второй строки,
              читаясь как маркер списка (решение владельца 25.08.2026). */}
          {m.brand ? (
            <Text style={{ color: c.muted, ...TEXT.base }} numberOfLines={1}>{m.brand}</Text>
          ) : null}
        </View>

        <View style={{ alignItems: 'flex-end', gap: 2 }}>
          <Text style={{ color: low ? c.warn : c.text, ...TEXT.xl }}>
            {t.number(stock)}
          </Text>
          <Text style={{ color: c.faint, ...TEXT.xs }}>{m.unit}</Text>
        </View>
      </View>

      {low ? (
        <Text style={{ color: c.warn, ...TEXT.sm, marginTop: 8 }}>
          {t('inventory.stats.low')}
        </Text>
      ) : null}
    </View>
  )
}

/** Отказ по одной из двух осей доступа. Экран, а не молчаливый возврат. */
function Gate({ title, desc, m }: { title: string; desc: string; m: Membership | null }) {
  const { c } = usePalette()
  return (
    <Centered>
      <View style={{ gap: 8, padding: 24 }}>
        <Text style={{ color: c.text, ...TEXT['2xl'] }}>{title}</Text>
        <Text style={{ color: c.muted, ...TEXT.md }}>{desc}</Text>
        {/* Токен без клейма модулей — это устаревший токен, а не заведение
            без модулей, и лечится он повторным входом. Отличать эти два
            случая умеет `modulesFromToken`; молчать о втором значит
            оставить человека с «мне сюда нельзя» навсегда. */}
        {m && !m.modulesFromToken ? (
          <Text style={{ color: c.faint, ...TEXT.base }}>{t('mobile.gate.stale')}</Text>
        ) : null}
        <Pressable
          onPress={() => supabase.auth.signOut()}
          style={({ pressed }) => ({
            minHeight: TAP_MIN, marginTop: 12, alignItems: 'center', justifyContent: 'center',
            borderRadius: RADIUS.control, borderWidth: 1, borderColor: c.border,
            backgroundColor: pressed ? c.surface2 : 'transparent',
          })}
        >
          <Text style={{ color: c.text, ...TEXT.md }}>{t('mobile.signOut')}</Text>
        </Pressable>
      </View>
    </Centered>
  )
}

function Centered({ children }: { children: ReactNode }) {
  const { c } = usePalette()
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bg }}>
      {children}
    </View>
  )
}

function Spinner() {
  const { c } = usePalette()
  return <ActivityIndicator color={c.accent} />
}
