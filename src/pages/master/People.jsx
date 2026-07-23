import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import AppShell from '../../components/AppShell'

const ROLES = [
  { key: 'master_admin', label: 'Master admin' },
  { key: 'portal_admin', label: 'Portal admin' },
  { key: 'contestant', label: 'Contestant' }
]
const roleLabel = (r) => ROLES.find((x) => x.key === r)?.label ?? r

// Call the master-only serverless function (create user / reset password).
async function adminCall(body) {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  const res = await fetch('/api/admin/user', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body)
  })
  const out = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(out.error || 'Request failed')
  return out
}

export default function People() {
  const { user } = useAuth()
  const [rows, setRows] = useState(null)
  const [q, setQ] = useState('')
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [pwFor, setPwFor] = useState(null)

  async function load() {
    const { data, error } = await supabase.from('profiles')
      .select('id,email,full_name,role,must_change_password,created_at')
      .order('role').order('email')
    if (error) setErr(error.message)
    setRows(data ?? [])
  }
  useEffect(() => { load() }, [])

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return rows ?? []
    return (rows ?? []).filter((r) =>
      (r.email ?? '').toLowerCase().includes(t) || (r.full_name ?? '').toLowerCase().includes(t))
  }, [rows, q])

  async function setRole(row, role) {
    setErr(''); setNote('')
    const { error } = await supabase.from('profiles').update({ role }).eq('id', row.id)
    if (error) return setErr(error.message)
    setRows((rs) => rs.map((r) => r.id === row.id ? { ...r, role } : r))
    setNote(`${row.email} is now ${roleLabel(role)}.${row.id === user.id ? ' Sign out and back in for it to take full effect.' : ' They’ll get the new access next time they sign in.'}`)
  }

  async function toggleForce(row) {
    setErr('')
    const val = !row.must_change_password
    const { error } = await supabase.from('profiles').update({ must_change_password: val }).eq('id', row.id)
    if (error) return setErr(error.message)
    setRows((rs) => rs.map((r) => r.id === row.id ? { ...r, must_change_password: val } : r))
  }

  return (
    <AppShell>
      <div className="page-head">
        <div><div className="crumbs">Sandoval Ranch Arena</div><h1>People &amp; roles</h1></div>
        <button className="btn btn-primary" onClick={() => setShowNew(true)}>+ Add user</button>
      </div>
      <p className="hint" style={{ marginTop: -10, marginBottom: 16, maxWidth: 680 }}>
        Set what each account can do. <b>Master admin</b> = full access like you. <b>Portal admin</b> manages the
        rodeos they’re assigned to (assign them under a portal’s Admins screen). <b>Contestant</b> books stalls.
      </p>

      {err && <div className="error-note">{err}</div>}
      {note && <div className="ok-note">{note}</div>}

      <div className="rangebar">
        <input placeholder="Search name or email…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 280 }} />
      </div>

      <div className="card">
        <table>
          <thead><tr><th>User</th><th>Role</th><th>Next login</th><th style={{ textAlign: 'right' }}>Password</th></tr></thead>
          <tbody>
            {(filtered ?? []).map((r) => (
              <tr key={r.id}>
                <td><b>{r.full_name || '—'}</b><div className="hint">{r.email}{r.id === user.id ? ' · you' : ''}</div></td>
                <td>
                  <select value={r.role} onChange={(e) => setRole(r, e.target.value)} style={{ width: 'auto', minWidth: 150 }}>
                    {ROLES.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                  </select>
                </td>
                <td>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 7, margin: 0, fontSize: 12.5, fontWeight: 500, color: 'var(--ink-2)' }}>
                    <input type="checkbox" checked={!!r.must_change_password} onChange={() => toggleForce(r)} style={{ width: 15, height: 15 }} />
                    Require password change
                  </label>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => setPwFor(r)}>Reset password</button>
                </td>
              </tr>
            ))}
            {rows === null && <tr><td colSpan={4} className="hint">Loading…</td></tr>}
            {rows?.length === 0 && <tr><td colSpan={4} className="hint">No users yet.</td></tr>}
          </tbody>
        </table>
      </div>

      {showNew && <NewUserModal onClose={() => setShowNew(false)} onSaved={(msg) => { setShowNew(false); setNote(msg); load() }} onErr={setErr} />}
      {pwFor && <ResetModal row={pwFor} onClose={() => setPwFor(null)} onSaved={(msg) => { setPwFor(null); setNote(msg); load() }} />}
    </AppShell>
  )
}

function NewUserModal({ onClose, onSaved, onErr }) {
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState('portal_admin')
  const [password, setPassword] = useState(suggest())
  const [force, setForce] = useState(true)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function save(e) {
    e.preventDefault()
    setErr(''); setBusy(true)
    try {
      await adminCall({ action: 'create', email, full_name: fullName, role, password, must_change: force })
      onSaved(`Created ${email.toLowerCase()} as ${roleLabel(role)}.${force ? ' They must set a new password at first login.' : ''}`)
    } catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }

  return (
    <div className="modal-back" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2>Add a user</h2>
        <div className="hint" style={{ marginBottom: 14 }}>Creates the login and confirms the email so they can sign in right away.</div>
        {err && <div className="error-note">{err}</div>}
        <form onSubmit={save}>
          <div className="field"><label>Full name</label>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Red Ramsey" autoFocus /></div>
          <div className="field"><label>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="red@letitfly.com" /></div>
          <div className="field"><label>Role</label>
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              {ROLES.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select></div>
          <div className="field"><label>Temporary password</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPassword(suggest())}>Suggest</button>
            </div></div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '4px 0 12px' }}>
            <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} style={{ width: 16, height: 16 }} />
            <span>Require them to set their own password at first login</span>
          </label>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create user'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function ResetModal({ row, onClose, onSaved }) {
  const [password, setPassword] = useState(suggest())
  const [force, setForce] = useState(true)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function save(e) {
    e.preventDefault()
    setErr(''); setBusy(true)
    try {
      await adminCall({ action: 'set_password', user_id: row.id, password, must_change: force })
      onSaved(`Password reset for ${row.email}.${force ? ' They’ll set their own at next login.' : ''} Share the temporary password securely.`)
    } catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }

  return (
    <div className="modal-back" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2>Reset password</h2>
        <div className="hint" style={{ marginBottom: 14 }}>{row.full_name || row.email}</div>
        {err && <div className="error-note">{err}</div>}
        <form onSubmit={save}>
          <div className="field"><label>New temporary password</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoFocus />
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPassword(suggest())}>Suggest</button>
            </div></div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '4px 0 12px' }}>
            <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} style={{ width: 16, height: 16 }} />
            <span>Require a password change at next login</span>
          </label>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Resetting…' : 'Reset password'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// A readable temporary password like "Rodeo-4821-cactus".
function suggest() {
  const words = ['rodeo', 'stall', 'cactus', 'saddle', 'lasso', 'bronco', 'canyon', 'mesquite', 'ranch', 'wrangler']
  const w = () => words[Math.floor(Math.random() * words.length)]
  const cap = (s) => s[0].toUpperCase() + s.slice(1)
  return `${cap(w())}-${Math.floor(1000 + Math.random() * 9000)}-${w()}`
}
