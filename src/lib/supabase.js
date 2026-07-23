import { createClient } from '@supabase/supabase-js'

const url =
  import.meta.env.SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL
const anonKey =
  import.meta.env.SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  // Surfaced in the UI by ConfigError in App.jsx rather than a white screen.
  console.error('Missing SUPABASE_URL / SUPABASE_ANON_KEY environment variables.')
}

export const supabase = createClient(url ?? 'http://localhost', anonKey ?? 'anon', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
})

export const isConfigured = Boolean(url && anonKey)

/** Read a custom claim from the current session's access token. */
export function jwtClaim(session, key) {
  try {
    const token = session?.access_token
    if (!token) return undefined
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return payload[key]
  } catch {
    return undefined
  }
}
