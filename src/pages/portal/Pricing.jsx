import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { usePortal } from '../../context/PortalContext'
import AppShell from '../../components/AppShell'
import { money } from '../../lib/format'

export default function Pricing() {
  const { portal, slug, isPortalAdmin } = usePortal()
  const [markup, setMarkup] = useState('0')
  const [addons, setAddons] = useState([])       // {id,name,base_price,price}
  const [overrides, setOverrides] = useState({}) // add_on_id -> string price ('' = use base)
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    const { data: p } = await supabase.from('portals').select('stall_markup_pct').eq('id', portal.id).single()
    setMarkup(String(p?.stall_markup_pct ?? 0))
    const { data: rows } = await supabase.rpc('portal_addons', { p_portal_id: portal.id })
    setAddons(rows ?? [])
    // seed overrides only where a portal-specific price differs from base
    const { data: pap } = await supabase.from('portal_addon_prices').select('add_on_id,price').eq('portal_id', portal.id)
    const map = {}
    ;(pap ?? []).forEach((x) => { map[x.add_on_id] = String(x.price) })
    setOverrides(map)
  }
  useEffect(() => { if (portal?.id) load() }, [portal?.id])

  async function save(e) {
    e.preventDefault()
    setErr(''); setNote(''); setBusy(true)
    try {
      const { error: me } = await supabase.rpc('set_portal_stall_markup', {
        p_portal_id: portal.id, p_pct: Number(markup) || 0
      })
      if (me) throw me
      // upsert set overrides, delete cleared ones
      const toUpsert = []
      const toDelete = []
      for (const a of addons) {
        const v = overrides[a.id]
        if (v === undefined || v === '') toDelete.push(a.id)
        else toUpsert.push({ portal_id: portal.id, add_on_id: a.id, price: Number(v) || 0 })
      }
      if (toUpsert.length) {
        const { error } = await supabase.from('portal_addon_prices').upsert(toUpsert)
        if (error) throw error
      }
      if (toDelete.length) {
        await supabase.from('portal_addon_prices').delete()
          .eq('portal_id', portal.id).in('add_on_id', toDelete)
      }
      setNote('Pricing saved.')
      load()
    } catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }

  if (!isPortalAdmin) return <AppShell><div className="page-loader">Portal admins only.</div></AppShell>

  const markedRate = (base) => base * (1 + (Number(markup) || 0) / 100)

  return (
    <AppShell>
      <div className="page-head">
        <div><div className="crumbs">/portal/{slug}</div><h1>Pricing</h1></div>
      </div>
      <p className="hint" style={{ marginTop: -10, marginBottom: 18, maxWidth: 640 }}>
        The facility sets base prices. Here you add your company's markup — a percentage on stall
        rates, and your own price for each add-on. Existing reservations keep the price they were
        booked at.
      </p>

      {err && <div className="error-note">{err}</div>}
      {note && <div className="ok-note">{note}</div>}

      <form onSubmit={save} style={{ maxWidth: 640 }}>
        <div className="card" style={{ padding: 20, marginBottom: 14 }}>
          <b style={{ display: 'block', marginBottom: 12 }}>Stall markup</b>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <div className="field" style={{ margin: 0, width: 160 }}>
              <label>Markup %</label>
              <input type="number" min="0" max="1000" step="0.5" value={markup} onChange={(e) => setMarkup(e.target.value)} />
            </div>
            <div className="hint">A $50 base stall becomes <b>{money(markedRate(50))}</b> at this markup.</div>
          </div>
        </div>

        <div className="card" style={{ marginBottom: 14 }}>
          <div style={{ padding: '14px 14px 4px' }}><b style={{ fontSize: 14 }}>Add-on prices</b></div>
          <table>
            <thead><tr><th>Add-on</th><th>Base</th><th>Your price</th></tr></thead>
            <tbody>
              {addons.map((a) => (
                <tr key={a.id}>
                  <td><b>{a.name}</b>{!a.is_active ? <span className="hint"> (inactive)</span> : null}</td>
                  <td className="hint" style={{ fontVariantNumeric: 'tabular-nums' }}>{money(a.base_price)}</td>
                  <td>
                    <input type="number" min="0" step="0.01" style={{ width: 120 }}
                      placeholder={`${a.base_price} (base)`}
                      value={overrides[a.id] ?? ''}
                      onChange={(e) => setOverrides({ ...overrides, [a.id]: e.target.value })} />
                  </td>
                </tr>
              ))}
              {addons.length === 0 && <tr><td colSpan={3} className="hint">No add-ons configured by the facility yet.</td></tr>}
            </tbody>
          </table>
          <div className="hint" style={{ padding: '8px 14px' }}>Leave blank to use the base price.</div>
        </div>

        <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save pricing'}</button>
      </form>
    </AppShell>
  )
}
