import { useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { day, range } from '../../lib/format'

const REFRESH_MS = 60_000        // re-fetch board data every minute
const PAGE_MS = 12_000           // rotate assignment-list pages
const PAGE_SIZE = 12

/**
 * Fullscreen TV board: /portal/:slug/display?key=<display key>
 * Optional: &from=YYYY-MM-DD&to=YYYY-MM-DD (defaults to tonight)
 *           &demo=1 renders sample data (no key needed) for previewing.
 * No sign-in on the TV — the per-portal display key authorizes read-only
 * board data via the display_board() RPC; rotate the key to revoke.
 */
export default function DisplayBoard() {
  const { slug } = useParams()
  const [params] = useSearchParams()
  const demo = params.get('demo') === '1'
  const key = params.get('key')
  const [data, setData] = useState(undefined)
  const [now, setNow] = useState(new Date())
  const [page, setPage] = useState(0)

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (demo) { setData(DEMO); return }
    if (!key) { setData(null); return }
    let live = true
    async function load() {
      const { data: d, error } = await supabase.rpc('display_board', {
        p_slug: slug, p_key: key,
        p_from: params.get('from') ?? undefined,
        p_to: params.get('to') ?? undefined
      })
      if (live) setData(error ? null : d)
    }
    load()
    const t = setInterval(load, REFRESH_MS)
    return () => { live = false; clearInterval(t) }
  }, [slug, key, demo])

  const barns = useMemo(() => {
    const g = new Map()
    for (const s of data?.stalls ?? []) {
      const b = s.barn || 'Stalls'
      if (!g.has(b)) g.set(b, [])
      g.get(b).push(s)
    }
    return [...g.entries()]
  }, [data])

  const reservations = data?.reservations ?? []
  const pages = Math.max(1, Math.ceil(reservations.length / PAGE_SIZE))
  useEffect(() => {
    if (pages <= 1) { setPage(0); return }
    const t = setInterval(() => setPage((p) => (p + 1) % pages), PAGE_MS)
    return () => clearInterval(t)
  }, [pages])

  const counts = useMemo(() => {
    const c = { available: 0, reserved: 0, checked_in: 0, blocked: 0 }
    for (const s of data?.stalls ?? []) c[s.state] = (c[s.state] ?? 0) + 1
    return c
  }, [data])

  if (data === undefined) return <div className="tv tv-center">Loading board…</div>
  if (data === null)
    return (
      <div className="tv tv-center">
        <div>
          <div style={{ fontSize: '2.2vw', fontWeight: 700 }}>Display not authorized</div>
          <div style={{ color: 'var(--tv-ink-2)', marginTop: 8, fontSize: '1.2vw' }}>
            Check the display link, or open a fresh one from the portal dashboard
            (the key may have been rotated).
          </div>
        </div>
      </div>
    )

  const accent = data.portal.accent_color || '#2a78d6'
  const visible = reservations.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)

  return (
    <div className="tv" style={{ '--tv-accent': accent }}>
      <header className="tv-head">
        <div className="tv-brand">
          <div className="tv-logo">{data.portal.logo_letter || data.portal.name[0]}</div>
          <div>
            <div className="tv-title">{data.portal.name}</div>
            <div className="tv-sub">Stall assignments · Sandoval Ranch Arena{demo ? ' · DEMO' : ''}</div>
          </div>
        </div>
        <div className="tv-clockwrap">
          <div className="tv-date">{now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</div>
          <div className="tv-clock">{now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</div>
        </div>
      </header>

      <div className="tv-stats">
        <span><b>{counts.available}</b> open</span>
        <span className="tv-dot tv-dot-res" /><span><b>{counts.reserved}</b> reserved</span>
        <span className="tv-dot tv-dot-in" /><span><b>{counts.checked_in}</b> checked in</span>
        <span style={{ marginLeft: 'auto', color: 'var(--tv-ink-2)' }}>
          Showing {range(data.from, data.to)} · updates automatically
        </span>
      </div>

      <div className="tv-body">
        <section className="tv-map">
          {barns.map(([barn, stalls]) => (
            <div key={barn} className="tv-barn">
              <h3>{barn}</h3>
              <div className="tv-grid">
                {stalls.map((s) => (
                  <div key={s.stall_id} className={`tv-stall ${s.state}`}>
                    <span className="num">{s.name}</span>
                    <span className="who">
                      {s.state === 'available' ? 'OPEN'
                        : s.state === 'blocked' ? '—'
                        : s.state === 'checked_in' ? `✓ ${s.animal_name || 'Checked in'}`
                        : s.animal_name || 'Reserved'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>

        <aside className="tv-list">
          <h3>Assignments{pages > 1 ? ` · ${page + 1}/${pages}` : ''}</h3>
          <table>
            <tbody>
              {visible.map((r, i) => (
                <tr key={i} className={r.status === 'checked_in' ? 'in' : ''}>
                  <td className="stall">{r.stall}</td>
                  <td>
                    <div className="animal">{r.animal_name}</div>
                    <div className="owner">{r.owner_name}</div>
                  </td>
                  <td className="dates">{day(r.check_in)}–{day(r.check_out)}</td>
                </tr>
              ))}
              {reservations.length === 0 && (
                <tr><td style={{ color: 'var(--tv-ink-2)' }}>No upcoming assignments.</td></tr>
              )}
            </tbody>
          </table>
        </aside>
      </div>
    </div>
  )
}

const DEMO = {
  portal: { name: 'Buckeye Rodeo Co.', slug: 'demo', accent_color: '#1baf7a', logo_letter: 'B' },
  from: '2026-07-24', to: '2026-07-26',
  stalls: [
    ...Array.from({ length: 20 }, (_, i) => {
      const n = i + 1
      const state = [1, 4].includes(n) ? 'checked_in' : [7, 11, 12].includes(n) ? 'available'
        : n === 20 ? 'blocked' : 'reserved'
      // Matches the demo reservation list below for A1–A6.
      const names = ['Whiskey River', 'Dusty', 'Miss Firefly', 'Tornado Jack', 'Sugarfoot', 'Cinnamon',
        null, 'Maverick', 'Peaches', 'Rango', null, null, 'Honey Bee', 'Comet', 'Rooster',
        'Delta Dawn', 'Blue Duck', 'Bandit', 'Loretta', null]
      return {
        stall_id: 'a' + n, name: 'A' + n, barn: 'Barn A', state,
        animal_name: state === 'reserved' || state === 'checked_in' ? names[n - 1] : null,
        owner_name: null
      }
    })
  ],
  reservations: [
    { stall: 'A1', animal_name: 'Whiskey River', owner_name: 'Cassidy Boone', check_in: '2026-07-24', check_out: '2026-07-26', status: 'checked_in' },
    { stall: 'A2', animal_name: 'Dusty', owner_name: 'J.T. Calloway', check_in: '2026-07-24', check_out: '2026-07-26', status: 'confirmed' },
    { stall: 'A3', animal_name: 'Miss Firefly', owner_name: 'Reyna Alvarez', check_in: '2026-07-23', check_out: '2026-07-27', status: 'confirmed' },
    { stall: 'A4', animal_name: 'Tornado Jack', owner_name: 'Boone Hastings', check_in: '2026-07-24', check_out: '2026-07-25', status: 'checked_in' },
    { stall: 'A5', animal_name: 'Sugarfoot', owner_name: 'Mae Whitfield', check_in: '2026-07-24', check_out: '2026-07-26', status: 'confirmed' },
    { stall: 'A6', animal_name: 'Cinnamon', owner_name: 'Hank Dillard', check_in: '2026-07-25', check_out: '2026-07-27', status: 'confirmed' }
  ]
}
