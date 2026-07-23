import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import AppShell from '../../components/AppShell'
import { ANIMAL_TYPES } from '../../lib/animals'
import { range, todayISO, addDaysISO } from '../../lib/format'

export default function EventsAdmin() {
  const { portalId } = useParams()
  const navigate = useNavigate()
  const [portal, setPortal] = useState(null)
  const [events, setEvents] = useState(null)
  const [editing, setEditing] = useState(null) // event | 'new'
  const [assignFor, setAssignFor] = useState(null) // event

  async function load() {
    const { data: p } = await supabase.from('portals').select('id,name,slug').eq('id', portalId).single()
    setPortal(p)
    const { data } = await supabase.from('events')
      .select('id,name,start_date,end_date,animal_types,notes,event_stalls(count)')
      .eq('portal_id', portalId).order('start_date', { ascending: false })
    setEvents(data ?? [])
  }
  useEffect(() => { load() }, [portalId])

  return (
    <AppShell>
      <div className="page-head">
        <div><div className="crumbs">Portals → {portal?.name ?? '…'}</div><h1>Events</h1></div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost" onClick={() => navigate('/master')}>Back to portals</button>
          <button className="btn btn-primary" onClick={() => setEditing('new')}>+ New event</button>
        </div>
      </div>
      <p className="hint" style={{ marginTop: -10, marginBottom: 18, maxWidth: 640 }}>
        An event is a show with its own dates and animal types. Assign the stalls each event uses;
        reservations then attach to the event and inherit its dates.
      </p>

      {events === null && <div className="page-loader">Loading…</div>}
      {events?.length === 0 && <div className="card" style={{ padding: 24, color: 'var(--muted)' }}>No events yet. Create the first one.</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {(events ?? []).map((e) => (
          <div className="card" key={e.id} style={{ padding: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <b style={{ fontSize: 15 }}>{e.name}</b>
                <div className="hint">{range(e.start_date, e.end_date)} · {(e.animal_types ?? []).join(', ') || 'no animal types set'}</div>
                <div className="hint">{e.event_stalls?.[0]?.count ?? 0} stalls assigned</div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-primary btn-sm" onClick={() => setAssignFor(e)}>Assign stalls</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setEditing(e)}>Edit</button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {editing && <EventModal portalId={portalId} event={editing === 'new' ? null : editing}
        onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />}
      {assignFor && <AssignStallsModal event={assignFor}
        onClose={() => setAssignFor(null)} onSaved={load} />}
    </AppShell>
  )
}

function EventModal({ portalId, event, onClose, onSaved }) {
  const { user } = useAuth()
  const editing = Boolean(event)
  const [name, setName] = useState(event?.name ?? '')
  const [start, setStart] = useState(event?.start_date ?? todayISO())
  const [end, setEnd] = useState(event?.end_date ?? addDaysISO(todayISO(), 2))
  const [types, setTypes] = useState(new Set(event?.animal_types ?? []))
  const [notes, setNotes] = useState(event?.notes ?? '')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const toggle = (t) => setTypes((prev) => { const n = new Set(prev); n.has(t) ? n.delete(t) : n.add(t); return n })

  async function save(e) {
    e.preventDefault()
    setErr(''); setBusy(true)
    const payload = { name, start_date: start, end_date: end, animal_types: [...types], notes: notes || null }
    const { error } = editing
      ? await supabase.from('events').update(payload).eq('id', event.id)
      : await supabase.from('events').insert({ ...payload, portal_id: portalId, created_by: user.id })
    setBusy(false)
    if (error) return setErr(error.message)
    onSaved()
  }

  async function del() {
    if (!confirm('Delete this event? Its stall assignments are removed (reservations are kept but unlinked).')) return
    await supabase.from('events').delete().eq('id', event.id)
    onSaved()
  }

  return (
    <div className="modal-back" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2>{editing ? 'Edit event' : 'New event'}</h2>
        {err && <div className="error-note">{err}</div>}
        <form onSubmit={save}>
          <div className="field"><label>Event name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Summer Barrel Race" autoFocus /></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="field"><label>Start date</label><input type="date" value={start} onChange={(e) => setStart(e.target.value)} required /></div>
            <div className="field"><label>End date</label><input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} required /></div>
          </div>
          <div className="field"><label>Animal types</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {ANIMAL_TYPES.map((t) => (
                <button type="button" key={t} className={'btn btn-sm ' + (types.has(t) ? 'btn-primary' : 'btn-ghost')} onClick={() => toggle(t)}>{t}</button>
              ))}
            </div>
          </div>
          <div className="field"><label>Notes <span style={{ fontWeight: 400, color: 'var(--muted)' }}>(optional)</span></label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', marginTop: 8 }}>
            {editing ? <button type="button" className="btn btn-danger-ghost" onClick={del}>Delete event</button> : <span />}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save' : 'Create event'}</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

function AssignStallsModal({ event, onClose, onSaved }) {
  const [stalls, setStalls] = useState([])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [rangePick, setRangePick] = useState({})

  async function load() {
    const { data } = await supabase.rpc('event_assignable_stalls', { p_event_id: event.id })
    setStalls(data ?? [])
  }
  useEffect(() => { load() }, [event.id])

  const barns = useMemo(() => {
    const g = new Map()
    for (const s of stalls) { if (!g.has(s.barn)) g.set(s.barn, { sort: s.sort_order, list: [] }); g.get(s.barn).list.push(s) }
    return [...g.entries()].sort((a, b) => a[1].sort - b[1].sort)
  }, [stalls])

  async function add(ids) {
    setErr(''); setBusy(true)
    const rows = ids.filter(Boolean).map((stall_id) => ({ event_id: event.id, stall_id }))
    if (rows.length) {
      const { error } = await supabase.from('event_stalls').insert(rows)
      if (error) setErr(/exclusion/.test(error.message) ? 'One or more stalls are already used by another event on these dates.' : error.message)
    }
    setBusy(false); load(); onSaved()
  }
  async function remove(stall_id) {
    await supabase.from('event_stalls').delete().eq('event_id', event.id).eq('stall_id', stall_id)
    load(); onSaved()
  }
  function applyRange(barn, list) {
    const rp = rangePick[barn]; if (!rp?.a || !rp?.b) return
    const order = list.map((s) => s.stall_id); const ia = order.indexOf(rp.a), ib = order.indexOf(rp.b)
    if (ia < 0 || ib < 0) return
    const [lo, hi] = ia <= ib ? [ia, ib] : [ib, ia]
    add(list.slice(lo, hi + 1).filter((s) => !s.taken && !s.in_event).map((s) => s.stall_id))
  }

  return (
    <div className="modal-back" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 680 }}>
        <h2>Assign stalls — {event.name}</h2>
        <div className="hint" style={{ marginBottom: 12 }}>{range(event.start_date, event.end_date)} · click a free stall to add it; assigned stalls are highlighted.</div>
        {err && <div className="error-note">{err}</div>}
        {barns.map(([barn, { list }]) => (
          <div key={barn} style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
              <b style={{ fontSize: 13 }}>{barn}</b>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => add(list.filter((s) => !s.taken && !s.in_event).map((s) => s.stall_id))}>Add whole barn</button>
              <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center', marginLeft: 'auto' }}>
                <select value={rangePick[barn]?.a ?? ''} onChange={(e) => setRangePick({ ...rangePick, [barn]: { ...rangePick[barn], a: e.target.value } })} style={{ width: 'auto', padding: '4px 6px' }}>
                  <option value="">from…</option>{list.map((s) => <option key={s.stall_id} value={s.stall_id}>{s.name}</option>)}
                </select>
                <select value={rangePick[barn]?.b ?? ''} onChange={(e) => setRangePick({ ...rangePick, [barn]: { ...rangePick[barn], b: e.target.value } })} style={{ width: 'auto', padding: '4px 6px' }}>
                  <option value="">to…</option>{list.map((s) => <option key={s.stall_id} value={s.stall_id}>{s.name}</option>)}
                </select>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => applyRange(barn, list)}>Add range</button>
              </span>
            </div>
            <div className="stall-grid">
              {list.map((s) => (
                <button key={s.stall_id} type="button"
                  className={'stall ' + (s.in_event ? 'reserved' : s.taken ? 'blocked' : 'available')}
                  disabled={s.taken && !s.in_event}
                  title={s.in_event ? `${s.name} — in this event (click to remove)` : s.taken ? `${s.name} — used by another event` : `${s.name} — click to add`}
                  onClick={() => s.in_event ? remove(s.stall_id) : (!s.taken && add([s.stall_id]))}>
                  {s.name}<small>{s.in_event ? 'in event' : s.taken ? 'taken' : 'free'}</small>
                </button>
              ))}
            </div>
          </div>
        ))}
        {stalls.length === 0 && <div className="hint">No stalls exist yet — add barns and stalls under Barns &amp; stalls first.</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
          <button className="btn btn-primary" onClick={onClose} disabled={busy}>Done</button>
        </div>
      </div>
    </div>
  )
}
