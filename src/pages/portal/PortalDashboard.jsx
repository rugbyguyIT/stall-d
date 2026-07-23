import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { usePortal } from '../../context/PortalContext'
import AppShell from '../../components/AppShell'
import { range, todayISO } from '../../lib/format'

export default function PortalDashboard() {
  const { portal, slug, isPortalAdmin } = usePortal()
  const navigate = useNavigate()
  const [events, setEvents] = useState(null)

  useEffect(() => {
    if (!portal?.id) return
    supabase.from('events')
      .select('id,name,start_date,end_date,animal_types,event_stalls(count),reservations(count)')
      .eq('portal_id', portal.id).order('start_date', { ascending: true })
      .then(({ data }) => setEvents(data ?? []))
  }, [portal?.id])

  const groups = useMemo(() => {
    const t = todayISO()
    const cur = [], up = [], past = []
    for (const e of events ?? []) {
      if (e.end_date < t) past.push(e)
      else if (e.start_date > t) up.push(e)
      else cur.push(e)
    }
    past.reverse()
    return { cur, up, past }
  }, [events])

  const Card = (e) => {
    const stalls = e.event_stalls?.[0]?.count ?? 0
    const res = e.reservations?.[0]?.count ?? 0
    return (
      <button className="card pcard" key={e.id} style={{ textAlign: 'left', cursor: 'pointer' }}
        onClick={() => navigate(`/portal/${slug}/events/${e.id}`)}>
        <div><h3 style={{ fontSize: 15 }}>{e.name}</h3>
          <div className="hint">{range(e.start_date, e.end_date)}</div></div>
        <div className="hint">{(e.animal_types ?? []).join(', ') || '—'}</div>
        <div className="pcard-stats">
          <div><b>{res}</b>reservations</div>
          <div><b>{stalls}</b>stalls</div>
        </div>
      </button>
    )
  }

  return (
    <AppShell>
      <div className="page-head">
        <div><div className="crumbs">/portal/{slug}</div><h1>Events</h1></div>
        {isPortalAdmin && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost" onClick={() => navigate(`/portal/${slug}/vet-report`)}>Vet report</button>
          </div>
        )}
      </div>

      {events === null && <div className="page-loader">Loading…</div>}
      {events?.length === 0 && (
        <div className="card" style={{ padding: 24, color: 'var(--muted)' }}>
          No events yet. {isPortalAdmin ? 'The property admin creates events for this company from the master console.' : ''}
        </div>
      )}

      {groups.cur.length > 0 && <Section title="Happening now" items={groups.cur} render={Card} />}
      {groups.up.length > 0 && <Section title="Upcoming" items={groups.up} render={Card} />}
      {groups.past.length > 0 && <Section title="Past events" items={groups.past} render={Card} />}
    </AppShell>
  )
}

function Section({ title, items, render }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <h2 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--muted)', margin: '0 0 10px' }}>{title}</h2>
      <div className="portal-cards">{items.map(render)}</div>
    </div>
  )
}
