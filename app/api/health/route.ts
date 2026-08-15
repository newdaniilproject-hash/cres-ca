import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 20

// Проверка состояния приложения. Шаг 2, пункт В.
//
// ── Что здесь проверяется, а что НЕ здесь ─────────────────────────────────
//
// Этот адрес доступен снаружи и отвечает правами анонима. Значит он может
// честно проверить только то, что видно анониму:
//
//   БАЗА    — публичное чтение через ту же функцию, которой пользуется
//             витрина. Проверяет разом: живо ли приложение, доходит ли оно
//             до Supabase, отвечает ли PostgREST и не сломаны ли политики.
//             При испорченной политике вызов не падает, а возвращает ошибку,
//             и она попадает сюда.
//   НАСТРОЙКИ — на месте ли переменные окружения, без которых молча
//             перестают работать фоновые задачи. Именно молча: письмо
//             не уходит, а страница отвечает двумястами.
//
// Очередь уведомлений, расписание pg_cron и сроки его последнего запуска
// СЮДА НЕ ВХОДЯТ, и это решение, а не упущение. Аноним их не читает — и не
// должен: открыть их значило бы завести девятую публичную точку вопреки
// правилу 7. Эти проверки живут в `scripts/health.sh`, который ходит в базу
// по служебной строке подключения из GitHub Actions и имеет на них право.
//
// ── Почему имена переменных не называются в ответе ────────────────────────
//
// Тело ответа читает кто угодно. Сообщение «нет CRON_SECRET» — это указание
// злоумышленнику, что адреса расписания открыты. Поэтому наружу уходит
// только число, а какая именно переменная потерялась, смотрят в панели
// хостинга.
//
// ── Что отдаётся ──────────────────────────────────────────────────────────
//
// 200 — всё живо. 503 — что-то нет. Код ответа важнее тела: сторож смотрит
// на него, человек — в тело.

type Check = { name: string; ok: boolean; ms: number; detail?: string }

async function timed(name: string, fn: () => Promise<string | null>): Promise<Check> {
  const started = Date.now()
  try {
    const detail = await fn()
    return { name, ok: true, ms: Date.now() - started, ...(detail ? { detail } : {}) }
  } catch (e) {
    return {
      name, ok: false, ms: Date.now() - started,
      detail: e instanceof Error ? e.message : String(e),
    }
  }
}

// Без этих переменных фоновые задачи отказывают беззвучно.
const REQUIRED_ENV = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'RESEND_API_KEY',
  'CRON_SECRET',
]

export async function GET() {
  const checks: Check[] = []

  // 1. База и политики: тем же путём, что и витрина.
  checks.push(await timed('database', async () => {
    const supabase = await createClient()
    const { error } = await supabase.rpc('active_cities')
    if (error) throw new Error(error.message)
    return null
  }))

  // 2. Настройки: только количество, без имён (см. заголовок файла).
  checks.push(await timed('config', async () => {
    const missing = REQUIRED_ENV.filter((k) => !process.env[k])
    if (missing.length > 0) throw new Error(`${missing.length} налаштувань відсутні`)
    return null
  }))

  const ok = checks.every((c) => c.ok)

  return NextResponse.json(
    {
      status: ok ? 'ok' : 'degraded',
      at: new Date().toISOString(),
      checks,
    },
    {
      status: ok ? 200 : 503,
      // Ответ сторожа кешировать нельзя ни на секунду: закешированное «ok»
      // — это ровно то, из-за чего сторожа перестают замечать аварии.
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    },
  )
}
