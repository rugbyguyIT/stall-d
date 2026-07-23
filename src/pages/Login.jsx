import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { logoUrl, fetchFacility } from '../lib/themes'

export default function Login() {
  const { signIn, signUp, user, isMaster, portalIds } = useAuth()
  const navigate = useNavigate()
  const loc = useLocation()
  const [portals, setPortals] = useState([])
  const [mode, setMode] = useState('signin') // signin | signup
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [facility, setFacility] = useState(null)

  useEffect(() => {
    supabase.from('portals').select('id,name,slug,accent_color,logo_letter,logo_path')
      .eq('is_active', true).order('name')
      .then(({ data }) => setPortals(data ?? []))
    fetchFacility(supabase).then(setFacility)
  }, [])

  // Already signed in → route to the right home.
  useEffect(() => {
    if (!user || loc.state?.pickPortal) return
    if (loc.state?.from) return navigate(loc.state.from, { replace: true })
    if (isMaster) return navigate('/master', { replace: true })
    const mine = portals.find((p) => portalIds.includes(p.id))
    if (mine) navigate(`/portal/${mine.slug}`, { replace: true })
  }, [user, isMaster, portals, portalIds])

  async function submit(e) {
    e.preventDefault()
    setErr(''); setNote(''); setBusy(true)
    const { error } =
      mode === 'signin'
        ? await signIn(email, password)
        : await signUp(email, password, fullName)
    setBusy(false)
    if (error) return setErr(error.message)
    if (mode === 'signup') setNote('Account created. Check your email if confirmation is required, then sign in.')
  }

  const facilityLogo = facility?.logo_path ? logoUrl(supabase, facility.logo_path) : null

  return (
    <div className="login-wrap" data-style={facility?.style || 'minimalist'}>
      <div className="login-card">
        <div className="login-logo">
          {facilityLogo
            ? <img className="logo logo-img" src={facilityLogo} alt="" />
            : <div className="logo">S</div>}
          <div className="nm">Stall'd</div>
        </div>
        <div className="login-sub">Stall reservations · {facility?.name ?? 'Sandoval Ranch Arena'}</div>
        <div className="card">
          {err && <div className="error-note">{err}</div>}
          {note && <div className="ok-note">{note}</div>}
          <form onSubmit={submit}>
            {mode === 'signup' && (
              <div className="field"><label>Full name</label>
                <input value={fullName} onChange={(e) => setFullName(e.target.value)} required placeholder="Your name" /></div>
            )}
            <div className="field"><label>Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@example.com" /></div>
            <div className="field"><label>Password</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} /></div>
            <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={busy}>
              {busy ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Create account'}
            </button>
          </form>
          <div className="hint" style={{ textAlign: 'center', marginTop: 10 }}>
            {mode === 'signin'
              ? <>New here? <button className="linklike" onClick={() => setMode('signup')}>Create a contestant account</button></>
              : <>Have an account? <button className="linklike" onClick={() => setMode('signin')}>Sign in</button></>}
          </div>
          {portals.length > 0 && (
            <>
              <div className="divider">or go straight to your portal</div>
              <div className="portal-pick">
                {portals.map((p) => (
                  <button key={p.id} className="row" onClick={() => navigate(`/portal/${p.slug}`)}>
                    {p.logo_path
                      ? <img className="sw sw-img" src={logoUrl(supabase, p.logo_path)} alt="" />
                      : <div className="sw" style={{ background: p.accent_color }}>{p.logo_letter ?? p.name[0]}</div>}
                    <div><div className="nm">{p.name}</div><div className="sl">/portal/{p.slug}</div></div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
