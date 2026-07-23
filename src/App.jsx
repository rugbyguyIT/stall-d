import { Routes, Route, Navigate } from 'react-router-dom'
import { isConfigured } from './lib/supabase'
import { useAuth } from './context/AuthContext'
import { PortalProvider } from './context/PortalContext'
import Protected from './components/Protected'
import Login from './pages/Login'
import MasterDashboard from './pages/master/MasterDashboard'
import Barns from './pages/master/Barns'
import AddOns from './pages/master/AddOns'
import Allocate from './pages/master/Allocate'
import PortalDashboard from './pages/portal/PortalDashboard'
import Reservations from './pages/portal/Reservations'
import ReservationForm from './pages/portal/ReservationForm'
import ContestantProfile from './pages/portal/ContestantProfile'
import PortalUsers from './pages/portal/PortalUsers'
import DisplayBoard from './pages/portal/DisplayBoard'

function Home() {
  const { user, loading, isMaster, portalIds } = useAuth()
  if (loading) return <div className="page-loader">Loading…</div>
  if (!user) return <Navigate to="/login" replace />
  if (isMaster) return <Navigate to="/master" replace />
  return <Navigate to="/login" replace state={{ pickPortal: true, portalIds }} />
}

export default function App() {
  if (!isConfigured) {
    return (
      <div className="page-loader">
        <div className="card" style={{ padding: 24, maxWidth: 460 }}>
          <b>Configuration needed</b>
          <p style={{ marginTop: 8, color: 'var(--ink-2)' }}>
            Set <code>SUPABASE_URL</code> and <code>SUPABASE_ANON_KEY</code> in your
            Netlify environment variables (or a local <code>.env</code>) and rebuild.
          </p>
        </div>
      </div>
    )
  }
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Login />} />
      <Route path="/master" element={<Protected requireMaster><MasterDashboard /></Protected>} />
      <Route path="/master/barns" element={<Protected requireMaster><Barns /></Protected>} />
      <Route path="/master/addons" element={<Protected requireMaster><AddOns /></Protected>} />
      <Route path="/master/portals/:portalId/allocate" element={<Protected requireMaster><Allocate /></Protected>} />
      {/* TV board: no sign-in — authorized by the per-portal display key. */}
      <Route path="/portal/:slug/display" element={<DisplayBoard />} />
      <Route path="/portal/:slug" element={<PortalProvider><PortalOutletRoutes /></PortalProvider>}>
        <Route index element={<Protected><PortalDashboard /></Protected>} />
        <Route path="reservations" element={<Protected><Reservations /></Protected>} />
        <Route path="reserve" element={<Protected><ReservationForm /></Protected>} />
        <Route path="reserve/:reservationId" element={<Protected><ReservationForm /></Protected>} />
        <Route path="contestants/:contestantId" element={<Protected><ContestantProfile /></Protected>} />
        <Route path="users" element={<Protected><PortalUsers /></Protected>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

import { Outlet } from 'react-router-dom'
import { usePortal } from './context/PortalContext'

function PortalOutletRoutes() {
  const { portal } = usePortal()
  if (portal === undefined) return <div className="page-loader">Loading portal…</div>
  if (portal === null)
    return (
      <div className="page-loader">
        <div className="card" style={{ padding: 24 }}>
          <b>Portal not found</b>
          <p style={{ color: 'var(--ink-2)', marginTop: 6 }}>No portal exists at this address.</p>
        </div>
      </div>
    )
  return <Outlet />
}
