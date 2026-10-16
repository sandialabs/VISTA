import React, { memo, useState } from 'react';
import { Link } from 'react-router-dom';
import { archiveProject, unarchiveProject } from '../../../api/projects';
import { getProjectTypeLabel } from '../../../projectTypes';

const ProjectItem = memo(function ProjectItem({ project, onEdit, onDelete, canDelete, currentUser, onArchiveToggle }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const canArchive = currentUser && (!project.created_by || project.created_by === currentUser.email);

  const handleArchiveToggle = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!canArchive) return;
    const message = project.is_archived
      ? `Unarchive "${project.name}"? This will restore full editing access.`
      : `Archive "${project.name}"? The project will become read-only and hidden by default.`;
    if (!window.confirm(message)) return;
    setArchiving(true);
    try {
      const updated = project.is_archived
        ? await unarchiveProject(project.id)
        : await archiveProject(project.id);
      onArchiveToggle(updated);
    } catch (error) {
      alert(error.message);
    } finally {
      setArchiving(false);
      setMenuOpen(false);
    }
  };

  return (
    <div className={`project-card${project.is_archived ? ' project-card-archived' : ''}`}>
      <div className="project-card-header">
        <div className="project-card-header-row">
          <Link
            to={`/project/${project.id}`}
            className="project-card-link-title"
          >
          <h3 className="project-card-title">{project.name}</h3>
          {project.is_archived && <span className="archived-badge">Archived</span>}
          </Link>
          <div className="project-card-menu">
            <button
              type="button"
              className="project-card-menu-button"
              aria-label={`Project options for ${project.name}`}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setMenuOpen((prev) => !prev);
              }}
            >
              …
            </button>
            {menuOpen && (
              <div className="project-card-menu-dropdown">
                <button
                  type="button"
                  className="project-card-menu-item"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setMenuOpen(false);
                    onEdit(project);
                  }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="project-card-menu-item"
                  disabled={!canArchive || archiving}
                  title={!canArchive ? 'Only the project creator can archive/unarchive.' : ''}
                  onClick={handleArchiveToggle}
                >
                  {project.is_archived ? 'Unarchive' : 'Archive'}
                </button>
                <button
                  type="button"
                  className="project-card-menu-item"
                  disabled={!canDelete}
                  title={canDelete ? '' : 'You do not have access to delete this project.'}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (!canDelete) return;
                    setMenuOpen(false);
                    onDelete(project);
                  }}
                >
                  Delete
                </button>
              </div>
            )}
          </div>
        </div>
        <Link
          to={`/project/${project.id}`}
          style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
        >
          <div className="project-card-meta">
            ID: {project.id} • Group: {project.meta_group_id} • Type: {getProjectTypeLabel(project.project_type, { short: true })}
          </div>
          <div className="project-card-meta">
            Images: {project.image_count ?? 0} • Parts: {project.part_count ?? 0}
          </div>
        </Link>
      </div>
      <Link
        to={`/project/${project.id}`}
        style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
      >
        <div className="project-card-body">
          <p className="project-card-description">
            {project.description || 'No description provided'}
          </p>
        </div>
      </Link>
    </div>
  );
});

export default ProjectItem;
