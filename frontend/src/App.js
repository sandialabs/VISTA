import React, { useState, useEffect, Suspense } from 'react';
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
import useDashboardProjectActions from './features/dashboard/useDashboardProjectActions';
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
  // const [newProject, setNewProject] = useState({  // Commented out - not currently used
  //   name: '',
  //   description: '',
  //   meta_group_id: ''
  // });
  
  // Function to show a toast notification
  const showToast = (message, type = 'error', options = {}) => {
    setToast({ message, type, persist: Boolean(options.persist) });
  };

  // Function to hide the toast
  const hideToast = () => {
    setToast(null);
  };

  const {
    projects,
    setProjects,
    loading,
    setLoading,
    currentUser,
    currentUserGroups,
    showArchived,
    setShowArchived,
    dashboardDebugMode,
    handleDashboardDebugModeChange,
    loadProjects,
  } = useDashboardData(showToast);

  const {
    deletingProject,
    editingProject,
    handleArchiveToggle,
    handleConfirmDeleteProject,
    handleCreateProject,
    handleDeleteProject,
    handleEditProject,
    handleUpdateProject,
    setDeletingProject,
    setEditingProject,
    setShowModal,
    showModal,
  } = useDashboardProjectActions({
    currentUserGroups,
    loadProjects,
    setLoading,
    setProjects,
    showArchived,
    showToast,
  });
  const homePage = (
    <DashboardHome
      currentUser={currentUser}
      currentUserGroups={currentUserGroups}
      dashboardDebugMode={dashboardDebugMode}
      deletingProject={deletingProject}
      editingProject={editingProject}
      handleArchiveToggle={handleArchiveToggle}
      handleConfirmDeleteProject={handleConfirmDeleteProject}
      handleCreateProject={handleCreateProject}
      handleDashboardDebugModeChange={handleDashboardDebugModeChange}
      handleDeleteProject={handleDeleteProject}
      handleEditProject={handleEditProject}
      handleUpdateProject={handleUpdateProject}
      hideToast={hideToast}
      loadProjects={loadProjects}
      loading={loading}
      projects={projects}
      setDeletingProject={setDeletingProject}
      setEditingProject={setEditingProject}
      setShowArchived={setShowArchived}
      setShowDashboardSettings={setShowDashboardSettings}
      setShowModal={setShowModal}
      showArchived={showArchived}
      showDashboardSettings={showDashboardSettings}
      showModal={showModal}
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
            <Project currentUserGroups={currentUserGroups} />
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
