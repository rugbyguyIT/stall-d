import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { logoUrl, fetchFacility } from '../lib/themes'

export default function Login() {
  const { signIn, signUp, user, isMaster, portalIds } = useAuth()
  const navigate = useNavigate()
  const loc = useLocation()
  const [portals, setPortals] = useState(null)
  const [facility, setFacility] = useState(null)
  // auth panel: null | { mode:'master' } | { mode:'portal', portal }
  const [panel, setPanel] = useState(null)

  useEffect(() => {
    supabase.from('portals').select('id,name,slug,accent_color,logo_letter,logo_path')
      .eq('is_active', true).is('archived_at', null).order('name')
      .then(({ data }) => setPortals(data ?? []))
    fetchFacility(supabase).then(setFacility)
  }, [])

  // Only auto-route when the user was bounced here from a protected page.
  useEffect(() => {
    if (user && loc.state?.from) navigate(loc.state.from, { replace: true })
  }, [user, loc.state])

  const facilityLogo = facility?.logo_path ? logoUrl(supabase, facility.logo_path) : null
  const facilityName = facility?.name ?? 'Sandoval Ranch Arena'

  // Clicking a rodeo: signed-in users go straight in; otherwise sign in scoped to it.
  function enterPortal(p) {
    if (user) navigate(`/portal/${p.slug}`)
    else setPanel({ mode: 'portal', portal: p })
  }

  return (
    <div className="lg" data-style={facility?.style || 'minimalist'}>
      <header className="lg-top">
        <div className="lg-brand" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
          {facilityLogo ? <img className="logo logo-img" src={facilityLogo} alt="" /> : <div className="logo">S</div>}
          <span className="nm">Stall'd</span>
        </div>
        <nav className="lg-nav">
          {user && isMaster ? (
            <button className="btn btn-primary" onClick={() => navigate('/master')}>Master console →</button>
          ) : user ? (
            <button className="btn btn-ghost lg-navbtn" onClick={() => supabase.auth.signOut()}>Sign out</button>
          ) : (
            <button className="btn btn-primary lg-navbtn" onClick={() => setPanel({ mode: 'master' })}>Login</button>
          )}
        </nav>
      </header>

      <section className="lg-hero">
        <div className="lg-hero-inner">
          <div className="lg-kicker">{facilityName}</div>
          <h1 className="lg-title">Stall'd</h1>
          <p className="lg-tag">Book barns, stalls &amp; shavings for every rodeo on the grounds — one place, every event.</p>
        </div>
      </section>

      <main className="lg-body">
        <div className="lg-body-head">
          <h2>Choose your rodeo</h2>
          <p>Select the company you're checking in with to view its events and reserve a stall.</p>
        </div>

        {portals === null && <div className="page-loader" style={{ minHeight: 120 }}>Loading rodeos…</div>}

        {portals?.length === 0 && (
          <div className="lg-empty">
            <b>No rodeos are open yet.</b>
            <p>If you run the grounds, sign in to the master console to create a portal for a rodeo company.</p>
            <button className="btn btn-primary" onClick={() => setPanel({ mode: 'master' })}>Master console login</button>
          </div>
        )}

        {portals && portals.length > 0 && (
          <div className="rodeo-grid">
            {portals.map((p) => (
              <button key={p.id} className="rodeo-card" onClick={() => enterPortal(p)}>
                <span className="rc-logo" style={{ background: p.logo_path ? 'transparent' : p.accent_color }}>
                  {p.logo_path ? <img src={logoUrl(supabase, p.logo_path)} alt="" /> : (p.logo_letter ?? p.name[0])}
                </span>
                <span className="rc-meta">
                  <span className="rc-name">{p.name}</span>
                  <span className="rc-slug">/portal/{p.slug}</span>
                </span>
                <span className="rc-go" style={{ color: p.accent_color }}>Enter →</span>
              </button>
            ))}
          </div>
        )}

        <div className="lg-foot">
          Managing the grounds?{' '}
          <button className="linklike" onClick={() => setPanel({ mode: 'master' })}>Log in to the master console</button>
        </div>
      </main>

      {panel && (
        <AuthModal
          panel={panel}
          facilityLogo={facilityLogo}
          onClose={() => setPanel(null)}
          onSignedIn={() => {
            if (panel.mode === 'portal') navigate(`/portal/${panel.portal.slug}`)
            else navigate('/')
          }}
          signIn={signIn}
          signUp={signUp}
        />
      )}
    </div>
  )
}

function AuthModal({ panel, facilityLogo, onClose, onSignedIn, signIn, signUp }) {
  const isPortal = panel.mode === 'portal'
  const [mode, setMode] = useState('signin') // signin | signup
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setErr(''); setNote(''); setBusy(true)
    const { error } = mode === 'signin'
      ? await signIn(email, password)
      : await signUp(email, password, fullName)
    setBusy(false)
    if (error) return setErr(error.message)
    if (mode === 'signup') return setNote('Account created. If email confirmation is required, confirm then sign in.')
    onSignedIn()
  }

  return (
    <div className="modal-back" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal auth-modal">
        <div className="auth-head">
          {isPortal
            ? <span className="auth-mark" style={{ background: panel.portal.logo_path ? 'transparent' : panel.portal.accent_color }}>
                {panel.portal.logo_path
                  ? <img src={logoUrl(supabase, panel.portal.logo_path)} alt="" />
                  : (panel.portal.logo_letter ?? panel.portal.name[0])}
              </span>
            : (facilityLogo ? <img className="auth-mark logo-img" src={facilityLogo} alt="" /> : <span className="auth-mark">S</span>)}
          <div>
            <h2>{isPortal ? panel.portal.name : 'Master console'}</h2>
            <div className="hint">{isPortal ? 'Sign in to manage or reserve at this rodeo' : 'Sign in to manage the grounds and every rodeo'}</div>
          </div>
        </div>

        {err && <div className="error-note">{err}</div>}
        {note && <div className="ok-note">{note}</div>}

        <form onSubmit={submit}>
          {mode === 'signup' && (
            <div className="field"><label>Full name</label>
              <input value={fullName} onChange={(e) => setFullName(e.target.value)} required placeholder="Your name" autoFocus /></div>
          )}
          <div className="field"><label>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@example.com" autoFocus={mode === 'signin'} /></div>
          <div className="field"><label>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} /></div>
          <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={busy}>
            {busy ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        {isPortal && (
          <div className="hint" style={{ textAlign: 'center', marginTop: 10 }}>
            {mode === 'signin'
              ? <>New contestant? <button className="linklike" onClick={() => setMode('signup')}>Create an account</button></>
              : <>Have an account? <button className="linklike" onClick={() => setMode('signin')}>Sign in</button></>}
          </div>
        )}
        <button className="linklike auth-cancel" onClick={onClose}>Cancel</button>
      </div>
    </div>
  )
}
