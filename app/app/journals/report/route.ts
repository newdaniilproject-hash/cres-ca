import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { currentMembership } from '@/lib/tenant'
import { reportHtml, type ReportData } from '@/lib/report/sanitation-report'

// Paperless-отчёт для перевірки (Держпродспоживслужба / Держлікслужба).
//
// Отдаётся как HTML, который печатается в PDF одной кнопкой браузера.
// Почему не серверный PDF-генератор: кириллица в PDF требует встроенных
// шрифтов и тянет тяжёлую зависимость, а браузер уже умеет и то, и другое.
// Печать в PDF на телефоне и на компьютере даёт одинаковый файл.
//
// Всё, что попадает в отчёт, RLS отдаёт только тому, у кого есть
// compliance.read — то есть и владельцу, и приглашённому инспектору.
export async function GET(request: Request) {
  const m = await currentMembership()
  if (!m) return new NextResponse('Немає доступу', { status: 403 })

  const url = new URL(request.url)
  const days = Math.min(Math.max(Number(url.searchParams.get('days') ?? 90), 1), 365)
  const from = new Date(Date.now() - days * 864e5).toISOString()

  const supabase = await createClient()

  const [shop, materials, batches, containers, solutions, cleaning, cycles, cards] =
    await Promise.all([
      supabase.from('tenants')
        .select('name, legal_name, tax_id, city, address, contact_phone')
        .eq('id', m.tenantId).single(),
      supabase.from('materials')
        .select('name, brand, country_of_origin, inci, notification_code, pao_months, unit, current_stock, is_cosmetic')
        .eq('tenant_id', m.tenantId).eq('is_active', true).order('name'),
      supabase.from('material_batches')
        .select('batch_number, expiry_date, received_at, materials(name), suppliers(name)')
        .eq('tenant_id', m.tenantId).order('expiry_date'),
      supabase.from('material_containers')
        .select('code, status, opened_at, use_by, volume, unit, materials(name)')
        .eq('tenant_id', m.tenantId).in('status', ['sealed', 'opened', 'finished'])
        .order('use_by', { nullsFirst: false }),
      supabase.from('sanitation_solutions')
        .select('agent_name, registration, concentration, volume, unit, prepared_at, expires_at, profiles!sanitation_solutions_prepared_by_fkey(full_name)')
        .eq('tenant_id', m.tenantId).gte('prepared_at', from)
        .order('prepared_at', { ascending: false }),
      supabase.from('cleaning_entries')
        .select('performed_at, cleaning_tasks(name), profiles!cleaning_entries_performed_by_fkey(full_name)')
        .eq('tenant_id', m.tenantId).gte('performed_at', from)
        .order('performed_at', { ascending: false }).limit(500),
      supabase.from('sterilization_cycles')
        .select('device, temperature_c, duration_minutes, indicator_ok, performed_at, profiles!sterilization_cycles_performed_by_fkey(full_name)')
        .eq('tenant_id', m.tenantId).gte('performed_at', from)
        .order('performed_at', { ascending: false }),
      supabase.from('tech_cards')
        .select('title, version, steps, created_at')
        .eq('tenant_id', m.tenantId).eq('is_active', true).order('title'),
    ])

  const html = reportHtml({
    shop: shop.data,
    days,
    materials: materials.data ?? [],
    // Embedded FK relations (materials, suppliers, profiles, cleaning_tasks) are
    // to-one, but without generated Supabase Database types the client can't
    // know that and infers them as arrays — same reason as the cast in
    // app/app/inventory/labels/route.ts.
    batches: (batches.data ?? []) as unknown as ReportData['batches'],
    containers: (containers.data ?? []) as unknown as ReportData['containers'],
    solutions: (solutions.data ?? []) as unknown as ReportData['solutions'],
    cleaning: (cleaning.data ?? []) as unknown as ReportData['cleaning'],
    cycles: (cycles.data ?? []) as unknown as ReportData['cycles'],
    cards: cards.data ?? [],
  })

  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}
