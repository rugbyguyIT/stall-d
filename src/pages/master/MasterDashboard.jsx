import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import AppShell from '../../components/AppShell'
import { COLOR_SCHEMES, logoUrl } from '../../lib/themes'
import { todayISO } from '../../lib/format'

export default function MasterDashboard() {
  const navigate = useNavigate()
  const [portals, setPortals] = useState(null)
  const [showNew, setShowNew] = useState(false)
  const [editPortal, setEditPortal] = useState(null)
  const [tonight, setTonight] = useState(null)
  const [stallTotal, setStallTotal] = useState(null)

  async function load() {
    const { data } = await supabase
      .from('portals')
      .select('id,name,slug,accent_color,logo_letter,logo_path,theme,is_active,portal_users(count),stall_allocations(count)')
      .order('created_at')
    setPortals(data ?? [])
    const t = todayISO()
    const { count } = await supabase
      .from('reservations').select('id', { count: 'exact', head: true })
      .neq('status', 'cancelled').lte('check_in', t).gt('check_out', t)
    setTonight(count ?? 0)
    const { count: sc } = await supabase.from('stalls').select('id', { count: 'exact', head: true })
    setStallTotal(sc ?? 0)
  }
  useEffect(() => { load() }, [])

  return (
    <AppShell>
      <div className="page-head">
        <div><div className="crumbs">Sandoval Ranch Arena</div><h1>Portals</h1></div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost" onClick={() => navigate('/master/barns')}>Barns &amp; stalls</button>
          <button className="btn btn-primary" onClick={() => setShowNew(true)}>+ New portal</button>
        </div>
      </div>

      <div className="tiles">
        <div className="tile"><div className="k">Active portals</div><div className="v">{portals?.filter((p) => p.is_active).length ?? '—'}</div></div>
        <div className="tile"><div className="k">Physical stalls</div><div className="v">{stallTotal ?? '—'}</div>
          <div className="d"><a onClick={() => navigate('/master/barns')} style={{ cursor: 'pointer' }}>manage barns →</a></div></div>
        <div className="tile"><div className="k">Animals on site tonight</div><div className="v">{tonight ?? '—'}</div></div>
      </div>

      {portals === null ? (
        <div className="page-loader">Loading…</div>
      ) : (
        <div className="portal-cards">
          {portals.map((p) => (
            <div className="card pcard" key={p.id}>
              <div className="pcard-top">
                {p.logo_path
                  ? <img className="sw sw-img" style={{ width: 38, height: 38, borderRadius: 9 }} src={logoUrl(supabase, p.logo_path)} alt="" />
                  : <div className="sw" style={{ background: p.accent_color }}>{p.logo_letter ?? p.name[0]}</div>}
                <div><h3>{p.name}</h3><div className="slug">/portal/{p.slug}</div></div>
                {!p.is_active && <span className="chip chip-neutral" style={{ marginLeft: 'auto' }}>Inactive</span>}
              </div>
              <div className="pcard-stats">
                <div><b>{p.stall_allocations?.[0]?.count ?? 0}</b>stall assignments</div>
                <div><b>{p.portal_users?.[0]?.count ?? 0}</b>admins</div>
              </div>
              <div className="pcard-foot">
                <button className="btn btn-primary btn-sm" onClick={() => navigate(`/portal/${p.slug}`)}>Open →</button>
                <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/master/portals/${p.id}/allocate`)}>Assign stalls</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setEditPortal(p)}>Branding</button>
                <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/portal/${p.slug}/users`)}>Admins</button>
              </div>
            </div>
          ))}
          <button className="card pcard pcard-new" onClick={() => setShowNew(true)}>
            <div><div style={{ fontSize: 24 }}>+</div>
              <div style={{ fontWeight: 600, color: 'var(--ink-2)' }}>Create a new portal</div>
              <div style={{ fontSize: 12 }}>Name, slug, color scheme, logo</div></div>
          </button>
        </div>
      )}

      {showNew && <PortalModal onClose={() => setShowNew(false)} onSaved={load} />}
      {editPortal && <PortalModal portal={editPortal} onClose={() => setEditPortal(null)} onSaved={load} />}
    </AppShell>
  )
}

/** Create OR edit a portal: name/slug (create only), color scheme, logo, active. */
function PortalModal({ portal, onClose, onSaved }) {
  const editing = Boolean(portal)
  const [name, setName] = useState(portal?.name ?? '')
  const [slug, setSlug] = useState(portal?.slug ?? '')
  const [accent, setAccent] = useState(portal?.accent_color ?? COLOR_SCHEMES[0].accent)
  const [theme, setTheme] = useState(portal?.theme ?? COLOR_SCHEMES[0].name)
  const [isActive, setIsActive] = useState(portal?.is_active ?? true)
  const [logoPath, setLogoPath] = useState(portal?.logo_path ?? null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef()

  const autoSlug = (n) => n.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

  function pickScheme(s) { setAccent(s.accent); setTheme(s.name) }

  async function uploadLogo(file) {
    setErr('')
    if (!file) return
    if (file.size > 2 * 1024 * 1024) return setErr('Logo must be under 2 MB.')
    setBusy(true)
    try {
      // Need the portal id to key the path; for a new portal, create it first.
      let pid = portal?.id
      if (!pid) {
        pid = await ensurePortal()
        if (!pid) return
      }
      const ext = file.name.split('.').pop().toLowerCase()
      const path = `${pid}/${crypto.randomUUID()}.${ext}`
      const { error: ue } = await supabase.storage.from('portal-logos')
        .upload(path, file, { contentType: file.type, upsert: true })
      if (ue) throw ue
      await supabase.from('portals').update({ logo_path: path }).eq('id', pid)
      setLogoPath(path)
    } catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }

  // Create the portal (used on first save, or lazily when a logo is added to a new one).
  const createdIdRef = useRef(portal?.id ?? null)
  async function ensurePortal() {
    if (createdIdRef.current) return createdIdRef.current
    const { data: props } = await supabase.from('properties').select('id').limit(1)
    if (!props?.length) { setErr('No property row exists yet — create one first (see migration notes).'); return null }
    const { data, error } = await supabase.from('portals')
      .insert({ property_id: props[0].id, name, slug: slug || autoSlug(name), accent_color: accent, theme })
      .select('id').single()
    if (error) { setErr(error.message); return null }
    createdIdRef.current = data.id
    return data.id
  }

  async function save(e) {
    e.preventDefault()
    setErr(''); setBusy(true)
    try {
      if (editing) {
        const { error } = await supabase.from('portals')
          .update({ accent_color: accent, theme, is_active: isActive, logo_path: logoPath })
          .eq('id', portal.id)
        if (error) throw error
      } else {
        const pid = await ensurePortal()
        if (!pid) { setBusy(false); return }
        // apply scheme/logo/active in case ensurePortal ran before edits
        await supabase.from('portals')
          .update({ accent_color: accent, theme, is_active: isActive, logo_path: logoPath }).eq('id', pid)
      }
      onSaved(); onClose()
    } catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }

  return (
    <div className="modal-back" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2>{editing ? `Branding · ${portal.name}` : 'Create a new portal'}</h2>
        {err && <div className="error-note">{err}</div>}
        <form onSubmit={save}>
          {!editing && (
            <>
              <div className="field"><label>Rodeo company name</label>
                <input value={name} onChange={(e) => { setName(e.target.value); setSlug(autoSlug(e.target.value)) }} required placeholder="Buckeye Rodeo Co." /></div>
              <div className="field"><label>URL slug</label>
                <input value={slug} onChange={(e) => setSlug(autoSlug(e.target.value))} required placeholder="buckeye-rodeo" />
                <div className="hint">Portal address: /portal/{slug || '…'}</div></div>
            </>
          )}

          <div className="field"><label>Color scheme</label>
            <div className="scheme-grid">
              {COLOR_SCHEMES.map((s) => (
                <button type="button" key={s.name} className={'scheme' + (accent === s.accent ? ' on' : '')} onClick={() => pickScheme(s)}>
                  <span className="dot" style={{ background: s.accent }} />
                  <span className="nm">{s.name}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="field"><label>Logo <span style={{ fontWeight: 400, color: 'var(--muted)' }}>(optional · PNG/SVG, under 2 MB)</span></label>
            <button type="button" className="logo-drop" onClick={() => fileRef.current?.click()}>
              {logoPath
                ? <img className="prev" src={logoUrl(supabase, logoPath)} alt="" />
                : <span className="sw" style={{ width: 44, height: 44, borderRadius: 8, background: accent, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800 }}>{(name || '?')[0]?.toUpperCase()}</span>}
              <span className="hint">{busy ? 'Uploading…' : logoPath ? 'Replace logo' : 'Upload a logo — shown on the portal, reservations, and TV display'}</span>
            </button>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden
              onChange={(e) => { uploadLogo(e.target.files[0]); e.target.value = '' }} />
          </div>

          {editing && (
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '4px 0 12px' }}>
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} style={{ width: 16, height: 16 }} />
              <span>Active (visible on the login portal switcher)</span>
            </label>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save branding' : 'Create portal'}</button>
          </div>
          {!editing && <div className="hint" style={{ marginTop: 10 }}>
            After creating, use <b>Assign stalls</b> on the portal card to give this company barns or blocks of stalls for their event dates.</div>}
        </form>
      </div>
    </div>
  )
}
