import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { usePortal } from '../../context/PortalContext'
import AppShell from '../../components/AppShell'
import { day, range, stamp, bytes, initials } from '../../lib/format'

const ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp,image/heic'
const MAX_BYTES = 20 * 1024 * 1024

export default function ContestantProfile() {
  const { contestantId } = useParams()
  const [params] = useSearchParams()
  const { portal, slug, isPortalAdmin } = usePortal()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [c, setC] = useState(undefined)
  const [records, setRecords] = useState([])
  const [notes, setNotes] = useState('')
  const [err, setErr] = useState('')
  const [uploading, setUploading] = useState(false)
  const [drag, setDrag] = useState(false)
  const fileRef = useRef()

  async function load() {
    const { data, error } = await supabase
      .from('contestants')
      .select('*, reservations(id,animal_name,owner_name,check_in,check_out,status,stall_mat,shavings,stalls(name,barn))')
      .eq('id', contestantId).maybeSingle()
    if (error || !data) { setC(null); return }
    setC(data); setNotes(data.notes ?? '')
    const { data: vr } = await supabase
      .from('vet_records').select('*')
      .eq('contestant_id', contestantId).order('uploaded_at', { ascending: false })
    setRecords(vr ?? [])
  }
  useEffect(() => { load() }, [contestantId])

  async function upload(files) {
    setErr('')
    for (const file of files) {
      if (!ACCEPT.split(',').includes(file.type)) { setErr(`${file.name}: only PDF or image files are allowed.`); continue }
      if (file.size > MAX_BYTES) { setErr(`${file.name}: larger than 20 MB.`); continue }
      setUploading(true)
      try {
        const safe = file.name.replace(/[^a-zA-Z0-9.\-_]+/g, '_')
        const path = `${portal.id}/${contestantId}/${crypto.randomUUID()}-${safe}`
        const { error: se } = await supabase.storage.from('vet-records')
          .upload(path, file, { contentType: file.type, upsert: false })
        if (se) throw se
        const { error: ie } = await supabase.from('vet_records').insert({
          contestant_id: contestantId, filename: file.name, storage_path: path,
          mime_type: file.type, size_bytes: file.size, uploaded_by: user.id
        })
        if (ie) { await supabase.storage.from('vet-records').remove([path]); throw ie }
      } catch (ex) { setErr(`${file.name}: ${ex.message}`) }
      finally { setUploading(false) }
    }
    load()
  }

  async function open(rec, download = false) {
    const { data, error } = await supabase.storage.from('vet-records')
      .createSignedUrl(rec.storage_path, 300, download ? { download: rec.filename } : undefined)
    if (error) return setErr(error.message)
    window.open(data.signedUrl, '_blank', 'noopener')
  }

  async function removeRecord(rec) {
    if (!confirm(`Delete ${rec.filename}?`)) return
    await supabase.from('vet_records').delete().eq('id', rec.id)
    await supabase.storage.from('vet-records').remove([rec.storage_path])
    load()
  }

  async function saveNotes() {
    const { error } = await supabase.from('contestants').update({ notes }).eq('id', contestantId)
    if (error) setErr(error.message)
  }

  if (c === undefined) return <AppShell><div className="page-loader">Loading…</div></AppShell>
  if (c === null) return <AppShell><div className="page-loader">Contestant not found or not accessible.</div></AppShell>

  const r = c.reservations

  return (
    <AppShell>
      {params.get('new') && (
        <div className="ok-note">Reservation confirmed. Upload a vet record below to finish check-in requirements.</div>
      )}
      <div className="page-head">
        <div>
          <div className="crumbs">Contestants → {c.name}</div>
          <div className="prof-head">
            <span className="avatar">{initials(c.name)}</span>
            <div>
              <h1>{c.name}</h1>
              <div className="hint">
                Animal: <b style={{ color: 'var(--ink)' }}>{r?.animal_name}</b>
                {r?.stalls ? <> · Stall {r.stalls.name}{r.stalls.barn ? ` (${r.stalls.barn})` : ''}</> : null}
                {r ? <> · {range(r.check_in, r.check_out)}</> : null}
              </div>
            </div>
          </div>
        </div>
        {r && (
          <button className="btn btn-ghost" onClick={() => navigate(`/portal/${slug}/reserve/${r.id}`)}>
            {isPortalAdmin ? 'Edit reservation' : 'View reservation'}
          </button>
        )}
      </div>

      {err && <div className="error-note">{err}</div>}

      <div className="tiles">
        {r && <div className="tile"><div className="k">Stall</div>
          <div className="v" style={{ fontSize: 20 }}>{r.stalls?.name ?? '—'}{r.stalls?.barn ? ` · ${r.stalls.barn}` : ''}</div>
          <div className="d">{[r.stall_mat && 'Mat ✓', r.shavings && 'Shavings ✓'].filter(Boolean).join(' · ') || 'No add-ons'}</div></div>}
        {r && <div className="tile"><div className="k">Stay</div>
          <div className="v" style={{ fontSize: 20 }}>{day(r.check_in)} → {day(r.check_out)}</div>
          <div className="d">{r.status.replace('_', ' ')}</div></div>}
        <div className="tile"><div className="k">Vet records</div>
          <div className="v" style={{ fontSize: 20, color: records.length ? 'var(--good-text)' : 'var(--critical)' }}>
            {records.length ? `${records.length} on file ✓` : 'None on file'}
          </div></div>
      </div>

      <div className="two-col">
        <div className="card">
          <div style={{ padding: '14px 14px 6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <b style={{ fontSize: 14 }}>Vet records</b>
            {records.length
              ? <span className="chip chip-good">Compliant</span>
              : <span className="chip chip-critical">Required</span>}
          </div>
          {records.map((rec) => (
            <div className="vet-row" key={rec.id}>
              <div className={'file-ic ' + (rec.mime_type === 'application/pdf' ? 'pdf' : 'img')}>
                {rec.mime_type === 'application/pdf' ? 'PDF' : 'IMG'}
              </div>
              <div className="meta">
                <div className="fn">{rec.filename}</div>
                <div className="ts">Uploaded {stamp(rec.uploaded_at)} · {bytes(rec.size_bytes)}</div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => open(rec)}>View</button>
              <button className="btn btn-ghost btn-sm" onClick={() => open(rec, true)}>Download</button>
              {isPortalAdmin && <button className="btn btn-danger-ghost btn-sm" onClick={() => removeRecord(rec)}>Delete</button>}
            </div>
          ))}
          <div style={{ padding: 14 }}>
            <button
              type="button"
              className={'dropzone' + (drag ? ' drag' : '')}
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); setDrag(false); upload([...e.dataTransfer.files]) }}
            >
              <div className="big">{uploading ? 'Uploading…' : 'Drop a vet record here, or click to browse'}</div>
              PDF, JPG or PNG · max 20 MB · stored privately, visible to portal staff only
            </button>
            <input ref={fileRef} type="file" accept={ACCEPT} multiple hidden
              onChange={(e) => { upload([...e.target.files]); e.target.value = '' }} />
          </div>
        </div>

        <div className="card" style={{ padding: 18 }}>
          <b style={{ fontSize: 14, display: 'block', marginBottom: 12 }}>Contact &amp; notes</b>
          <div className="sumrow"><span>Email</span><b>{c.email || '—'}</b></div>
          <div className="sumrow"><span>Phone</span><b>{c.phone || '—'}</b></div>
          <div className="field" style={{ marginTop: 14 }}>
            <label>Staff notes</label>
            <textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Feed instructions, arrival notes…" />
          </div>
          <button className="btn btn-ghost btn-sm" onClick={saveNotes}>Save note</button>
        </div>
      </div>
    </AppShell>
  )
}
