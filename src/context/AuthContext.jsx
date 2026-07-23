import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase, jwtClaim } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined) // undefined = loading
  const [profile, setProfile] = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null))
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => setSession(s ?? null))
    return () => sub.subscription.unsubscribe()
  }, [])

  const loadProfile = useCallback(async (uid) => {
    if (!uid) { setProfile(null); return }
    const { data } = await supabase.from('profiles').select('*').eq('id', uid).single()
    setProfile(data ?? null)
  }, [])

  useEffect(() => {
    let live = true
    if (!session?.user) { setProfile(null); return }
    supabase.from('profiles').select('*').eq('id', session.user.id).single()
      .then(({ data }) => { if (live) setProfile(data ?? null) })
    return () => { live = false }
  }, [session?.user?.id])

  const reloadProfile = useCallback(() => loadProfile(session?.user?.id), [loadProfile, session?.user?.id])

  const role = jwtClaim(session, 'app_role') ?? profile?.role ?? 'contestant'
  const portalIds = jwtClaim(session, 'portal_ids') ?? []

  const signIn = useCallback((email, password) =>
    supabase.auth.signInWithPassword({ email, password }), [])

  const signUp = useCallback((email, password, fullName) =>
    supabase.auth.signUp({
      email, password,
      options: { data: { full_name: fullName, role: 'contestant' } }
    }), [])

  const signOut = useCallback(() => supabase.auth.signOut(), [])

  const value = {
    session, user: session?.user ?? null, profile, role, portalIds,
    isMaster: role === 'master_admin',
    mustChangePassword: Boolean(session?.user && profile?.must_change_password),
    loading: session === undefined,
    signIn, signUp, signOut, reloadProfile
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)
