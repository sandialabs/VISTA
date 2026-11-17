import React, { useCallback, useState, useEffect, Suspense } from 'react';
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useParams,
} from 'react-router-dom';
import './App.css';
import DashboardHome from './features/dashboard/components/DashboardHome';
import useDashboardData from './features/dashboard/useDashboardData';
import lazyWithRetry from './utils/lazyWithRetry';

// Lazy load components
const Project = lazyWithRetry(() => import('./Project'));
const ImageView = lazyWithRetry(() => import('./ImageView'));
const ApiKeys = lazyWithRetry(() => import('./ApiKeys'));
const GroupGalleryView = lazyWithRetry(() => import('./components/GroupGalleryView'));

function LegacyProjectReportRedirect() {
  const { id } = useParams();
  return <Navigate to={`/project/${id}?tab=report`} replace />;
}

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    const isJsdom = window.navigator?.userAgent?.toLowerCase().includes('jsdom');
    if (!isJsdom && typeof window.scrollTo === 'function') {
      window.scrollTo(0, 0);
    }
  }, [pathname]);
  return null;
}

function App() {
  // const navigate = useNavigate(); // Commented out - not currently used
  const [toast, setToast] = useState(null);
  const [showDashboardSettings, setShowDashboardSettings] = useState(false);
  
  // Stable so hooks can depend on them without re-running.
  const showToast = useCallback((message, type = 'error', options = {}) => {
    setToast({ message, type, persist: Boolean(options.persist) });
  }, []);

  const hideToast = useCallback(() => {
    setToast(null);
  }, []);

  const {
    currentUser,
    userLoaded,
    currentUserGroups,
    showArchived,
    setShowArchived,
    dashboardDebugMode,
    handleDashboardDebugModeChange,
  } = useDashboardData(showToast);

  const homePage = (
    <DashboardHome
      currentUser={currentUser}
      userLoaded={userLoaded}
      currentUserGroups={currentUserGroups}
      dashboardDebugMode={dashboardDebugMode}
      handleDashboardDebugModeChange={handleDashboardDebugModeChange}
      hideToast={hideToast}
      setShowArchived={setShowArchived}
      setShowDashboardSettings={setShowDashboardSettings}
      showArchived={showArchived}
      showDashboardSettings={showDashboardSettings}
      showToast={showToast}
      toast={toast}
    />
  );

  return (
    <>
    <ScrollToTop />
    <Routes>
      <Route path="/" element={homePage} />
      <Route
        path="/project/:id"
        element={
          <Suspense fallback={<div className="loading-container">Loading project...</div>}>
            <Project currentUserGroups={currentUserGroups} currentUser={currentUser} />
          </Suspense>
        }
      />
      <Route
        path="/project/:id/report"
        element={<LegacyProjectReportRedirect />}
      />
      <Route
        path="/project/:id/group/:groupId"
        element={
          <Suspense fallback={<div className="loading-container">Loading group...</div>}>
            <GroupGalleryView />
          </Suspense>
        }
      />
      <Route
        path="/project/:id/ungrouped"
        element={
          <Suspense fallback={<div className="loading-container">Loading ungrouped images...</div>}>
            <GroupGalleryView />
          </Suspense>
        }
      />
      <Route
        path="/view/:imageId"
        element={
          <Suspense fallback={<div className="loading-container">Loading image...</div>}>
            <ImageView />
          </Suspense>
        }
      />
      <Route 
        path="/api-keys" 
        element={
          <Suspense fallback={<div className="loading-container">Loading API keys...</div>}>
            <ApiKeys />
          </Suspense>
        } 
      />
    </Routes>
    </>
  );
}

export default App;
