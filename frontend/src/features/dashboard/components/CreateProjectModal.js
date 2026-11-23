import React, { memo, useEffect, useRef, useState } from 'react';
import { DEFAULT_PROJECT_TYPE, PROJECT_TYPE_OPTIONS } from '../../../projectTypes';

/**
 * Create a project in the selected access group, inside the current folder.
 *
 * The access group comes from the dashboard selector (a dropdown of groups the
 * user belongs to); it cannot be changed later.
 */
const CreateProjectModal = memo(function CreateProjectModal({
  onClose,
  onSubmit,
  accessGroups = [],
  accessGroup = '',
  folder = null,
}) {
  const nameInputRef = useRef(null);
  const descriptionInputRef = useRef(null);
  const projectTypeInputRef = useRef(null);
  const [group, setGroup] = useState(accessGroup || accessGroups[0] || '');
  const inFolder = folder && group === accessGroup ? folder : null;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!group) return;
    const payload = {
      name: nameInputRef.current.value,
      description: descriptionInputRef.current.value,
      meta_group_id: group,
      project_type: projectTypeInputRef.current.value,
    };
    if (inFolder) payload.folder_id = inFolder.id;
    onSubmit(payload);
  };

  useEffect(() => {
    if (nameInputRef.current) {
      nameInputRef.current.focus();
    }
  }, []);

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="create-project-title">
      <div className="modal-content">
        <div className="modal-header">
          <h3 id="create-project-title">Create New Project</h3>
          <button type="button" className="modal-close-btn" aria-label="Close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          <form id="create-project-form" onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="name">Project Name *</label>
              <input
                type="text"
                id="name"
                ref={nameInputRef}
                required
                maxLength={255}
                placeholder="Enter a descriptive project name"
                className="form-control"
              />
              <small className="form-text">
                Choose a clear, descriptive name for your project
              </small>
            </div>

            <div className="form-group">
              <label htmlFor="description">Description</label>
              <textarea
                id="description"
                rows="3"
                ref={descriptionInputRef}
                placeholder="Describe what this project is for..."
                className="form-control"
              ></textarea>
              <small className="form-text">
                Optional: Add more details about your project's purpose
              </small>
            </div>

            <div className="form-group">
              <label htmlFor="meta_group_id">Access Group *</label>
              <select
                id="meta_group_id"
                required
                className="form-control"
                value={group}
                onChange={(e) => setGroup(e.target.value)}
                disabled={accessGroups.length === 0}
              >
                {accessGroups.length === 0 && <option value="">No access groups available</option>}
                {accessGroups.map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
              <small className="form-text">
                Who can open this project. It cannot be changed after the project is created.
              </small>
            </div>
            <div className="form-group">
              <span className="form-label">Folder</span>
              <div className="form-static" data-testid="create-project-folder">
                {inFolder ? (inFolder.path || [{ name: inFolder.name }]).map((p) => p.name).join(' / ') : 'Top level'}
              </div>
            </div>
            <div className="form-group">
              <label htmlFor="project_type">Project Type *</label>
              <select
                id="project_type"
                ref={projectTypeInputRef}
                defaultValue={DEFAULT_PROJECT_TYPE}
                className="form-control"
              >
                {PROJECT_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <small className="form-text">
                Select the project workflow mode used by inspection workbench tools
              </small>
            </div>
          </form>
        </div>
        <div className="modal-footer">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="submit"
            form="create-project-form"
            className="btn btn-success btn-large"
            disabled={!group}
          >
            Create Project
          </button>
        </div>
      </div>
    </div>
  );
});

export default CreateProjectModal;
