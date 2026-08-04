// Подстановка {{плейсхолдеров}} в шаблон. Шаблоны живут в базе
// (notification_templates), не в коде — см. комментарий в 0011_notifications.sql:
// «событие описывается один раз».
export function render(template: string, payload: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const v = payload[key]
    return v === null || v === undefined ? '' : String(v)
  })
}
