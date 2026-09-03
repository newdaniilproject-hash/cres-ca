// Загрузка данных экрана: один хук на все разделы.
//
// Каждому экрану нужен один и тот же танец — запросить, показать
// вращающийся кружок, поймать ошибку, дать потянуть список для
// обновления. Три копии этого танца разъезжаются ровно так же, как
// разъезжались копии проверки прав: в одном экране ошибка гасится,
// в другом остаётся навсегда, и замечает это не разработчик.
//
// ⚠️ ТЕКСТ ОШИБКИ БАЗЫ НАРУЖУ НЕ ВЫХОДИТ. Postgres при нарушении
// уникальности печатает ЗНАЧЕНИЕ поля — то есть на экран уехал бы
// телефон клиента (CLAUDE.md, М25). Здесь только чтение, но правило
// одно на весь продукт: человеку общая подпись, подробности в консоль.

import { useCallback, useEffect, useState } from 'react'

export type Loader<T> = {
  data: T | null
  /** Первая загрузка ещё идёт и показывать нечего. */
  loading: boolean
  error: boolean
  refreshing: boolean
  reload: () => Promise<void>
  refresh: () => Promise<void>
}

export function useLoader<T>(fetcher: () => Promise<T>, deps: unknown[] = []): Loader<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fetcher, deps)

  const reload = useCallback(async () => {
    try {
      setError(false)
      setData(await run())
    } catch (e) {
      console.warn('[загрузка экрана]', e)
      setError(true)
    }
  }, [run])

  useEffect(() => { void reload() }, [reload])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    await reload()
    setRefreshing(false)
  }, [reload])

  return { data, loading: data === null && !error, error, refreshing, reload, refresh }
}
