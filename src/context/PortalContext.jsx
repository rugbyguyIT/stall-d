import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'

const PortalContext = createContext(null)

/** Derive a light "wash" + deep variant from the portal accent for theming. */
function theme(accent) {
  const hex = /^#([0-9a-f]{6})$/i.exec(accent || '')?.[1]
  if (!hex) return { accent: '#2a78d6', wash: '#e8f1fc', deep: '#1c5cab' }
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16))
  const mix = (c, t, p) => Math.round(c + (t - c) * p)
  const toHex = (arr) => '#' + arr.map((c) => c.toString(16).padStart(2, '0')).join('')
  return {
    accent: '#' + hex,
    wash: toHex([mix(r, 255, 0.88), mix(g, 255, 0.88), mix(b, 255, 0.88)]),
    deep: toHex([mix(r, 0, 0.3), mix(g, 0, 0.3), mix(b, 0, 0.3)])
  }
}

export function PortalProvider({ children }) {
  const { slug } = useParams()
  const { portalIds, isMaster, user } = useAuth()
  const [portal, setPortal] = useState(undefined) // undefined=loading, null=not found
  const [membership, setMembership] = useState(null)

  useEffect(() => {
    let live = true
    setPortal(undefined)
    // Netlify function first (edge-cacheable, works pre-auth), Supabase as fallback.
    fetch(`/api/portal/${slug}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .catch(() =>
        supabase.from('portals').select('*').eq('slug', slug).maybeSingle()
          .then(({ data }) => data))
      .then((p) => { if (live) setPortal(p ?? null) })
    return () => { live = false }
  }, [slug])

  // Fallback membership check for tokens minted before access was granted.
  useEffect(() => {
    if (!portal?.id || !user) { setMembership(null); return }
    if (isMaster || portalIds.includes(portal.id)) { setMembership('claim'); return }
    let live = true
    supabase.from('portal_users').select('portal_id')
      .eq('portal_id', portal.id).eq('user_id', user.id).maybeSingle()
      .then(({ data }) => { if (live) setMembership(data ? 'row' : null) })
    return () => { live = false }
  }, [portal?.id, user?.id, isMaster, portalIds.join(',')])

  const isPortalAdmin = isMaster || membership !== null
  const colors = useMemo(() => theme(portal?.accent_color), [portal?.accent_color])

  const value = { slug, portal, isPortalAdmin, colors }
  return (
    <PortalContext.Provider value={value}>
      <div
        className="portal-scope"
        style={{
          '--portal-accent': colors.accent,
          '--accent-wash': colors.wash,
          '--accent-deep': colors.deep
        }}
      >
        {children}
      </div>
    </PortalContext.Provider>
  )
}

export const usePortal = () => useContext(PortalContext)
