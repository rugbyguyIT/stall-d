import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

// When a master has flagged an account to change its password, block the whole
// app behind this screen until the user sets a new one. Clears the flag on save.
export default function PasswordGate({ children }) {
  const { mustChangePassword } = useAuth()
  if (!mustChangePassword) return children
  return <ForceChange />
}

function ForceChange() {
  const { user, reloadProfile, signOut } = useAuth()
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setErr('')
    if (pw.length < 8) return setErr('Use at least 8 characters.')
    if (pw !== pw2) return setErr('The two passwords don’t match.')
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password: pw })
    if (error) { setBusy(false); return setErr(error.message) }
    await supabase.from('profiles').update({ must_change_password: false }).eq('id', user.id)
    await reloadProfile()
    setBusy(false)
  }

  return (
    <div className="lg">
      <div className="lg-body" style={{ maxWidth: 440, marginTop: 40 }}>
        <div className="card" style={{ padding: 28 }}>
          <h2 style={{ marginBottom: 4 }}>Set a new password</h2>
          <div className="hint" style={{ marginBottom: 16 }}>
            Your account requires a new password before you continue.
          </div>
          {err && <div className="error-note">{err}</div>}
          <form onSubmit={submit}>
            <div className="field"><label>New password</label>
              <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} required minLength={8} autoFocus /></div>
            <div className="field"><label>Confirm new password</label>
              <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} required minLength={8} /></div>
            <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={busy}>
              {busy ? 'Saving…' : 'Save and continue'}
            </button>
          </form>
          <button className="linklike" style={{ display: 'block', margin: '14px auto 0' }}
            onClick={() => signOut()}>Sign out instead</button>
        </div>
      </div>
    </div>
  )
}
