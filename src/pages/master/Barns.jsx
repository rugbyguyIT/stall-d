import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import AppShell from '../../components/AppShell'
import { money } from '../../lib/format'

export default function Barns() {
  const [propertyId, setPropertyId] = useState(null)
  const [barns, setBarns] = useState(null)
  const [err, setErr] = useState('')
  const [addingBarn, setAddingBarn] = useState(false)
  const [barnName, setBarnName] = useState('')
  const [stallModal, setStallModal] = useState(null) // barn object

  async function load() {
    const { data: props } = await supabase.from('properties').select('id').limit(1)
    const pid = props?.[0]?.id ?? null
    setPropertyId(pid)
    if (!pid) { setBarns([]); return }
    const { data } = await supabase
      .from('barns')
      .select('id,name,sort_order,stalls(id,name,is_blocked,nightly_rate)')
      .eq('property_id', pid)
      .order('sort_order')
    ;(data ?? []).forEach((b) => b.stalls?.sort((x, y) => x.name.localeCompare(y.name, undefined, { numeric: true })))
    setBarns(data ?? [])
  }
  useEffect(() => { load() }, [])

  async function addBarn(e) {
    e.preventDefault()
    setErr('')
    if (!propertyId) { setErr('Create a property row first (see migration notes).'); return }
    const { error } = await supabase.from('barns')
      .insert({ property_id: propertyId, name: barnName.trim(), sort_order: (barns?.length ?? 0) + 1 })
    if (error) return setErr(error.message)
    setBarnName(''); setAddingBarn(false); load()
  }

  async function toggleBlock(stall) {
    await supabase.from('stalls').update({ is_blocked: !stall.is_blocked }).eq('id', stall.id)
    load()
  }

  return (
    <AppShell>
      <div className="page-head">
        <div><div className="crumbs">Sandoval Ranch Arena</div><h1>Barns &amp; stalls</h1></div>
        <button className="btn btn-primary" onClick={() => setAddingBarn(true)}>+ Add barn</button>
      </div>
      <p className="hint" style={{ marginTop: -10, marginBottom: 18, maxWidth: 640 }}>
        These are the physical barns and stalls at the facility. Add barns here as you build them,
        then assign whole barns or blocks of stalls to companies for their event dates from each
        portal's <b>Assign stalls</b> screen.
      </p>

      {err && <div className="error-note">{err}</div>}

      {addingBarn && (
        <div className="card" style={{ padding: 16, marginBottom: 16, maxWidth: 460 }}>
          <form onSubmit={addBarn} style={{ display: 'flex', gap: 10, alignItems: 'end' }}>
            <div className="field" style={{ margin: 0, flex: 1 }}>
              <label>Barn name</label>
              <input value={barnName} onChange={(e) => setBarnName(e.target.value)} required placeholder="e.g. Barn C" autoFocus />
            </div>
            <button className="btn btn-primary">Add</button>
            <button type="button" className="btn btn-ghost" onClick={() => { setAddingBarn(false); setBarnName('') }}>Cancel</button>
          </form>
        </div>
      )}

      {barns === null && <div className="page-loader">Loading…</div>}
      {barns?.length === 0 && !addingBarn && (
        <div className="card" style={{ padding: 24, color: 'var(--muted)' }}>No barns yet. Add your first barn to get started.</div>
      )}

      {(barns ?? []).map((b) => (
        <div className="card" key={b.id} style={{ padding: 18, marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <b style={{ fontSize: 15 }}>{b.name} <span className="hint" style={{ fontWeight: 400 }}>· {b.stalls?.length ?? 0} stalls</span></b>
            <button className="btn btn-ghost btn-sm" onClick={() => setStallModal(b)}>+ Add stalls</button>
          </div>
          {b.stalls?.length ? (
            <div className="stall-grid">
              {b.stalls.map((s) => (
                <button key={s.id} className={'stall ' + (s.is_blocked ? 'blocked' : 'available')}
                  title={`${s.name} · ${money(s.nightly_rate)}/night · ${s.is_blocked ? 'blocked (click to unblock)' : 'in service (click to block)'}`}
                  onClick={() => toggleBlock(s)} disabled={false}>
                  {s.name}<small>{s.is_blocked ? 'blocked' : money(s.nightly_rate)}</small>
                </button>
              ))}
            </div>
          ) : <div className="hint">No stalls in this barn yet.</div>}
        </div>
      ))}

      {stallModal && (
        <AddStallsModal barn={stallModal} existing={stallModal.stalls ?? []}
          onClose={() => setStallModal(null)} onSaved={() => { setStallModal(null); load() }} />
      )}
    </AppShell>
  )
}

function AddStallsModal({ barn, existing, onClose, onSaved }) {
  const [prefix, setPrefix] = useState(barn.name.replace(/[^A-Za-z]/g, '').slice(0, 1).toUpperCase() || 'A')
  const [start, setStart] = useState(1)
  const [end, setEnd] = useState(20)
  const [rate, setRate] = useState(35)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const names = []
  for (let i = Number(start); i <= Number(end); i++) names.push(`${prefix}${i}`)
  const clash = names.filter((n) => existing.some((s) => s.name === n))

  async function save(e) {
    e.preventDefault()
    setErr('')
    if (names.length === 0) return setErr('Range is empty.')
    if (names.length > 300) return setErr('That is over 300 stalls — split into smaller ranges.')
    setBusy(true)
    const rows = names.filter((n) => !existing.some((s) => s.name === n))
      .map((n) => ({ barn_id: barn.id, name: n, nightly_rate: Number(rate) || 0 }))
    if (rows.length === 0) { setBusy(false); return setErr('All those stall names already exist in this barn.') }
    const { error } = await supabase.from('stalls').insert(rows)
    setBusy(false)
    if (error) return setErr(error.message)
    onSaved()
  }

  return (
    <div className="modal-back" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2>Add stalls to {barn.name}</h2>
        {err && <div className="error-note">{err}</div>}
        <form onSubmit={save}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <div className="field"><label>Prefix</label>
              <input value={prefix} onChange={(e) => setPrefix(e.target.value.toUpperCase())} placeholder="A" /></div>
            <div className="field"><label>From #</label>
              <input type="number" min="0" value={start} onChange={(e) => setStart(e.target.value)} /></div>
            <div className="field"><label>To #</label>
              <input type="number" min="0" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
          </div>
          <div className="field"><label>Nightly rate</label>
            <input type="number" min="0" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} /></div>
          <div className="hint" style={{ marginBottom: 12 }}>
            Will create <b>{names.length}</b> stalls: {names.slice(0, 3).join(', ')}{names.length > 3 ? `, … ${names[names.length - 1]}` : ''}.
            {clash.length > 0 && <span style={{ color: 'var(--critical)' }}> {clash.length} already exist and will be skipped.</span>}
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Adding…' : 'Add stalls'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}
