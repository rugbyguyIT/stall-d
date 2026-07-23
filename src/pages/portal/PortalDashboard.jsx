import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { usePortal } from '../../context/PortalContext'
import AppShell from '../../components/AppShell'
import { todayISO, addDaysISO, range } from '../../lib/format'

export default function PortalDashboard() {
  const { portal, isPortalAdmin, slug } = usePortal()
  const navigate = useNavigate()
  const [from, setFrom] = useState(todayISO())
  const [to, setTo] = useState(addDaysISO(todayISO(), 2))
  const [board, setBoard] = useState(null)
  const [upcoming, setUpcoming] = useState([])

  async function load() {
    const { data, error } = await supabase.rpc('stall_board', {
      p_portal_id: portal.id, p_from: from, p_to: to
    })
    if (!error) setBoard(data ?? [])
    if (isPortalAdmin) {
      const { data: res } = await supabase
        .from('reservations')
        .select('id,animal_name,owner_name,check_in,check_out,status,stalls(name),contestants(id,vet_records(id))')
        .eq('portal_id', portal.id).neq('status', 'cancelled')
        .gte('check_out', todayISO())
        .order('check_in').limit(8)
      setUpcoming(res ?? [])
    }
  }
  useEffect(() => { if (portal?.id) load() }, [portal?.id, from, to, isPortalAdmin])

  const barns = useMemo(() => {
    const g = new Map()
    for (const s of board ?? []) {
      const key = s.barn || 'Stalls'
      if (!g.has(key)) g.set(key, [])
      g.get(key).push(s)
    }
    return [...g.entries()]
  }, [board])

  const counts = useMemo(() => {
    const c = { available: 0, reserved: 0, checked_in: 0, blocked: 0 }
    for (const s of board ?? []) c[s.state] = (c[s.state] ?? 0) + 1
    return c
  }, [board])
  const total = board?.length ?? 0
  const occupied = counts.reserved + counts.checked_in

  function clickStall(s) {
    if (s.state === 'available')
      navigate(`/portal/${slug}/reserve?stall=${s.stall_id}&from=${from}&to=${to}`)
    else if (isPortalAdmin && s.reservation_id)
      navigate(`/portal/${slug}/reserve/${s.reservation_id}`)
  }

  return (
    <AppShell>
      <div className="page-head">
        <div><div className="crumbs">/portal/{slug}</div><h1>Stall board</h1></div>
        <div style={{ display: 'flex', gap: 8 }}>
          {isPortalAdmin && <TvDisplayButton portalId={portal.id} slug={slug} />}
          <button className="btn btn-primary" onClick={() => navigate(`/portal/${slug}/reserve?from=${from}&to=${to}`)}>
            + New reservation
          </button>
        </div>
      </div>

      <div className="rangebar">
        <div className="field"><label>Check-in</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="field"><label>Check-out</label>
          <input type="date" value={to} min={addDaysISO(from, 1)} onChange={(e) => setTo(e.target.value)} /></div>
        <div className="grid-legend" style={{ marginLeft: 'auto' }}>
          <span><span className="sw" style={{ background: '#fff' }} />Available</span>
          <span><span className="sw" style={{ background: '#e8f1fc', borderColor: '#b7d3f6' }} />Reserved</span>
          <span><span className="sw" style={{ background: '#e7f6e7' }} />Checked in</span>
          <span><span className="sw" style={{ background: '#f1f0ec' }} />Blocked</span>
        </div>
      </div>

      <div className="tiles">
        <div className="tile"><div className="k">Occupancy · {range(from, to)}</div>
          <div className="v">{total ? Math.round((occupied / total) * 100) : 0}%</div>
          <div className="d">{occupied} of {total} stalls</div></div>
        <div className="tile"><div className="k">Open stalls</div><div className="v">{counts.available}</div></div>
        <div className="tile"><div className="k">Checked in</div><div className="v">{counts.checked_in}</div></div>
        {isPortalAdmin && (
          <div className="tile"><div className="k">Missing vet records</div>
            <div className="v" style={{ color: upcoming.some(missingVet) ? 'var(--critical)' : undefined }}>
              {upcoming.filter(missingVet).length}
            </div>
            <div className="d">of next {upcoming.length} reservations</div></div>
        )}
      </div>

      <div className="two-col">
        <div className="card barn">
          {board === null && <div className="page-loader">Loading stalls…</div>}
          {board?.length === 0 && (
            <div className="hint">No stalls yet. {isPortalAdmin ? 'The master admin can add stalls to this portal.' : ''}</div>
          )}
          {barns.map(([barn, stalls]) => (
            <div key={barn}>
              <h4>{barn} · {stalls.length} stalls</h4>
              <div className="stall-grid" style={{ marginBottom: 8 }}>
                {stalls.map((s) => (
                  <button
                    key={s.stall_id}
                    className={`stall ${s.state}`}
                    disabled={s.state === 'blocked'}
                    title={
                      s.state === 'available' ? `${s.name} — available ${range(from, to)} · click to reserve`
                        : s.state === 'blocked' ? `${s.name} — blocked`
                        : `${s.name} — ${s.state.replace('_', ' ')}${s.animal_name ? ` · ${s.animal_name} (${s.owner_name})` : ''}`
                    }
                    onClick={() => clickStall(s)}
                  >
                    {s.name}<small>{{ available: 'open', reserved: 'res.', checked_in: 'in', blocked: 'blocked' }[s.state]}</small>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {isPortalAdmin && (
          <div className="card">
            <div style={{ padding: '14px 14px 4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <b style={{ fontSize: 14 }}>Upcoming reservations</b>
            </div>
            <table>
              <thead><tr><th>Animal / owner</th><th>Stall</th><th>Dates</th><th /></tr></thead>
              <tbody>
                {upcoming.map((r) => (
                  <tr key={r.id} className="rowlink"
                    onClick={() => r.contestants?.[0]
                      ? navigate(`/portal/${slug}/contestants/${r.contestants[0].id}`)
                      : navigate(`/portal/${slug}/reserve/${r.id}`)}>
                    <td><b>{r.animal_name}</b><div className="hint">{r.owner_name}</div></td>
                    <td>{r.stalls?.name}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{range(r.check_in, r.check_out)}</td>
                    <td>{missingVet(r)
                      ? <span className="chip chip-critical">No vet rec</span>
                      : <span className="chip chip-good">Vet ✓</span>}</td>
                  </tr>
                ))}
                {upcoming.length === 0 && <tr><td colSpan={4} className="hint">No upcoming reservations.</td></tr>}
              </tbody>
            </table>
            <div style={{ padding: '10px 14px', borderTop: '1px solid var(--grid)', textAlign: 'center' }}>
              <Link to={`/portal/${slug}/reservations`} style={{ fontSize: 12.5, fontWeight: 600 }}>
                View all reservations →
              </Link>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  )
}

const missingVet = (r) => !(r.contestants ?? []).some((c) => (c.vet_records ?? []).length > 0)

/**
 * Staff-only helper: fetches this portal's display key and opens the branded
 * TV board (or copies the link / rotates the key from the small menu).
 */
function TvDisplayButton({ portalId, slug }) {
  const [open, setOpen] = useState(false)
  const [msg, setMsg] = useState('')

  async function displayUrl() {
    const { data, error } = await supabase
      .from('portal_display_keys').select('key').eq('portal_id', portalId).single()
    if (error || !data) throw new Error('Could not load the display key (staff only).')
    return `${location.origin}/portal/${slug}/display?key=${data.key}`
  }

  const act = (fn) => async () => {
    setMsg('')
    try { await fn() } catch (ex) { setMsg(ex.message) }
  }

  return (
    <span style={{ position: 'relative' }}>
      <button className="btn btn-ghost" onClick={() => { setOpen(!open); setMsg('') }}>📺 TV display</button>
      {open && (
        <span className="card" style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 30, padding: 10, width: 240, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <button className="btn btn-ghost btn-sm" onClick={act(async () => {
            window.open(await displayUrl(), '_blank', 'noopener'); setOpen(false)
          })}>Open board in new tab</button>
          <button className="btn btn-ghost btn-sm" onClick={act(async () => {
            await navigator.clipboard.writeText(await displayUrl())
            setMsg('Link copied — paste it into the TV browser.')
          })}>Copy link for the TV</button>
          <button className="btn btn-ghost btn-sm" onClick={act(async () => {
            if (!confirm('Rotate the display key? Every TV using the old link goes blank until you paste the new one.')) return
            const { error } = await supabase.rpc('rotate_display_key', { p_portal_id: portalId })
            if (error) throw error
            setMsg('Key rotated. Copy the new link to the TV.')
          })}>Rotate key (revoke old links)</button>
          <button className="btn btn-ghost btn-sm" onClick={() => {
            window.open(`/portal/${slug}/display?demo=1`, '_blank', 'noopener'); setOpen(false)
          }}>Preview with demo data</button>
          {msg && <span className="hint">{msg}</span>}
        </span>
      )}
    </span>
  )
}
