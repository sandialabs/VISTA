import { useCallback, useState } from 'react';
import { createProject, deleteProject, updateProject } from '../../api/projects';
import { DEFAULT_PROJECT_TYPE } from '../../projectTypes';

export default function useDashboardProjectActions({
  currentUserGroups,
  loadProjects,
  setLoading,
  setProjects,
  showArchived,
  showToast,
}) {
  const [showModal, setShowModal] = useState(false);
  const [editingProject, setEditingProject] = useState(null);
  const [deletingProject, setDeletingProject] = useState(null);

  const handleCreateProject = useCallback((projectData) => {
    setLoading(true);

    createProject(projectData)
      .then(data => {
        const normalized = {
          ...data,
          project_type: data.project_type || projectData.project_type || DEFAULT_PROJECT_TYPE,
        };
        // Add the new project to the projects list
        setProjects(prev => [...prev, normalized]);
        // Close modal
        setShowModal(false);
        setLoading(false);
        // Show success toast
        showToast(`Project "${normalized.name}" created successfully!`, 'success');
      })
      .catch(err => {
        showToast(err.message, 'error');
        setLoading(false);
      });
  }, [setLoading, setProjects, showToast]);

  const handleEditProject = useCallback((project) => {
    setEditingProject(project);
  }, []);

  const handleUpdateProject = useCallback((updatedData) => {
    if (!editingProject) return;
    setLoading(true);

    updateProject(editingProject.id, updatedData)
      .then((savedProject) => {
        setProjects((prev) => prev.map((p) => (p.id === savedProject.id ? savedProject : p)));
        setEditingProject(null);
        setLoading(false);
        showToast(`Project "${savedProject.name}" updated successfully!`, 'success');
      })
      .catch((err) => {
        showToast(err.message, 'error');
        setLoading(false);
      });
  }, [editingProject, setLoading, setProjects, showToast]);

  const handleDeleteProject = useCallback((project) => {
    if (!currentUserGroups.includes(project.meta_group_id)) {
      showToast(`You are not authorized to delete project "${project.name}".`, 'error');
      return;
    }
    setDeletingProject(project);
  }, [currentUserGroups, showToast]);

  const handleConfirmDeleteProject = useCallback((project) => {
    if (!project) return;
    setLoading(true);

    deleteProject(project.id, `DELETE ${project.name}`)
      .then(() => {
        return loadProjects().then(() => {
          setDeletingProject(null);
          setLoading(false);
          showToast(`Project "${project.name}" deleted successfully.`, 'success');
        });
      })
      .catch((err) => {
        showToast(err.message, 'error');
        setLoading(false);
      });
  }, [loadProjects, setLoading, showToast]);

  const handleArchiveToggle = useCallback((updatedProject) => {
    setProjects((prev) => {
      if (updatedProject.is_archived && !showArchived) {
        return prev.filter((p) => p.id !== updatedProject.id);
      }
      return prev.map((p) => (p.id === updatedProject.id ? updatedProject : p));
    });
  }, [setProjects, showArchived]);

  return {
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
  };
}
