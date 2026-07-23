import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import AppShell from '../../components/AppShell'
import { todayISO, addDaysISO } from '../../lib/format'

const PRESET_COLORS = ['#2a78d6', '#1baf7a', '#eb6834', '#4a3aa7', '#e34948', '#eda100']

export default function MasterDashboard() {
  const navigate = useNavigate()
  const [portals, setPortals] = useState(null)
  const [showNew, setShowNew] = useState(false)
  const [tonight, setTonight] = useState(null)

  async function load() {
    const { data } = await supabase
      .from('portals')
      .select('id,name,slug,accent_color,logo_letter,is_active,stalls(count),portal_users(count)')
      .order('created_at')
    setPortals(data ?? [])
    const t = todayISO()
    const { count } = await supabase
      .from('reservations').select('id', { count: 'exact', head: true })
      .neq('status', 'cancelled').lte('check_in', t).gt('check_out', t)
    setTonight(count ?? 0)
  }
  useEffect(() => { load() }, [])

  const totalStalls = portals?.reduce((s, p) => s + (p.stalls?.[0]?.count ?? 0), 0) ?? 0

  return (
    <AppShell>
      <div className="page-head">
        <div><div className="crumbs">Sandoval Ranch Arena</div><h1>Portals</h1></div>
        <button className="btn btn-primary" onClick={() => setShowNew(true)}>+ New portal</button>
      </div>

      <div className="tiles">
        <div className="tile"><div className="k">Active portals</div><div className="v">{portals?.filter((p) => p.is_active).length ?? '—'}</div></div>
        <div className="tile"><div className="k">Total stalls</div><div className="v">{totalStalls}</div></div>
        <div className="tile"><div className="k">Animals on site tonight</div><div className="v">{tonight ?? '—'}</div>
          <div className="d">{totalStalls ? `${Math.round(((tonight ?? 0) / totalStalls) * 100)}% occupancy` : ''}</div></div>
      </div>

      {portals === null ? (
        <div className="page-loader">Loading…</div>
      ) : (
        <div className="portal-cards">
          {portals.map((p) => (
            <div className="card pcard" key={p.id}>
              <div className="pcard-top">
                <div className="sw" style={{ background: p.accent_color }}>{p.logo_letter ?? p.name[0]}</div>
                <div><h3>{p.name}</h3><div className="slug">/portal/{p.slug}</div></div>
                {!p.is_active && <span className="chip chip-neutral" style={{ marginLeft: 'auto' }}>Inactive</span>}
              </div>
              <div className="pcard-stats">
                <div><b>{p.stalls?.[0]?.count ?? 0}</b>stalls</div>
                <div><b>{p.portal_users?.[0]?.count ?? 0}</b>admins</div>
              </div>
              <div className="pcard-foot">
                <button className="btn btn-primary btn-sm" onClick={() => navigate(`/portal/${p.slug}`)}>Open portal →</button>
                <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/portal/${p.slug}/users`)}>Admins</button>
              </div>
            </div>
          ))}
          <button className="card pcard pcard-new" onClick={() => setShowNew(true)}>
            <div><div style={{ fontSize: 24 }}>+</div>
              <div style={{ fontWeight: 600, color: 'var(--ink-2)' }}>Create a new portal</div>
              <div style={{ fontSize: 12 }}>Name, slug, accent color, stalls</div></div>
          </button>
        </div>
      )}

      {showNew && <NewPortalModal onClose={() => setShowNew(false)} onCreated={load} />}
    </AppShell>
  )
}

function NewPortalModal({ onClose, onCreated }) {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [color, setColor] = useState(PRESET_COLORS[1])
  const [barns, setBarns] = useState([{ barn: 'Barn A', prefix: 'A', count: 20 }])
  const [availFrom, setAvailFrom] = useState(todayISO())
  const [availTo, setAvailTo] = useState(addDaysISO(todayISO(), 90))
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const autoSlug = (n) => n.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

  async function create(e) {
    e.preventDefault()
    setErr(''); setBusy(true)
    try {
      const { data: props, error: pe } = await supabase.from('properties').select('id').limit(1)
      if (pe) throw pe
      if (!props?.length) throw new Error('No property row exists yet — create one first (see migration notes).')
      const { data: portal, error } = await supabase
        .from('portals')
        .insert({ property_id: props[0].id, name, slug: slug || autoSlug(name), accent_color: color })
        .select().single()
      if (error) throw error
      const stalls = barns.flatMap(({ barn, prefix, count }) =>
        Array.from({ length: Number(count) || 0 }, (_, i) => ({
          portal_id: portal.id, name: `${prefix}${i + 1}`, barn,
          available_from: availFrom || null, available_to: availTo || null
        })))
      if (stalls.length) {
        const { error: se } = await supabase.from('stalls').insert(stalls)
        if (se) throw se
      }
      onCreated(); onClose()
    } catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }

  return (
    <div className="modal-back" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2>Create a new portal</h2>
        {err && <div className="error-note">{err}</div>}
        <form onSubmit={create}>
          <div className="field"><label>Rodeo company name</label>
            <input value={name} onChange={(e) => { setName(e.target.value); setSlug(autoSlug(e.target.value)) }} required placeholder="Buckeye Rodeo Co." /></div>
          <div className="field"><label>URL slug</label>
            <input value={slug} onChange={(e) => setSlug(autoSlug(e.target.value))} required placeholder="buckeye-rodeo" />
            <div className="hint">Portal address: /portal/{slug || '…'}</div></div>
          <div className="field"><label>Accent color</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {PRESET_COLORS.map((c) => (
                <button key={c} type="button" onClick={() => setColor(c)}
                  style={{ width: 28, height: 28, borderRadius: 8, background: c, cursor: 'pointer', border: c === color ? '2px solid var(--ink)' : '2px solid transparent' }} />
              ))}
            </div></div>
          {barns.map((b, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 8 }}>
              <div className="field"><label>Barn</label><input value={b.barn} onChange={(e) => setBarns(barns.map((x, j) => j === i ? { ...x, barn: e.target.value } : x))} /></div>
              <div className="field"><label>Prefix</label><input value={b.prefix} onChange={(e) => setBarns(barns.map((x, j) => j === i ? { ...x, prefix: e.target.value } : x))} /></div>
              <div className="field"><label>Stalls</label><input type="number" min="0" max="200" value={b.count} onChange={(e) => setBarns(barns.map((x, j) => j === i ? { ...x, count: e.target.value } : x))} /></div>
            </div>
          ))}
          <button type="button" className="linklike" onClick={() => setBarns([...barns, { barn: `Barn ${String.fromCharCode(65 + barns.length)}`, prefix: String.fromCharCode(65 + barns.length), count: 20 }])}>+ Add another barn</button>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12 }}>
            <div className="field"><label>Stalls available from</label><input type="date" value={availFrom} onChange={(e) => setAvailFrom(e.target.value)} /></div>
            <div className="field"><label>Through</label><input type="date" value={availTo} onChange={(e) => setAvailTo(e.target.value)} /></div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create portal'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}
