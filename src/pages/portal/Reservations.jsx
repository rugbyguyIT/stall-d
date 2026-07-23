import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { usePortal } from '../../context/PortalContext'
import AppShell from '../../components/AppShell'
import { range } from '../../lib/format'

const STATUS_CHIP = {
  confirmed: <span className="chip chip-accent">Confirmed</span>,
  checked_in: <span className="chip chip-good">Checked in</span>,
  cancelled: <span className="chip chip-neutral">Cancelled</span>
}

export default function Reservations() {
  const { portal, slug, isPortalAdmin } = usePortal()
  const navigate = useNavigate()
  const [rows, setRows] = useState(null)
  const [q, setQ] = useState('')
  const [showCancelled, setShowCancelled] = useState(false)

  useEffect(() => {
    if (!portal?.id) return
    let query = supabase
      .from('reservations')
      .select('id,animal_name,owner_name,check_in,check_out,status,stalls(name,barns(name)),contestants(id,vet_records(id)),reservation_addons(add_ons(name))')
      .eq('portal_id', portal.id)
      .order('check_in', { ascending: true })
    if (!showCancelled) query = query.neq('status', 'cancelled')
    query.then(({ data }) => setRows(data ?? []))
  }, [portal?.id, showCancelled])

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return rows ?? []
    return (rows ?? []).filter((r) =>
      r.animal_name.toLowerCase().includes(t) ||
      r.owner_name.toLowerCase().includes(t) ||
      (r.stalls?.name ?? '').toLowerCase().includes(t))
  }, [rows, q])

  return (
    <AppShell>
      <div className="page-head">
        <div><div className="crumbs">/portal/{slug}</div><h1>Reservations</h1></div>
        <button className="btn btn-primary" onClick={() => navigate(`/portal/${slug}/reserve`)}>+ New reservation</button>
      </div>
      <div className="rangebar">
        <input placeholder="Search animal, owner, or stall…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 260 }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 7, margin: 0 }}>
          <input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} style={{ width: 15, height: 15 }} />
          Show cancelled
        </label>
      </div>
      <div className="card">
        <table>
          <thead><tr><th>Animal / owner</th><th>Stall</th><th>Dates</th><th>Add-ons</th><th>Vet</th><th>Status</th></tr></thead>
          <tbody>
            {(filtered ?? []).map((r) => (
              <tr key={r.id} className="rowlink"
                onClick={() => r.contestants?.[0]
                  ? navigate(`/portal/${slug}/contestants/${r.contestants[0].id}`)
                  : navigate(`/portal/${slug}/reserve/${r.id}`)}>
                <td><b>{r.animal_name}</b><div className="hint">{r.owner_name}</div></td>
                <td>{r.stalls?.name}{r.stalls?.barns?.name ? <div className="hint">{r.stalls.barns.name}</div> : null}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{range(r.check_in, r.check_out)}</td>
                <td className="hint">{(r.reservation_addons ?? []).map((x) => x.add_ons?.name).filter(Boolean).join(' · ') || '—'}</td>
                <td>{(r.contestants ?? []).some((c) => c.vet_records?.length)
                  ? <span className="chip chip-good">✓</span>
                  : <span className="chip chip-critical">Missing</span>}</td>
                <td>{STATUS_CHIP[r.status]}</td>
              </tr>
            ))}
            {rows === null && <tr><td colSpan={6} className="hint">Loading…</td></tr>}
            {rows?.length === 0 && <tr><td colSpan={6} className="hint">
              {isPortalAdmin ? 'No reservations yet.' : 'You have no reservations in this portal yet.'}</td></tr>}
          </tbody>
        </table>
      </div>
    </AppShell>
  )
}
