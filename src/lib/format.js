const fmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })
const fmtFull = new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'
})

export const parseDay = (iso) => new Date(iso + 'T00:00:00')
export const day = (iso) => (iso ? fmt.format(parseDay(iso)) : '—')
export const stamp = (ts) => (ts ? fmtFull.format(new Date(ts)) : '—')
export const range = (a, b) => `${day(a)} – ${day(b)}`
export const nights = (a, b) =>
  Math.max(0, Math.round((parseDay(b) - parseDay(a)) / 86400000))
export const money = (n) => `$${Number(n).toFixed(Number.isInteger(Number(n)) ? 0 : 2)}`
export const bytes = (n) =>
  n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`
export const initials = (name = '') =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?'
export const todayISO = () => new Date().toISOString().slice(0, 10)
export const addDaysISO = (iso, d) => {
  const t = parseDay(iso); t.setDate(t.getDate() + d)
  return t.toISOString().slice(0, 10)
}
