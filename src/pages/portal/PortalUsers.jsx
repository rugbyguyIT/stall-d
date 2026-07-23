import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { usePortal } from '../../context/PortalContext'
import AppShell from '../../components/AppShell'
import { initials, stamp } from '../../lib/format'

export default function PortalUsers() {
  const { portal, slug, isPortalAdmin } = usePortal()
  const { session, isMaster } = useAuth()
  const [rows, setRows] = useState(null)
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    const { data } = await supabase
      .from('portal_users')
      .select('user_id,is_owner,created_at,profiles(id,email,full_name,role)')
      .eq('portal_id', portal.id)
      .order('created_at')
    setRows(data ?? [])
  }
  useEffect(() => { if (portal?.id) load() }, [portal?.id])

  async function invite(e) {
    e.preventDefault()
    setErr(''); setNote(''); setBusy(true)
    try {
      const res = await fetch('/.netlify/functions/invite-admin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ email, full_name: fullName, portal_id: portal.id })
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || `Invite failed (${res.status})`)
      setNote(`Invitation sent to ${email}.`)
      setEmail(''); setFullName('')
      load()
    } catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }

  async function remove(row) {
    if (!confirm(`Remove ${row.profiles?.email} from this portal?`)) return
    const { error } = await supabase.from('portal_users')
      .delete().eq('portal_id', portal.id).eq('user_id', row.user_id)
    if (error) setErr(error.message); else load()
  }

  if (!isPortalAdmin) {
    return <AppShell><div className="page-loader">Portal admins only.</div></AppShell>
  }

  return (
    <AppShell>
      <div className="page-head">
        <div><div className="crumbs">/portal/{slug}</div><h1>Portal admins</h1></div>
      </div>

      {err && <div className="error-note">{err}</div>}
      {note && <div className="ok-note">{note}</div>}

      <div className="card" style={{ marginBottom: 16 }}>
        <table>
          <thead><tr><th>User</th><th>Role</th><th>Added</th><th /></tr></thead>
          <tbody>
            {(rows ?? []).map((row) => (
              <tr key={row.user_id}>
                <td>
                  <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <span className="avatar">{initials(row.profiles?.full_name || row.profiles?.email)}</span>
                    <span><b>{row.profiles?.full_name || row.profiles?.email}</b>
                      <div className="hint">{row.profiles?.email}</div></span>
                  </span>
                </td>
                <td>
                  {row.profiles?.role === 'master_admin'
                    ? <span className="chip chip-neutral">Master admin</span>
                    : <span className="chip chip-accent">Portal admin{row.is_owner ? ' · owner' : ''}</span>}
                </td>
                <td className="hint">{stamp(row.created_at)}</td>
                <td style={{ textAlign: 'right' }}>
                  {row.profiles?.role === 'master_admin'
                    ? <span className="hint">Property owner</span>
                    : (!row.is_owner || isMaster)
                      ? <button className="btn btn-danger-ghost btn-sm" onClick={() => remove(row)}>Remove</button>
                      : <span className="hint">Portal owner</span>}
                </td>
              </tr>
            ))}
            {rows?.length === 0 && <tr><td colSpan={4} className="hint">No admins assigned yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ padding: 20, maxWidth: 560 }}>
        <b style={{ display: 'block', marginBottom: 4 }}>Invite an admin to this portal</b>
        <div className="hint" style={{ marginBottom: 14 }}>
          They'll get an email link to set a password. Access is limited to {portal.name} only.
        </div>
        <form onSubmit={invite}>
          <div className="field"><label>Full name</label>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Their name" /></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'end' }}>
            <div className="field" style={{ margin: 0 }}><label>Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="name@company.com" /></div>
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Send invite'}</button>
          </div>
        </form>
      </div>
    </AppShell>
  )
}
