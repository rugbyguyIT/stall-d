import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { usePortal } from '../../context/PortalContext'
import AppShell from '../../components/AppShell'
import { nights, money, day, addDaysISO } from '../../lib/format'
import { ANIMAL_FIELDS, vetFieldsFor } from '../../lib/animals'

const ANIMAL_COLS = ['breed', 'sex', 'birth_year', 'color', 'id_number']

export default function ReservationForm() {
  const { portal, slug, isPortalAdmin } = usePortal()
  const { user } = useAuth()
  const { eventId, reservationId } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const editing = Boolean(reservationId)

  const [event, setEvent] = useState(null)
  const [board, setBoard] = useState([])
  const [stallId, setStallId] = useState(params.get('stall') || '')
  const [animalName, setAnimalName] = useState('')
  const [ownerName, setOwnerName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [species, setSpecies] = useState('')
  const [animal, setAnimal] = useState({})       // breed/sex/birth_year/color/id_number
  const [vet, setVet] = useState({})             // vet_data
  const [status, setStatus] = useState('confirmed')
  const [addOns, setAddOns] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(!editing)

  useEffect(() => {
    supabase.from('events').select('*').eq('id', eventId).single().then(({ data }) => {
      setEvent(data)
      if (data?.animal_types?.length === 1) setSpecies((s) => s || data.animal_types[0])
    })
    supabase.rpc('event_stall_board', { p_event_id: eventId }).then(({ data }) => setBoard(data ?? []))
    if (portal?.id) supabase.rpc('portal_addons', { p_portal_id: portal.id }).then(({ data }) => setAddOns(data ?? []))
  }, [eventId, portal?.id])

  useEffect(() => {
    if (!editing) return
    supabase.from('reservations')
      .select('*, contestants(*), reservation_addons(add_on_id)')
      .eq('id', reservationId).single()
      .then(({ data, error }) => {
        if (error || !data) { setErr('Reservation not found.'); setLoaded(true); return }
        setStallId(data.stall_id); setAnimalName(data.animal_name); setOwnerName(data.owner_name); setStatus(data.status)
        setSelected(new Set((data.reservation_addons ?? []).map((x) => x.add_on_id)))
        const c = data.contestants?.[0]
        if (c) {
          setEmail(c.email ?? ''); setPhone(c.phone ?? ''); setSpecies(c.species ?? '')
          setAnimal({ breed: c.breed ?? '', sex: c.sex ?? '', birth_year: c.birth_year ?? '', color: c.color ?? '', id_number: c.id_number ?? '' })
          setVet(c.vet_data ?? {})
        }
        setLoaded(true)
      })
  }, [editing, reservationId])

  const options = useMemo(() => board.filter((s) => s.state === 'available' || s.stall_id === stallId), [board, stallId])
  const visibleAddOns = addOns.filter((a) => a.is_active || selected.has(a.id))
  const chosen = board.find((s) => s.stall_id === stallId)
  const rate = Number(chosen?.nightly_rate ?? 0)
  const n = event ? nights(event.start_date, addDaysISO(event.end_date, 1)) : 0
  const addOnTotal = visibleAddOns.filter((a) => selected.has(a.id)).reduce((s, a) => s + Number(a.price), 0)
  const total = n * rate + addOnTotal

  const toggle = (id) => setSelected((p) => { const s = new Set(p); s.has(id) ? s.delete(id) : s.add(id); return s })
  const vetFields = species ? vetFieldsFor(species) : []

  async function submit(e) {
    e.preventDefault()
    setErr(''); setBusy(true)
    try {
      if (!stallId) throw new Error('Pick a stall.')
      const check_in = event.start_date, check_out = addDaysISO(event.end_date, 1)
      const row = {
        portal_id: portal.id, event_id: eventId, stall_id: stallId,
        animal_name: animalName, owner_name: ownerName,
        check_in, check_out, status, stall_rate: rate
      }
      const cRow = {
        name: ownerName, email: email || null, phone: phone || null, species: species || null,
        breed: animal.breed || null, sex: animal.sex || null,
        birth_year: animal.birth_year ? Number(animal.birth_year) : null,
        color: animal.color || null, id_number: animal.id_number || null, vet_data: vet
      }
      let resId = reservationId
      if (editing) {
        const { error } = await supabase.from('reservations').update(row).eq('id', reservationId)
        if (error) throw friendly(error)
        const { data: ex } = await supabase.from('contestants').select('id').eq('reservation_id', reservationId).limit(1)
        if (ex?.length) await supabase.from('contestants').update(cRow).eq('id', ex[0].id)
      } else {
        const { data, error } = await supabase.from('reservations').insert({ ...row, created_by: user.id }).select('id').single()
        if (error) throw friendly(error)
        resId = data.id
        const { error: ce } = await supabase.from('contestants').insert({ ...cRow, reservation_id: resId, user_id: isPortalAdmin ? null : user.id })
        if (ce) throw ce
      }
      await supabase.from('reservation_addons').delete().eq('reservation_id', resId)
      const arows = visibleAddOns.filter((a) => selected.has(a.id)).map((a) => ({ reservation_id: resId, add_on_id: a.id, price_at_booking: Number(a.price) }))
      if (arows.length) await supabase.from('reservation_addons').insert(arows)

      if (editing) navigate(`/portal/${slug}/events/${eventId}`)
      else {
        const { data: c } = await supabase.from('contestants').select('id').eq('reservation_id', resId).limit(1)
        navigate(`/portal/${slug}/contestants/${c?.[0]?.id}?new=1`)
      }
    } catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }

  async function cancelReservation() {
    if (!confirm('Cancel this reservation? The stall frees up.')) return
    setBusy(true)
    const { error } = await supabase.from('reservations').update({ status: 'cancelled' }).eq('id', reservationId)
    setBusy(false)
    if (error) return setErr(error.message)
    navigate(`/portal/${slug}/events/${eventId}`)
  }

  if (!loaded || !event) return <AppShell><div className="page-loader">Loading…</div></AppShell>

  return (
    <AppShell>
      <div className="page-head">
        <div><div className="crumbs">{event.name} → {editing ? 'Edit' : 'New reservation'}</div>
          <h1>{editing ? `Reservation · ${animalName || '…'}` : 'Reserve a stall'}</h1></div>
        <div style={{ display: 'flex', gap: 8 }}>
          {editing && isPortalAdmin && status !== 'cancelled' && <button className="btn btn-danger-ghost" onClick={cancelReservation} disabled={busy}>Cancel reservation</button>}
          <button className="btn btn-ghost" onClick={() => navigate(`/portal/${slug}/events/${eventId}`)}>Back</button>
        </div>
      </div>
      {err && <div className="error-note">{err}</div>}

      <form onSubmit={submit}>
        <div className="two-col">
          <div className="form-col">
            <div className="card" style={{ padding: 20, marginBottom: 14 }}>
              <b style={{ display: 'block', marginBottom: 4 }}>Stall</b>
              <div className="hint" style={{ marginBottom: 14 }}>Dates come from the event: {day(event.start_date)} → {day(event.end_date)}.</div>
              <div className="field"><label>Stall</label>
                <select value={stallId} onChange={(e) => setStallId(e.target.value)} required>
                  <option value="">Select a stall…</option>
                  {options.map((s) => <option key={s.stall_id} value={s.stall_id}>{s.name}{s.barn ? ` — ${s.barn}` : ''}</option>)}
                </select>
                <div className="hint">Only this event's open stalls are listed.</div></div>
              {editing && isPortalAdmin && (
                <div className="field"><label>Status</label>
                  <select value={status} onChange={(e) => setStatus(e.target.value)}>
                    <option value="confirmed">Confirmed</option><option value="checked_in">Checked in</option><option value="cancelled">Cancelled</option>
                  </select></div>
              )}
            </div>

            <div className="card" style={{ padding: 20, marginBottom: 14 }}>
              <b style={{ display: 'block', marginBottom: 14 }}>Animal &amp; owner</b>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="field"><label>Animal name</label><input value={animalName} onChange={(e) => setAnimalName(e.target.value)} required /></div>
                <div className="field"><label>Species</label>
                  <select value={species} onChange={(e) => setSpecies(e.target.value)}>
                    <option value="">Select…</option>
                    {(event.animal_types?.length ? event.animal_types : ['Horses', 'Cattle', 'Sheep / Goats', 'Other livestock']).map((t) => <option key={t} value={t}>{t}</option>)}
                  </select></div>
              </div>
              <div className="field"><label>Owner name</label><input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} required /></div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="field"><label>Owner email</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
                <div className="field"><label>Phone</label><input value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {ANIMAL_FIELDS.map((f) => (
                  <div className="field" key={f.key}><label>{f.label}</label>
                    <input type={f.type} placeholder={f.placeholder || ''} value={animal[f.key] ?? ''} onChange={(e) => setAnimal({ ...animal, [f.key]: e.target.value })} /></div>
                ))}
              </div>
            </div>

            <div className="card" style={{ padding: 20, marginBottom: 14 }}>
              <b style={{ display: 'block', marginBottom: 4 }}>Vet &amp; health records</b>
              <div className="hint" style={{ marginBottom: 14 }}>{species ? `Fields for ${species}.` : 'Pick a species above to show the right fields.'} Upload the actual documents on the animal’s profile after saving.</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {vetFields.map((f) => (
                  <div className="field" key={f.key}><label>{f.label}</label>
                    {f.type === 'select'
                      ? <select value={vet[f.key] ?? ''} onChange={(e) => setVet({ ...vet, [f.key]: e.target.value })}>{f.options.map((o) => <option key={o} value={o}>{o || '—'}</option>)}</select>
                      : <input type={f.type} value={vet[f.key] ?? ''} onChange={(e) => setVet({ ...vet, [f.key]: e.target.value })} />}
                  </div>
                ))}
              </div>
            </div>

            {visibleAddOns.length > 0 && (
              <div className="card" style={{ padding: 20 }}>
                <b style={{ display: 'block', marginBottom: 14 }}>Add-ons</b>
                {visibleAddOns.map((a) => (
                  <label key={a.id} className={'addon' + (selected.has(a.id) ? ' on' : '')}>
                    <input type="checkbox" checked={selected.has(a.id)} onChange={() => toggle(a.id)} />
                    <div><b>{a.name}</b>{a.description ? <p>{a.description}</p> : null}</div>
                    <span className="price">{money(a.price)}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="summary">
            <div className="card">
              <h3>Reservation summary</h3>
              <div className="sumrow"><span>Event</span><b>{event.name}</b></div>
              <div className="sumrow"><span>Stall</span><b>{chosen ? `${chosen.name}${chosen.barn ? ` · ${chosen.barn}` : ''}` : '—'}</b></div>
              <div className="sumrow"><span>Dates</span><b>{day(event.start_date)} → {day(event.end_date)} · {n} night{n === 1 ? '' : 's'}</b></div>
              <div className="sumrow"><span>Stall ({n} × {money(rate)})</span><b>{money(n * rate)}</b></div>
              {visibleAddOns.filter((a) => selected.has(a.id)).map((a) => <div className="sumrow" key={a.id}><span>{a.name}</span><b>{money(a.price)}</b></div>)}
              <div className="sumrow total"><span>Total due at check-in</span><span>{money(total)}</span></div>
              <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: 14 }} disabled={busy}>
                {busy ? 'Saving…' : editing ? 'Save changes' : 'Confirm reservation'}
              </button>
              {!editing && <div className="hint" style={{ textAlign: 'center', marginTop: 10 }}>Upload vet documents right after confirming.</div>}
            </div>
          </div>
        </div>
      </form>
    </AppShell>
  )
}

function friendly(error) {
  const m = error.message ?? ''
  if (/exclusion constraint/.test(m)) return new Error('That stall was just taken — pick another.')
  if (/not part of this event/.test(m)) return new Error('That stall is not in this event’s pool. Ask the property admin to add it.')
  if (/row-level security/.test(m)) return new Error('You don’t have permission to do that here.')
  return error
}
