// POST /api/admin/user — master-only user administration (service-role backed).
//
// The service role key can create users and reset any password, so this runs
// only on the server and every call is authorized: we read the caller's access
// token, confirm it belongs to a master_admin, and only then act.
//
// Actions (JSON body { action, ... }):
//   create        { email, password, full_name, role, must_change }  → new auth user + profile
//   set_password  { user_id, password, must_change }                 → reset a password
//
// Role changes and the must_change flag alone are done client-side (allowed by
// RLS for masters); this function is only for things that need the service role.

const json = (body, status = 200) => Response.json(body, { status })

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const SUPABASE_URL = process.env.SUPABASE_URL
  const ANON = process.env.SUPABASE_ANON_KEY
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SUPABASE_URL || !ANON || !SERVICE) {
    return json({ error: 'Server not configured (missing SUPABASE_SERVICE_ROLE_KEY?)' }, 500)
  }

  // ---- authorize: caller must be a signed-in master_admin ----
  const authz = req.headers.get('authorization') || ''
  const token = authz.replace(/^Bearer\s+/i, '')
  if (!token) return json({ error: 'Not signed in' }, 401)

  const meRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: ANON, Authorization: `Bearer ${token}` }
  })
  if (!meRes.ok) return json({ error: 'Invalid session' }, 401)
  const me = await meRes.json()

  const roleRes = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${me.id}&select=role`,
    { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } }
  )
  const roleRows = roleRes.ok ? await roleRes.json() : []
  if (roleRows[0]?.role !== 'master_admin') {
    return json({ error: 'Master admins only' }, 403)
  }

  // ---- parse ----
  let body
  try { body = await req.json() } catch { return json({ error: 'Bad JSON' }, 400) }
  const { action } = body || {}

  const admin = (path, init) => fetch(`${SUPABASE_URL}/auth/v1/admin${path}`, {
    ...init,
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json', ...(init?.headers || {}) }
  })
  const rest = (path, init) => fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...init,
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(init?.headers || {}) }
  })

  try {
    if (action === 'create') {
      const email = (body.email || '').trim().toLowerCase()
      const password = body.password || ''
      const full_name = body.full_name || null
      const role = ['master_admin', 'portal_admin', 'contestant'].includes(body.role) ? body.role : 'contestant'
      if (!email || password.length < 8) return json({ error: 'Email and an 8+ character password are required' }, 400)

      const cr = await admin('/users', {
        method: 'POST',
        body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name, role } })
      })
      const created = await cr.json()
      if (!cr.ok) return json({ error: created.msg || created.error_description || 'Could not create user' }, cr.status)

      // The handle_new_user trigger makes the profile from user_metadata.role,
      // but set role + flag explicitly so it's authoritative.
      await rest(`/profiles?id=eq.${created.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ role, full_name, must_change_password: !!body.must_change })
      })
      return json({ ok: true, user_id: created.id, email })
    }

    if (action === 'set_password') {
      const user_id = body.user_id
      const password = body.password || ''
      if (!user_id || password.length < 8) return json({ error: 'An 8+ character password is required' }, 400)

      const ur = await admin(`/users/${user_id}`, {
        method: 'PUT',
        body: JSON.stringify({ password })
      })
      if (!ur.ok) { const e = await ur.json().catch(() => ({})); return json({ error: e.msg || 'Could not set password' }, ur.status) }

      await rest(`/profiles?id=eq.${user_id}`, {
        method: 'PATCH',
        body: JSON.stringify({ must_change_password: !!body.must_change })
      })
      return json({ ok: true })
    }

    return json({ error: 'Unknown action' }, 400)
  } catch (e) {
    return json({ error: String(e?.message || e) }, 500)
  }
}

export const config = { path: '/api/admin/user' }
