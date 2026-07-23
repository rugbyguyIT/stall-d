import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Protected({ children, requireMaster = false }) {
  const { user, loading, isMaster } = useAuth()
  const loc = useLocation()
  if (loading) return <div className="page-loader">Loading…</div>
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname }} replace />
  if (requireMaster && !isMaster) return <Navigate to="/" replace />
  return children
}
