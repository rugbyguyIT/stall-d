import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { usePortal } from '../context/PortalContext'
import AppShell from '../components/AppShell'
import { range, todayISO, addDaysISO } from '../lib/format'

/**
 * Vet compliance report. Works in two contexts:
 *  - Master console (no portal in context): all portals, with a portal filter.
 *  - Inside a portal: scoped to that portal.
 * Lists each reservation with its vet-record status; prints and exports CSV.
 */
export default function VetReport() {
  const portalCtx = usePortal()
  const portal = portalCtx?.portal          // present only inside a portal
  const master = !portal
  const [from, setFrom] = useState(todayISO())
  const [to, setTo] = useState(addDaysISO(todayISO(), 30))
  const [allDates, setAllDates] = useState(false)
  const [rows, setRows] = useState(null)
  const [portalFilter, setPortalFilter] = useState('all')

  useEffect(() => {
    let q = supabase.from('reservations')
      .select('id,animal_name,owner_name,check_in,check_out,status,portals(name,slug),stalls(name,barns(name)),contestants(name,email,phone,vet_records(id,filename,uploaded_at))')
      .neq('status', 'cancelled')
      .order('check_in', { ascending: true })
    if (portal) q = q.eq('portal_id', portal.id)
    if (!allDates) q = q.gte('check_out', from).lte('check_in', to)
    q.then(({ data }) => setRows(data ?? []))
  }, [portal?.id, from, to, allDates])

  const portalNames = useMemo(
    () => [...new Set((rows ?? []).map((r) => r.portals?.name).filter(Boolean))].sort(),
    [rows]
  )

  const view = useMemo(() => {
    const list = (rows ?? []).map((r) => {
      const recs = (r.contestants ?? []).flatMap((c) => c.vet_records ?? [])
      return {
        animal: r.animal_name, owner: r.owner_name,
        portal: r.portals?.name ?? '', stall: r.stalls?.name ?? '',
        barn: r.stalls?.barns?.name ?? '',
        dates: range(r.check_in, r.check_out), status: r.status,
        vetCount: recs.length, compliant: recs.length > 0,
        files: recs.map((x) => x.filename).join('; ')
      }
    })
    return master && portalFilter !== 'all' ? list.filter((r) => r.portal === portalFilter) : list
  }, [rows, portalFilter, master])

  const total = view.length
  const compliant = view.filter((r) => r.compliant).length
  const missing = total - compliant

  function downloadCsv() {
    const cols = ['Animal', 'Owner', ...(master ? ['Portal'] : []), 'Barn', 'Stall', 'Dates', 'Status', 'Vet records', 'Files']
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const lines = [cols.join(',')]
    for (const r of view) {
      lines.push([r.animal, r.owner, ...(master ? [r.portal] : []), r.barn, r.stall, r.dates,
        r.status, r.compliant ? 'On file' : 'MISSING', r.files].map(esc).join(','))
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `vet-report-${todayISO()}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <AppShell>
      <div className="page-head no-print">
        <div><div className="crumbs">{portal ? `/portal/${portal.slug}` : 'Sandoval Ranch Arena'}</div><h1>Vet records report</h1></div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost" onClick={downloadCsv}>Download CSV</button>
          <button className="btn btn-primary" onClick={() => window.print()}>Print / Save PDF</button>
        </div>
      </div>

      <div className="rangebar no-print">
        <label style={{ display: 'flex', alignItems: 'center', gap: 7, margin: 0 }}>
          <input type="checkbox" checked={allDates} onChange={(e) => setAllDates(e.target.checked)} style={{ width: 15, height: 15 }} />
          All dates
        </label>
        {!allDates && <>
          <div className="field"><label>From</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="field"><label>To</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        </>}
        {master && portalNames.length > 1 && (
          <div className="field"><label>Portal</label>
            <select value={portalFilter} onChange={(e) => setPortalFilter(e.target.value)}>
              <option value="all">All portals</option>
              {portalNames.map((n) => <option key={n} value={n}>{n}</option>)}
            </select></div>
        )}
      </div>

      {/* print header */}
      <div className="print-only" style={{ marginBottom: 12 }}>
        <h2 style={{ fontSize: 18 }}>Vet records report{portal ? ` — ${portal.name}` : ''}</h2>
        <div className="hint">{allDates ? 'All dates' : range(from, to)} · generated {todayISO()}</div>
      </div>

      <div className="tiles">
        <div className="tile"><div className="k">Reservations</div><div className="v">{total}</div></div>
        <div className="tile"><div className="k">Vet records on file</div><div className="v" style={{ color: 'var(--good-text)' }}>{compliant}</div></div>
        <div className="tile"><div className="k">Missing</div><div className="v" style={{ color: missing ? 'var(--critical)' : undefined }}>{missing}</div>
          <div className="d">{total ? Math.round((compliant / total) * 100) : 0}% compliant</div></div>
      </div>

      <div className="card">
        <table>
          <thead><tr>
            <th>Animal / owner</th>{master && <th>Portal</th>}<th>Stall</th><th>Dates</th><th>Status</th><th>Vet records</th>
          </tr></thead>
          <tbody>
            {view.map((r, i) => (
              <tr key={i}>
                <td><b>{r.animal}</b><div className="hint">{r.owner}</div></td>
                {master && <td>{r.portal}</td>}
                <td>{r.stall}{r.barn ? <div className="hint">{r.barn}</div> : null}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{r.dates}</td>
                <td>{r.status.replace('_', ' ')}</td>
                <td>{r.compliant
                  ? <span className="chip chip-good">{r.vetCount} on file</span>
                  : <span className="chip chip-critical">Missing</span>}</td>
              </tr>
            ))}
            {rows === null && <tr><td colSpan={master ? 6 : 5} className="hint">Loading…</td></tr>}
            {rows?.length === 0 && <tr><td colSpan={master ? 6 : 5} className="hint">No reservations in this range.</td></tr>}
          </tbody>
        </table>
      </div>
    </AppShell>
  )
}
