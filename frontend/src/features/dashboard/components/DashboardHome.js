import React from 'react';
import { Link } from 'react-router-dom';
import Toast from '../../../components/Toast';
import CreateProjectModal from './CreateProjectModal';
import DashboardSettingsModal from './DashboardSettingsModal';
import DeleteProjectModal from './DeleteProjectModal';
import EditProjectModal from './EditProjectModal';
import ProjectItem from './ProjectItem';

export default function DashboardHome({
  currentUser,
  currentUserGroups,
  dashboardDebugMode,
  deletingProject,
  editingProject,
  handleArchiveToggle,
  handleConfirmDeleteProject,
  handleCreateProject,
  handleDashboardDebugModeChange,
  handleDeleteProject,
  handleEditProject,
  handleUpdateProject,
  hideToast,
  loadProjects,
  loading,
  projects,
  setDeletingProject,
  setEditingProject,
  setShowDashboardSettings,
  setShowModal,
  setShowArchived,
  showArchived,
  showDashboardSettings,
  showModal,
  showToast,
  toast,
}) {
  return (
    <div className="App">
      <header className="App-header">
        <div className="header-content">
          <div className="header-title">
            <h1>VISTA an Image Management System</h1>
            {currentUser && (
              <div className="user-info">
                <span>Welcome back, {currentUser.email}</span>
              </div>
            )}
          </div>
          <div className="header-actions">
            <button
              type="button"
              className="btn btn-secondary dashboard-settings-button"
              onClick={() => setShowDashboardSettings(true)}
              aria-label="Open dashboard settings"
              title="Dashboard settings"
            >
              <span>Settings</span>
            </button>
            <Link to="/api-keys" className="btn btn-secondary">
              API Keys
            </Link>
            <button
              className="btn btn-primary btn-large"
              onClick={() => setShowModal(true)}
            >
              New Project
            </button>
          </div>
        </div>
      </header>

      <div className="container">
        {/* Toast notification */}
        {toast && (
          <Toast
            message={toast.message}
            type={toast.type}
            onClose={hideToast}
            duration={toast.persist ? null : 5000}
          />
        )}

        {/* Projects Section */}
        <div className="nav-breadcrumb">
          <div className="breadcrumb">
            <div className="breadcrumb-item">
              <span>Dashboard</span>
            </div>
            <span className="breadcrumb-separator">/</span>
            <div className="breadcrumb-item">
              <span>Projects</span>
            </div>
          </div>
        </div>

        {loading && (
          <div className="loading-container">
            <div className="spinner"></div>
            <div className="loading-text">Loading your projects...</div>
          </div>
        )}

        {!loading && projects.length === 0 && (
          <div className="card text-center">
            <div className="card-content">
              <div style={{ fontSize: '4rem', marginBottom: 'var(--space-4)' }}>+</div>
              <h3 style={{ marginBottom: 'var(--space-4)', color: 'var(--gray-600)' }}>
                No projects yet
              </h3>
              <p style={{ color: 'var(--gray-500)', marginBottom: 'var(--space-6)' }}>
                Get started by creating your first image management project
              </p>
              <button
                className="btn btn-primary btn-large"
                onClick={() => setShowModal(true)}
              >
                Create Your First Project
              </button>
            </div>
          </div>
        )}

        {!loading && projects.length > 0 && (
          <>
            <div className="flex justify-between items-center mb-6">
              <h2 style={{ margin: 0, color: 'var(--gray-900)', fontSize: '1.5rem', fontWeight: '600' }}>
                Your Projects ({projects.length})
              </h2>
              <div className="flex gap-4">
                <label className="archive-toggle-label">
                  <input
                    type="checkbox"
                    checked={showArchived}
                    onChange={(e) => setShowArchived(e.target.checked)}
                    className="archive-toggle-input"
                  />
                  <span className="archive-toggle-track">
                    <span className="archive-toggle-thumb"></span>
                  </span>
                  <span style={{ fontSize: '0.875rem', color: 'var(--gray-600)' }}>
                    Show archived
                  </span>
                </label>
                <span style={{ fontSize: '0.875rem', color: 'var(--gray-500)' }}>
                  {projects.length} {projects.length === 1 ? 'project' : 'projects'} total
                </span>
              </div>
            </div>
            <div className="projects-grid">
              {projects.map(project => (
                <ProjectItem
                  key={project.id}
                  project={project}
                  onEdit={handleEditProject}
                  onDelete={handleDeleteProject}
                  canDelete={currentUserGroups.includes(project.meta_group_id)}
                  currentUser={currentUser}
                  onArchiveToggle={handleArchiveToggle}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Create Project Modal */}
      {showModal && (
        <CreateProjectModal
          onClose={() => setShowModal(false)}
          onSubmit={handleCreateProject}
        />
      )}
      {editingProject && (
        <EditProjectModal
          project={editingProject}
          onClose={() => setEditingProject(null)}
          onSubmit={handleUpdateProject}
        />
      )}
      {showDashboardSettings && (
        <DashboardSettingsModal
          onClose={() => setShowDashboardSettings(false)}
          showToast={showToast}
          onImportComplete={() => loadProjects()}
          onDatabaseAccepted={() => loadProjects()}
          debugMode={dashboardDebugMode}
          onDebugModeChange={handleDashboardDebugModeChange}
        />
      )}
      {deletingProject && (
        <DeleteProjectModal
          project={deletingProject}
          onClose={() => setDeletingProject(null)}
          onConfirm={handleConfirmDeleteProject}
          canDelete={currentUserGroups.includes(deletingProject.meta_group_id)}
        />
      )}
    </div>
  );
}
