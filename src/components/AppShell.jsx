import { useEffect, useState } from 'react'
import { NavLink, Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { usePortal } from '../context/PortalContext'
import { initials } from '../lib/format'
import { supabase } from '../lib/supabase'
import { logoUrl, fetchFacility } from '../lib/themes'

const Icon = {
  home: <svg viewBox="0 0 24 24"><path d="M3 10.5 12 3l9 7.5M5 9v11h14V9" /></svg>,
  list: <svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10" /></svg>,
  person: <svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.5" /><path d="M5 20c.9-3.6 3.7-5.4 7-5.4s6.1 1.8 7 5.4" /></svg>,
  people: <svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.4 3.4-5 6.5-5s5.7 1.6 6.5 5M17 8.5a3 3 0 1 0 .01-6M21.5 20c-.5-2.4-2-4-4.5-4.6" /></svg>,
  grid: <svg viewBox="0 0 24 24"><path d="M12 3v18M3 12h18" /></svg>,
  tag: <svg viewBox="0 0 24 24"><path d="M20 12l-8 8-9-9V3h8l9 9zM7.5 7.5h.01" /></svg>,
  doc: <svg viewBox="0 0 24 24"><path d="M6 2h9l5 5v15H6zM14 2v6h6M9 13h6M9 17h6" /></svg>
}

/** Shared sidebar+main layout. Pass portal for portal scope, or null for master. */
export default function AppShell({ children }) {
  const { profile, user, isMaster, signOut } = useAuth()
  const portalCtx = usePortal()
  const portal = portalCtx?.portal
  const navigate = useNavigate()
  const base = portal ? `/portal/${portal.slug}` : '/master'

  // Facility name/logo/style — used for master-console branding and as the
  // sub-label under each portal's name.
  const [facility, setFacility] = useState(null)
  useEffect(() => { fetchFacility(supabase).then(setFacility) }, [])

  const nav = portal
    ? [
        { to: base, icon: Icon.home, label: 'Stall board', end: true },
        { to: `${base}/reservations`, icon: Icon.list, label: 'Reservations' },
        ...(portalCtx.isPortalAdmin
          ? [{ to: `${base}/vet-report`, icon: Icon.doc, label: 'Vet report' },
             { to: `${base}/pricing`, icon: Icon.tag, label: 'Pricing' },
             { to: `${base}/users`, icon: Icon.people, label: 'Portal admins' }]
          : [])
      ]
    : [
        { to: '/master', icon: Icon.home, label: 'Portals', end: true },
        { to: '/master/barns', icon: Icon.grid, label: 'Barns & stalls' },
        { to: '/master/addons', icon: Icon.list, label: 'Add-ons' },
        { to: '/master/vet-report', icon: Icon.doc, label: 'Vet report' }
      ]

  // Facility logo/name for the master console; portal branding when in a portal.
  const facilityLogo = facility?.logo_path ? logoUrl(supabase, facility.logo_path) : null
  const facilityName = facility?.name ?? "Stall'd"

  return (
    <div className="shell" data-style={portal ? undefined : (facility?.style || 'minimalist')}>
      <aside className="sidebar">
        <Link to={portal ? base : '/master'} className="brandmark">
          {portal
            ? (portal.logo_path
                ? <img className="logo logo-img" src={logoUrl(supabase, portal.logo_path)} alt="" />
                : <div className="logo">{portal.logo_letter ?? portal.name[0]}</div>)
            : (facilityLogo
                ? <img className="logo logo-img" src={facilityLogo} alt="" />
                : <div className="logo">S</div>)}
          <div>
            <div className="name">{portal ? portal.name : facilityName}</div>
            <div className="sub">{portal ? (facility?.name ?? '') : 'Master console'}</div>
          </div>
        </Link>
        {nav.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}>
            {n.icon}{n.label}
          </NavLink>
        ))}
        <div className="spacer" />
        {portal && isMaster && (
          <button className="ctx-switch" onClick={() => navigate('/master')}>
            Master admin — viewing as portal
            <b>↩ Back to master console</b>
          </button>
        )}
        <div className="ctx-switch" style={{ cursor: 'default' }}>
          Signed in as
          <b>
            <span className="avatar avatar-sm">{initials(profile?.full_name || user?.email)}</span>{' '}
            {profile?.full_name || user?.email}
          </b>
          <button className="linklike" onClick={() => signOut().then(() => navigate('/login'))}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  )
}
