import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import AppShell from '../../components/AppShell'
import { COLOR_SCHEMES, THEME_STYLES, logoUrl, fetchFacility } from '../../lib/themes'
import { todayISO } from '../../lib/format'

export default function MasterDashboard() {
  const navigate = useNavigate()
  const [portals, setPortals] = useState(null)
  const [showNew, setShowNew] = useState(false)
  const [editPortal, setEditPortal] = useState(null)
  const [showFacility, setShowFacility] = useState(false)
  const [menuFor, setMenuFor] = useState(null)
  const [showArchived, setShowArchived] = useState(false)
  const [tonight, setTonight] = useState(null)
  const [stallTotal, setStallTotal] = useState(null)

  async function load() {
    const { data } = await supabase
      .from('portals')
      .select('id,name,slug,accent_color,logo_letter,logo_path,theme,style,is_active,archived_at,portal_users(count),stall_allocations(count)')
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

  async function setActive(p, val) {
    await supabase.from('portals').update({ is_active: val }).eq('id', p.id); setMenuFor(null); load()
  }
  async function archive(p) {
    if (!confirm(`Archive ${p.name}? It moves out of your active portals list (data is kept, and you can restore it anytime).`)) return
    await supabase.from('portals').update({ archived_at: new Date().toISOString(), is_active: false }).eq('id', p.id)
    setMenuFor(null); load()
  }
  async function unarchive(p) {
    await supabase.from('portals').update({ archived_at: null, is_active: true }).eq('id', p.id); load()
  }

  const active = (portals ?? []).filter((p) => !p.archived_at)
  const archived = (portals ?? []).filter((p) => p.archived_at)

  return (
    <AppShell>
      <div className="page-head" onClick={() => menuFor && setMenuFor(null)}>
        <div><div className="crumbs">Sandoval Ranch Arena</div><h1>Portals</h1></div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost" onClick={() => setShowFacility(true)}>Facility settings</button>
          <button className="btn btn-ghost" onClick={() => navigate('/master/barns')}>Barns &amp; stalls</button>
          <button className="btn btn-primary" onClick={() => setShowNew(true)}>+ New portal</button>
        </div>
      </div>

      <div className="tiles">
        <div className="tile"><div className="k">Active portals</div><div className="v">{active.filter((p) => p.is_active).length}</div></div>
        <div className="tile"><div className="k">Physical stalls</div><div className="v">{stallTotal ?? '—'}</div>
          <div className="d"><a onClick={() => navigate('/master/barns')} style={{ cursor: 'pointer' }}>manage barns →</a></div></div>
        <div className="tile"><div className="k">Animals on site tonight</div><div className="v">{tonight ?? '—'}</div></div>
      </div>

      {portals === null ? (
        <div className="page-loader">Loading…</div>
      ) : (
        <div className="portal-cards">
          {active.map((p) => (
            <div className="card pcard" key={p.id}>
              <div className="pcard-top">
                {p.logo_path
                  ? <img className="sw sw-img" style={{ width: 38, height: 38, borderRadius: 9 }} src={logoUrl(supabase, p.logo_path)} alt="" />
                  : <div className="sw" style={{ background: p.accent_color }}>{p.logo_letter ?? p.name[0]}</div>}
                <div><h3>{p.name}</h3><div className="slug">/portal/{p.slug}</div></div>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
                  {!p.is_active && <span className="chip chip-neutral">Disabled</span>}
                  <div style={{ position: 'relative' }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => setMenuFor(menuFor === p.id ? null : p.id)} aria-label="More">⋯</button>
                    {menuFor === p.id && (
                      <span className="card" style={{ position: 'absolute', right: 0, top: 'calc(100% + 4px)', zIndex: 30, padding: 6, width: 190, display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => setActive(p, !p.is_active)}>
                          {p.is_active ? 'Disable (hide from login)' : 'Enable'}
                        </button>
                        <button className="btn btn-danger-ghost btn-sm" onClick={() => archive(p)}>Archive</button>
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="pcard-stats">
                <div><b>{p.stall_allocations?.[0]?.count ?? 0}</b>stall assignments</div>
                <div><b>{p.portal_users?.[0]?.count ?? 0}</b>admins</div>
              </div>
              <div className="pcard-foot">
                <button className="btn btn-primary btn-sm" onClick={() => navigate(`/portal/${p.slug}`)}>Open →</button>
                <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/master/portals/${p.id}/events`)}>Events</button>
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

      {archived.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <button className="linklike" style={{ fontSize: 13 }} onClick={() => setShowArchived(!showArchived)}>
            {showArchived ? '▾' : '▸'} Archived portals ({archived.length})
          </button>
          {showArchived && (
            <div className="card" style={{ marginTop: 10 }}>
              <table>
                <tbody>
                  {archived.map((p) => (
                    <tr key={p.id}>
                      <td><b>{p.name}</b><div className="hint">/portal/{p.slug}</div></td>
                      <td style={{ textAlign: 'right' }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => unarchive(p)}>Restore</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {showNew && <PortalModal onClose={() => setShowNew(false)} onSaved={load} />}
      {editPortal && <PortalModal portal={editPortal} onClose={() => setEditPortal(null)} onSaved={load} />}
      {showFacility && <FacilityModal onClose={() => setShowFacility(false)} />}
    </AppShell>
  )
}

/** Master console + login branding: facility name, logo, and theme style. */
function FacilityModal({ onClose }) {
  const [facility, setFacility] = useState(null)
  const [name, setName] = useState('')
  const [style, setStyle] = useState('minimalist')
  const [logoPath, setLogoPath] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef()

  useEffect(() => {
    fetchFacility(supabase).then((f) => {
      setFacility(f); setName(f.name ?? ''); setStyle(f.style ?? 'minimalist'); setLogoPath(f.logo_path ?? null)
    })
  }, [])

  async function uploadLogo(file) {
    setErr('')
    if (!file || !facility?.id) return
    if (file.size > 2 * 1024 * 1024) return setErr('Logo must be under 2 MB.')
    setBusy(true)
    try {
      const ext = file.name.split('.').pop().toLowerCase()
      const path = `facility/${crypto.randomUUID()}.${ext}`
      const { error: ue } = await supabase.storage.from('portal-logos')
        .upload(path, file, { contentType: file.type, upsert: true })
      if (ue) throw ue
      await supabase.from('properties').update({ logo_path: path }).eq('id', facility.id)
      setLogoPath(path)
    } catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }

  async function save(e) {
    e.preventDefault()
    setErr(''); setBusy(true)
    const { error } = await supabase.from('properties')
      .update({ name, style, logo_path: logoPath }).eq('id', facility.id)
    setBusy(false)
    if (error) return setErr(error.message)
    onClose()
    // reload so the freshly-branded shell/login pick up changes
    window.location.reload()
  }

  if (!facility) return null

  return (
    <div className="modal-back" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2>Facility settings</h2>
        <div className="hint" style={{ marginBottom: 14 }}>Branding for the master console and the login page.</div>
        {err && <div className="error-note">{err}</div>}
        <form onSubmit={save}>
          <div className="field"><label>Facility name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Sandoval Ranch Arena" /></div>

          <div className="field"><label>Logo <span style={{ fontWeight: 400, color: 'var(--muted)' }}>(master console + login)</span></label>
            <button type="button" className="logo-drop" onClick={() => fileRef.current?.click()}>
              {logoPath
                ? <img className="prev" src={logoUrl(supabase, logoPath)} alt="" />
                : <span className="sw" style={{ width: 44, height: 44, borderRadius: 8, background: 'var(--accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800 }}>S</span>}
              <span className="hint">{busy ? 'Uploading…' : logoPath ? 'Replace logo' : 'Upload the facility logo'}</span>
            </button>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden
              onChange={(e) => { uploadLogo(e.target.files[0]); e.target.value = '' }} />
          </div>

          <div className="field"><label>Theme style</label>
            <StylePicker value={style} onChange={setStyle} /></div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save facility settings'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

/** Shared 4-option theme-style picker with mini swatches. */
function StylePicker({ value, onChange }) {
  return (
    <div className="style-grid">
      {THEME_STYLES.map((s) => (
        <button type="button" key={s.key} className={'style-opt' + (value === s.key ? ' on' : '')} onClick={() => onChange(s.key)}>
          <span className="nm">{s.name}</span>
          <span className="sw-row">{s.swatches.map((c, i) => <i key={i} style={{ background: c }} />)}</span>
        </button>
      ))}
    </div>
  )
}

/** Create OR edit a portal: name/slug (create only), color scheme, logo, active. */
function PortalModal({ portal, onClose, onSaved }) {
  const editing = Boolean(portal)
  const [name, setName] = useState(portal?.name ?? '')
  const [slug, setSlug] = useState(portal?.slug ?? '')
  const [accent, setAccent] = useState(portal?.accent_color ?? COLOR_SCHEMES[0].accent)
  const [theme, setTheme] = useState(portal?.theme ?? COLOR_SCHEMES[0].name)
  const [style, setStyle] = useState(portal?.style ?? 'minimalist')
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
      .insert({ property_id: props[0].id, name, slug: slug || autoSlug(name), accent_color: accent, theme, style })
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
          .update({ accent_color: accent, theme, style, is_active: isActive, logo_path: logoPath })
          .eq('id', portal.id)
        if (error) throw error
      } else {
        const pid = await ensurePortal()
        if (!pid) { setBusy(false); return }
        // apply scheme/logo/active in case ensurePortal ran before edits
        await supabase.from('portals')
          .update({ accent_color: accent, theme, style, is_active: isActive, logo_path: logoPath }).eq('id', pid)
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

          <div className="field"><label>Theme style</label>
            <StylePicker value={style} onChange={setStyle} /></div>

          <div className="field"><label>Accent color</label>
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
            After creating, use <b>Events</b> on the portal card to add this company's shows and assign each event its barns or blocks of stalls.</div>}
        </form>
      </div>
    </div>
  )
}
