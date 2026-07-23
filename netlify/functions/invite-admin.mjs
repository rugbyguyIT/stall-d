// POST /.netlify/functions/invite-admin
// Body: { email, full_name, portal_id }
// Caller must be a portal admin of that portal (or master admin).
// Uses the service-role key (server-side only) to send a Supabase invite,
// set the invitee's role, and attach them to the portal.
export default async (req) => {
  if (req.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 })

  const SUPABASE_URL = process.env.SUPABASE_URL
  const ANON = process.env.SUPABASE_ANON_KEY
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SUPABASE_URL || !ANON || !SERVICE) {
    return Response.json({ error: 'Server not configured (SUPABASE_SERVICE_ROLE_KEY required)' }, { status: 500 })
  }

  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) return Response.json({ error: 'Not signed in' }, { status: 401 })

  let body
  try { body = await req.json() } catch { return Response.json({ error: 'Bad JSON' }, { status: 400 }) }
  const { email, full_name = '', portal_id } = body ?? {}
  if (!email || !portal_id) return Response.json({ error: 'email and portal_id are required' }, { status: 400 })

  const svc = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' }

  // 1. Identify the caller from their JWT.
  const me = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: ANON, Authorization: `Bearer ${jwt}` }
  })
  if (!me.ok) return Response.json({ error: 'Invalid session' }, { status: 401 })
  const caller = await me.json()

  // 2. Authorize: master admin, or portal_admin with a portal_users row here.
  const [profR, puR] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${caller.id}&select=role`, { headers: svc }),
    fetch(`${SUPABASE_URL}/rest/v1/portal_users?user_id=eq.${caller.id}&portal_id=eq.${portal_id}&select=user_id`, { headers: svc })
  ])
  const prof = (await profR.json())[0]
  const isMaster = prof?.role === 'master_admin'
  const isPortalAdmin = prof?.role === 'portal_admin' && (await puR.json()).length > 0
  if (!isMaster && !isPortalAdmin) {
    return Response.json({ error: 'Not authorized to manage this portal' }, { status: 403 })
  }

  // 3. Invite (or find existing user).
  let invitee
  const inv = await fetch(`${SUPABASE_URL}/auth/v1/invite`, {
    method: 'POST', headers: svc,
    body: JSON.stringify({ email, data: { full_name, role: 'portal_admin' } })
  })
  if (inv.ok) {
    invitee = await inv.json()
  } else {
    // Already registered → look them up instead.
    const q = await fetch(
      `${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1&email=${encodeURIComponent(email)}`,
      { headers: svc })
    const found = (await q.json())?.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase())
    if (!found) return Response.json({ error: 'Could not invite or find that email' }, { status: 502 })
    invitee = found
  }

  // 4. Ensure profile exists with portal_admin role (never downgrade a master).
  await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${invitee.id}&role=neq.master_admin`, {
    method: 'PATCH', headers: { ...svc, Prefer: 'return=minimal' },
    body: JSON.stringify({ role: 'portal_admin', full_name: full_name || undefined })
  })

  // 5. Attach to the portal (idempotent).
  const link = await fetch(`${SUPABASE_URL}/rest/v1/portal_users`, {
    method: 'POST',
    headers: { ...svc, Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify({ portal_id, user_id: invitee.id })
  })
  if (!link.ok && link.status !== 409) {
    return Response.json({ error: 'Failed to attach user to portal' }, { status: 502 })
  }

  return Response.json({ ok: true, user_id: invitee.id })
}

export const config = { path: '/.netlify/functions/invite-admin' }
