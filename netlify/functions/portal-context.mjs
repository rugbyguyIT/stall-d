// GET /api/portal/:slug  →  resolves portal context from the URL slug.
// Public data only (portals are public-read under RLS); cached at the edge.
export default async (req) => {
  const url = new URL(req.url)
  const slug = url.pathname.split('/').filter(Boolean).pop()

  if (!slug || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
    return Response.json({ error: 'Invalid portal slug' }, { status: 400 })
  }

  const SUPABASE_URL = process.env.SUPABASE_URL
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return Response.json({ error: 'Server not configured' }, { status: 500 })
  }

  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/portals?slug=eq.${slug}&is_active=eq.true` +
      `&select=id,name,slug,accent_color,logo_letter,logo_path,theme,is_active`,
    { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
  )
  if (!r.ok) return Response.json({ error: 'Lookup failed' }, { status: 502 })
  const rows = await r.json()
  if (!rows.length) return Response.json({ error: 'Portal not found' }, { status: 404 })

  return Response.json(rows[0], {
    headers: {
      'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600'
    }
  })
}

export const config = { path: '/api/portal/*' }
