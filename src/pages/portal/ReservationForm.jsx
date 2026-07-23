import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { usePortal } from '../../context/PortalContext'
import AppShell from '../../components/AppShell'
import { todayISO, addDaysISO, range, nights, money, day } from '../../lib/format'

const MAT_PRICE = 15
const SHAVINGS_PRICE = 18

export default function ReservationForm() {
  const { portal, slug, isPortalAdmin } = usePortal()
  const { user } = useAuth()
  const { reservationId } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const editing = Boolean(reservationId)

  const [from, setFrom] = useState(params.get('from') || todayISO())
  const [to, setTo] = useState(params.get('to') || addDaysISO(params.get('from') || todayISO(), 2))
  const [stallId, setStallId] = useState(params.get('stall') || '')
  const [board, setBoard] = useState([])
  const [animalName, setAnimalName] = useState('')
  const [ownerName, setOwnerName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [mat, setMat] = useState(false)
  const [shavings, setShavings] = useState(false)
  const [status, setStatus] = useState('confirmed')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(!editing)

  // Load existing reservation when editing.
  useEffect(() => {
    if (!editing || !portal?.id) return
    supabase.from('reservations')
      .select('*, contestants(id,name,email,phone)')
      .eq('id', reservationId).single()
      .then(({ data, error }) => {
        if (error || !data) { setErr('Reservation not found or not accessible.'); setLoaded(true); return }
        setFrom(data.check_in); setTo(data.check_out); setStallId(data.stall_id)
        setAnimalName(data.animal_name); setOwnerName(data.owner_name)
        setMat(data.stall_mat); setShavings(data.shavings); setStatus(data.status)
        const c = data.contestants?.[0]
        if (c) { setEmail(c.email ?? ''); setPhone(c.phone ?? '') }
        setLoaded(true)
      })
  }, [editing, reservationId, portal?.id])

  // Availability for the chosen range.
  useEffect(() => {
    if (!portal?.id || !from || !to || from >= to) return
    supabase.rpc('stall_board', { p_portal_id: portal.id, p_from: from, p_to: to })
      .then(({ data }) => setBoard(data ?? []))
  }, [portal?.id, from, to])

  const options = useMemo(() => {
    const avail = board.filter((s) => s.state === 'available' || s.stall_id === stallId)
    return avail.sort((a, b) => (a.barn ?? '').localeCompare(b.barn ?? '') || a.name.localeCompare(b.name))
  }, [board, stallId])

  const chosen = board.find((s) => s.stall_id === stallId)
  const rate = Number(chosen?.nightly_rate ?? 35)
  const n = from < to ? nights(from, to) : 0
  const total = n * rate + (mat ? MAT_PRICE : 0) + (shavings ? SHAVINGS_PRICE : 0)

  async function submit(e) {
    e.preventDefault()
    setErr(''); setBusy(true)
    try {
      if (!stallId) throw new Error('Pick a stall.')
      const row = {
        portal_id: portal.id, stall_id: stallId,
        animal_name: animalName, owner_name: ownerName,
        check_in: from, check_out: to, stall_mat: mat, shavings, status
      }
      let resId = reservationId
      if (editing) {
        const { error } = await supabase.from('reservations').update(row).eq('id', reservationId)
        if (error) throw friendly(error)
        const { data: existing } = await supabase.from('contestants').select('id').eq('reservation_id', reservationId).limit(1)
        if (existing?.length) {
          await supabase.from('contestants').update({ name: ownerName, email: email || null, phone: phone || null }).eq('id', existing[0].id)
        }
      } else {
        const { data, error } = await supabase.from('reservations')
          .insert({ ...row, created_by: user.id }).select('id').single()
        if (error) throw friendly(error)
        resId = data.id
        const { data: c, error: ce } = await supabase.from('contestants')
          .insert({ reservation_id: resId, name: ownerName, email: email || null, phone: phone || null, user_id: isPortalAdmin ? null : user.id })
          .select('id').single()
        if (ce) throw ce
        navigate(`/portal/${slug}/contestants/${c.id}?new=1`)
        return
      }
      navigate(`/portal/${slug}`)
    } catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }

  async function cancelReservation() {
    if (!confirm('Cancel this reservation? The stall becomes available again.')) return
    setBusy(true)
    const { error } = await supabase.from('reservations').update({ status: 'cancelled' }).eq('id', reservationId)
    setBusy(false)
    if (error) return setErr(error.message)
    navigate(`/portal/${slug}`)
  }

  if (!loaded) return <AppShell><div className="page-loader">Loading…</div></AppShell>

  return (
    <AppShell>
      <div className="page-head">
        <div><div className="crumbs">Stall board → {editing ? 'Edit reservation' : 'New reservation'}</div>
          <h1>{editing ? `Reservation · ${animalName || '…'}` : 'Reserve a stall'}</h1></div>
        <div style={{ display: 'flex', gap: 8 }}>
          {editing && isPortalAdmin && status !== 'cancelled' && (
            <button className="btn btn-danger-ghost" onClick={cancelReservation} disabled={busy}>Cancel reservation</button>
          )}
          <button className="btn btn-ghost" onClick={() => navigate(`/portal/${slug}`)}>Back</button>
        </div>
      </div>

      {err && <div className="error-note">{err}</div>}

      <form onSubmit={submit}>
        <div className="two-col">
          <div className="form-col">
            <div className="card" style={{ padding: 20, marginBottom: 14 }}>
              <b style={{ display: 'block', marginBottom: 14 }}>Dates &amp; stall</b>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="field"><label>Check-in</label>
                  <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} required /></div>
                <div className="field"><label>Check-out</label>
                  <input type="date" value={to} min={addDaysISO(from, 1)} onChange={(e) => setTo(e.target.value)} required /></div>
              </div>
              <div className="field"><label>Stall</label>
                <select value={stallId} onChange={(e) => setStallId(e.target.value)} required>
                  <option value="">Select a stall…</option>
                  {options.map((s) => (
                    <option key={s.stall_id} value={s.stall_id}>
                      {s.name}{s.barn ? ` — ${s.barn}` : ''}{s.stall_id === stallId && s.state !== 'available' ? ' (current)' : ''}
                    </option>
                  ))}
                </select>
                <div className="hint">Only stalls available for the full {n || '…'}-night range are listed.</div></div>
              {editing && isPortalAdmin && (
                <div className="field"><label>Status</label>
                  <select value={status} onChange={(e) => setStatus(e.target.value)}>
                    <option value="confirmed">Confirmed</option>
                    <option value="checked_in">Checked in</option>
                    <option value="cancelled">Cancelled</option>
                  </select></div>
              )}
            </div>

            <div className="card" style={{ padding: 20, marginBottom: 14 }}>
              <b style={{ display: 'block', marginBottom: 14 }}>Animal &amp; owner</b>
              <div className="field"><label>Animal name</label>
                <input value={animalName} onChange={(e) => setAnimalName(e.target.value)} required placeholder="e.g. Whiskey River" /></div>
              <div className="field"><label>Owner name</label>
                <input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} required placeholder="Full name" /></div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="field"><label>Owner email <span style={{ fontWeight: 400, color: 'var(--muted)' }}>(optional)</span></label>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
                <div className="field"><label>Phone <span style={{ fontWeight: 400, color: 'var(--muted)' }}>(optional)</span></label>
                  <input value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
              </div>
            </div>

            <div className="card" style={{ padding: 20 }}>
              <b style={{ display: 'block', marginBottom: 4 }}>Add-ons</b>
              <div className="hint" style={{ marginBottom: 14 }}>Added to the stall for the full stay.</div>
              <label className={'addon' + (mat ? ' on' : '')}>
                <input type="checkbox" checked={mat} onChange={(e) => setMat(e.target.checked)} />
                <div><b>Stall mat</b><p>4′×6′ rubber mat installed before check-in.</p></div>
                <span className="price">{money(MAT_PRICE)}</span>
              </label>
              <label className={'addon' + (shavings ? ' on' : '')}>
                <input type="checkbox" checked={shavings} onChange={(e) => setShavings(e.target.checked)} />
                <div><b>Shavings</b><p>Two bags of pine shavings, restocked on request.</p></div>
                <span className="price">{money(SHAVINGS_PRICE)}</span>
              </label>
            </div>
          </div>

          <div className="summary">
            <div className="card">
              <h3>Reservation summary</h3>
              <div className="sumrow"><span>Stall</span><b>{chosen ? `${chosen.name}${chosen.barn ? ` · ${chosen.barn}` : ''}` : '—'}</b></div>
              <div className="sumrow"><span>Dates</span><b>{day(from)} → {day(to)} · {n} night{n === 1 ? '' : 's'}</b></div>
              <div className="sumrow"><span>Stall ({n} × {money(rate)})</span><b>{money(n * rate)}</b></div>
              <div className="sumrow" style={mat ? {} : { color: 'var(--muted)' }}>
                <span>Stall mat</span>{mat ? <b>{money(MAT_PRICE)}</b> : <span>—</span>}</div>
              <div className="sumrow" style={shavings ? {} : { color: 'var(--muted)' }}>
                <span>Shavings</span>{shavings ? <b>{money(SHAVINGS_PRICE)}</b> : <span>—</span>}</div>
              <div className="sumrow total"><span>Total due at check-in</span><span>{money(total)}</span></div>
              <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: 14 }} disabled={busy}>
                {busy ? 'Saving…' : editing ? 'Save changes' : 'Confirm reservation'}
              </button>
              {!editing && <div className="hint" style={{ textAlign: 'center', marginTop: 10 }}>
                You can upload vet records right after confirming.</div>}
            </div>
          </div>
        </div>
      </form>
    </AppShell>
  )
}

function friendly(error) {
  if (/exclusion constraint/.test(error.message ?? ''))
    return new Error('That stall was just booked for overlapping dates — pick another stall or adjust the dates.')
  if (/row-level security/.test(error.message ?? ''))
    return new Error("You don't have permission to do that in this portal.")
  return error
}
