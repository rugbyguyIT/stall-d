import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import AppShell from '../../components/AppShell'
import { money } from '../../lib/format'

const BLANK = { name: '', description: '', price: '' }

export default function AddOns() {
  const [propertyId, setPropertyId] = useState(null)
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  const [editing, setEditing] = useState(null) // row being edited, or 'new'
  const [form, setForm] = useState(BLANK)

  async function load() {
    const { data: props } = await supabase.from('properties').select('id').limit(1)
    const pid = props?.[0]?.id ?? null
    setPropertyId(pid)
    if (!pid) { setRows([]); return }
    const { data } = await supabase.from('add_ons')
      .select('*').eq('property_id', pid).order('sort_order')
    setRows(data ?? [])
  }
  useEffect(() => { load() }, [])

  function startNew() { setForm(BLANK); setEditing('new') }
  function startEdit(r) { setForm({ name: r.name, description: r.description ?? '', price: String(r.price) }); setEditing(r) }

  async function save(e) {
    e.preventDefault()
    setErr('')
    const payload = {
      name: form.name.trim(), description: form.description.trim() || null,
      price: Number(form.price) || 0
    }
    let error
    if (editing === 'new') {
      ({ error } = await supabase.from('add_ons').insert({
        ...payload, property_id: propertyId, sort_order: (rows?.length ?? 0) + 1
      }))
    } else {
      ({ error } = await supabase.from('add_ons').update(payload).eq('id', editing.id))
    }
    if (error) return setErr(error.message)
    setEditing(null); load()
  }

  async function toggleActive(r) {
    await supabase.from('add_ons').update({ is_active: !r.is_active }).eq('id', r.id)
    load()
  }

  return (
    <AppShell>
      <div className="page-head">
        <div><div className="crumbs">Sandoval Ranch Arena</div><h1>Add-ons</h1></div>
        <button className="btn btn-primary" onClick={startNew}>+ New add-on</button>
      </div>
      <p className="hint" style={{ marginTop: -10, marginBottom: 18, maxWidth: 640 }}>
        Extras offered on every reservation, across all companies. Prices you set here apply to new
        reservations; past reservations keep the price they were booked at. Deactivate an add-on to
        stop offering it without deleting its history.
      </p>

      {err && <div className="error-note">{err}</div>}

      <div className="card" style={{ marginBottom: 16 }}>
        <table>
          <thead><tr><th>Add-on</th><th>Price</th><th>Status</th><th /></tr></thead>
          <tbody>
            {(rows ?? []).map((r) => (
              <tr key={r.id}>
                <td><b>{r.name}</b>{r.description ? <div className="hint">{r.description}</div> : null}</td>
                <td style={{ fontVariantNumeric: 'tabular-nums' }}>{money(r.price)}</td>
                <td>{r.is_active
                  ? <span className="chip chip-good">Active</span>
                  : <span className="chip chip-neutral">Inactive</span>}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => startEdit(r)}>Edit</button>{' '}
                  <button className="btn btn-ghost btn-sm" onClick={() => toggleActive(r)}>
                    {r.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                </td>
              </tr>
            ))}
            {rows === null && <tr><td colSpan={4} className="hint">Loading…</td></tr>}
            {rows?.length === 0 && <tr><td colSpan={4} className="hint">No add-ons yet. Create one — e.g. Stall mat, Shavings, Fan hookup.</td></tr>}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="modal-back" onClick={(e) => e.target === e.currentTarget && setEditing(null)}>
          <div className="modal">
            <h2>{editing === 'new' ? 'New add-on' : `Edit ${editing.name}`}</h2>
            {err && <div className="error-note">{err}</div>}
            <form onSubmit={save}>
              <div className="field"><label>Name</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="e.g. Fan hookup" autoFocus /></div>
              <div className="field"><label>Description <span style={{ fontWeight: 400, color: 'var(--muted)' }}>(optional)</span></label>
                <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Shown under the add-on on the reservation form" /></div>
              <div className="field"><label>Price</label>
                <input type="number" min="0" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} required placeholder="0.00" /></div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
                <button className="btn btn-primary">{editing === 'new' ? 'Create add-on' : 'Save'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppShell>
  )
}
