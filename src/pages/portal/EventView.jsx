import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { usePortal } from '../../context/PortalContext'
import AppShell from '../../components/AppShell'
import { range } from '../../lib/format'

export default function EventView() {
  const { slug, eventId } = useParams()
  const { portal, isPortalAdmin } = usePortal()
  const navigate = useNavigate()
  const [event, setEvent] = useState(null)
  const [board, setBoard] = useState(null)

  async function load() {
    const { data: e } = await supabase.from('events').select('*').eq('id', eventId).single()
    setEvent(e)
    const { data } = await supabase.rpc('event_stall_board', { p_event_id: eventId })
    setBoard(data ?? [])
  }
  useEffect(() => { load() }, [eventId])

  const barns = useMemo(() => {
    const g = new Map()
    for (const s of board ?? []) { const b = s.barn || 'Stalls'; if (!g.has(b)) g.set(b, []); g.get(b).push(s) }
    return [...g.entries()]
  }, [board])

  const counts = useMemo(() => {
    const c = { available: 0, reserved: 0, checked_in: 0, blocked: 0 }
    for (const s of board ?? []) c[s.state] = (c[s.state] ?? 0) + 1
    return c
  }, [board])

  function clickStall(s) {
    if (s.state === 'available') navigate(`/portal/${slug}/events/${eventId}/reserve?stall=${s.stall_id}`)
    else if (s.contestant_id) navigate(`/portal/${slug}/contestants/${s.contestant_id}`)
    else if (s.reservation_id) navigate(`/portal/${slug}/events/${eventId}/reserve/${s.reservation_id}`)
  }

  if (!event) return <AppShell><div className="page-loader">Loading…</div></AppShell>
  const total = board?.length ?? 0
  const occupied = counts.reserved + counts.checked_in

  return (
    <AppShell>
      <div className="page-head">
        <div>
          <div className="crumbs">Events → {event.name}</div>
          <h1>{event.name}</h1>
          <div className="hint">{range(event.start_date, event.end_date)} · {(event.animal_types ?? []).join(', ') || 'no animal types'}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost" onClick={() => navigate(`/portal/${slug}`)}>All events</button>
          <button className="btn btn-primary" onClick={() => navigate(`/portal/${slug}/events/${eventId}/reserve`)}>+ New reservation</button>
        </div>
      </div>

      <div className="tiles">
        <div className="tile"><div className="k">Occupancy</div><div className="v">{total ? Math.round((occupied / total) * 100) : 0}%</div><div className="d">{occupied} of {total} stalls</div></div>
        <div className="tile"><div className="k">Open</div><div className="v">{counts.available}</div></div>
        <div className="tile"><div className="k">Checked in</div><div className="v">{counts.checked_in}</div></div>
      </div>

      {total === 0 && <div className="card" style={{ padding: 24, color: 'var(--muted)' }}>
        No stalls assigned to this event yet. The property admin assigns stalls from the master console (Events → Assign stalls).</div>}

      <div className="card barn">
        {barns.map(([barn, stalls]) => (
          <div key={barn}>
            <h4>{barn} · {stalls.length} stalls</h4>
            <div className="stall-grid" style={{ marginBottom: 8 }}>
              {stalls.map((s) => (
                <button key={s.stall_id} className={`stall ${s.state}`} disabled={s.state === 'blocked'}
                  title={s.state === 'available' ? `${s.name} — open · click to reserve`
                    : `${s.name} — ${s.state.replace('_', ' ')}${s.animal_name ? ` · ${s.animal_name}` : ''}`}
                  onClick={() => clickStall(s)}>
                  {s.name}<small>{{ available: 'open', reserved: s.animal_name || 'res.', checked_in: '✓ ' + (s.animal_name || 'in'), blocked: 'blocked' }[s.state]}</small>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </AppShell>
  )
}
