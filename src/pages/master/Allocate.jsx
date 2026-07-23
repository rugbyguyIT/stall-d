import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import AppShell from '../../components/AppShell'
import { todayISO, addDaysISO, range } from '../../lib/format'

export default function Allocate() {
  const { portalId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [portal, setPortal] = useState(null)
  const [from, setFrom] = useState(todayISO())
  const [to, setTo] = useState(addDaysISO(todayISO(), 4))
  const [stalls, setStalls] = useState([])            // assignable_stalls result
  const [selected, setSelected] = useState(new Set())
  const [existing, setExisting] = useState([])
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    supabase.from('portals').select('id,name,slug,accent_color').eq('id', portalId).single()
      .then(({ data }) => setPortal(data))
  }, [portalId])

  async function loadAssignable() {
    if (from >= to) return
    const { data } = await supabase.rpc('assignable_stalls', { p_from: from, p_to: to })
    setStalls(data ?? [])
    setSelected(new Set())
  }
  async function loadExisting() {
    const { data } = await supabase.from('stall_allocations')
      .select('id,start_date,end_date,stalls(name,barns(name,sort_order))')
      .eq('portal_id', portalId).order('start_date')
    setExisting(data ?? [])
  }
  useEffect(() => { loadAssignable() }, [from, to])
  useEffect(() => { loadExisting() }, [portalId])

  const barns = useMemo(() => {
    const g = new Map()
    for (const s of stalls) {
      if (!g.has(s.barn)) g.set(s.barn, { sort: s.sort_order, list: [] })
      g.get(s.barn).list.push(s)
    }
    return [...g.entries()].sort((a, b) => a[1].sort - b[1].sort)
  }, [stalls])

  const freeInBarn = (list) => list.filter((s) => !s.taken)
  const toggle = (id) => setSelected((prev) => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n
  })
  const setMany = (ids, on) => setSelected((prev) => {
    const n = new Set(prev); ids.forEach((id) => on ? n.add(id) : n.delete(id)); return n
  })

  // contiguous range picker state, per barn
  const [rangePick, setRangePick] = useState({})
  function applyRange(barn, list) {
    const rp = rangePick[barn]
    if (!rp?.a || !rp?.b) return
    const order = list.map((s) => s.stall_id)
    const ia = order.indexOf(rp.a), ib = order.indexOf(rp.b)
    if (ia < 0 || ib < 0) return
    const [lo, hi] = ia <= ib ? [ia, ib] : [ib, ia]
    const ids = list.slice(lo, hi + 1).filter((s) => !s.taken).map((s) => s.stall_id)
    setMany(ids, true)
  }

  async function assign() {
    setErr(''); setNote(''); setBusy(true)
    const rows = [...selected].map((stall_id) => ({
      portal_id: portalId, stall_id, start_date: from, end_date: to, created_by: user.id
    }))
    if (rows.length === 0) { setBusy(false); return setErr('Select at least one stall.') }
    const { error } = await supabase.from('stall_allocations').insert(rows)
    setBusy(false)
    if (error) {
      return setErr(/exclusion/.test(error.message)
        ? 'One or more of those stalls is already assigned to another company for overlapping dates. Refresh and try again.'
        : error.message)
    }
    setNote(`Assigned ${rows.length} stall${rows.length === 1 ? '' : 's'} to ${portal?.name} for ${range(from, to)}.`)
    loadAssignable(); loadExisting()
  }

  async function removeAlloc(id) {
    if (!confirm('Remove this assignment? The stall frees up for other companies (existing reservations are not deleted).')) return
    await supabase.from('stall_allocations').delete().eq('id', id)
    loadAssignable(); loadExisting()
  }

  const selectedCount = selected.size

  return (
    <AppShell>
      <div className="page-head">
        <div><div className="crumbs">Portals → {portal?.name ?? '…'}</div><h1>Assign stalls</h1></div>
        <button className="btn btn-ghost" onClick={() => navigate('/master')}>Back to portals</button>
      </div>

      {err && <div className="error-note">{err}</div>}
      {note && <div className="ok-note">{note}</div>}

      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div className="rangebar" style={{ marginBottom: 0 }}>
          <div className="field"><label>Assign for — from</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="field"><label>Through</label>
            <input type="date" value={to} min={addDaysISO(from, 1)} onChange={(e) => setTo(e.target.value)} /></div>
          <div style={{ marginLeft: 'auto', alignSelf: 'center' }} className="hint">
            Greyed stalls are already assigned to another company for these dates.
          </div>
        </div>
      </div>

      {barns.map(([barn, { list }]) => (
        <div className="card" key={barn} style={{ padding: 16, marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
            <b style={{ fontSize: 14 }}>{barn}</b>
            <button type="button" className="btn btn-ghost btn-sm"
              onClick={() => setMany(freeInBarn(list).map((s) => s.stall_id), true)}>Select whole barn</button>
            <button type="button" className="btn btn-ghost btn-sm"
              onClick={() => setMany(list.map((s) => s.stall_id), false)}>Clear</button>
            <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', marginLeft: 'auto' }}>
              <span className="hint">Range</span>
              <select value={rangePick[barn]?.a ?? ''} onChange={(e) => setRangePick({ ...rangePick, [barn]: { ...rangePick[barn], a: e.target.value } })} style={{ width: 'auto', padding: '5px 8px' }}>
                <option value="">from…</option>
                {list.map((s) => <option key={s.stall_id} value={s.stall_id}>{s.name}</option>)}
              </select>
              <select value={rangePick[barn]?.b ?? ''} onChange={(e) => setRangePick({ ...rangePick, [barn]: { ...rangePick[barn], b: e.target.value } })} style={{ width: 'auto', padding: '5px 8px' }}>
                <option value="">to…</option>
                {list.map((s) => <option key={s.stall_id} value={s.stall_id}>{s.name}</option>)}
              </select>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => applyRange(barn, list)}>Add range</button>
            </span>
          </div>
          <div className="stall-grid">
            {list.map((s) => {
              const on = selected.has(s.stall_id)
              return (
                <button key={s.stall_id} type="button"
                  className={'stall ' + (s.taken ? 'blocked' : on ? 'reserved' : 'available')}
                  disabled={s.taken}
                  title={s.taken ? `${s.name} — already assigned for these dates` : `${s.name} — click to ${on ? 'remove' : 'select'}`}
                  onClick={() => toggle(s.stall_id)}>
                  {s.name}<small>{s.taken ? 'taken' : on ? 'selected' : 'free'}</small>
                </button>
              )
            })}
          </div>
        </div>
      ))}

      {stalls.length === 0 && <div className="card" style={{ padding: 20, color: 'var(--muted)' }}>
        No stalls exist yet. Add barns and stalls first under <b>Barns &amp; stalls</b>.</div>}

      {stalls.length > 0 && (
        <div style={{ position: 'sticky', bottom: 0, background: 'var(--page)', padding: '12px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
          <b>{selectedCount} stall{selectedCount === 1 ? '' : 's'} selected</b>
          <span className="hint">for {range(from, to)}</span>
          <button className="btn btn-primary" style={{ marginLeft: 'auto' }} disabled={busy || selectedCount === 0} onClick={assign}>
            {busy ? 'Assigning…' : `Assign to ${portal?.name ?? 'company'}`}
          </button>
        </div>
      )}

      <h3 style={{ fontSize: 14, margin: '18px 0 10px' }}>Current assignments</h3>
      <div className="card">
        <table>
          <thead><tr><th>Stall</th><th>Barn</th><th>Dates</th><th /></tr></thead>
          <tbody>
            {existing.map((a) => (
              <tr key={a.id}>
                <td><b>{a.stalls?.name}</b></td>
                <td>{a.stalls?.barns?.name}</td>
                <td>{range(a.start_date, a.end_date)}</td>
                <td style={{ textAlign: 'right' }}>
                  <button className="btn btn-danger-ghost btn-sm" onClick={() => removeAlloc(a.id)}>Remove</button>
                </td>
              </tr>
            ))}
            {existing.length === 0 && <tr><td colSpan={4} className="hint">No stalls assigned to this company yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </AppShell>
  )
}
