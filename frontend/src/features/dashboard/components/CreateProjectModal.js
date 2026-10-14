import React, { memo, useEffect, useRef } from 'react';
import { DEFAULT_PROJECT_TYPE, PROJECT_TYPE_OPTIONS } from '../../../projectTypes';

const CreateProjectModal = memo(function CreateProjectModal({ onClose, onSubmit }) {
  const nameInputRef = useRef(null);
  const descriptionInputRef = useRef(null);
  const groupIdInputRef = useRef(null);
  const projectTypeInputRef = useRef(null);

  const handleSubmit = (e) => {
    e.preventDefault();

    onSubmit({
      name: nameInputRef.current.value,
      description: descriptionInputRef.current.value,
      meta_group_id: groupIdInputRef.current.value,
      project_type: projectTypeInputRef.current.value,
    });
  };

  useEffect(() => {
    if (nameInputRef.current) {
      nameInputRef.current.focus();
    }
  }, []);

  return (
    <div className="modal">
      <div className="modal-content">
        <div className="modal-header">
          <h3>Create New Project</h3>
          <span className="close" onClick={onClose}>&times;</span>
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
              <input
                type="text"
                id="meta_group_id"
                ref={groupIdInputRef}
                required
                placeholder="Enter the group ID you have access to"
                className="form-control"
              />
              <small className="form-text">
                Enter the ID of a group you are a member of
              </small>
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
          >
            Create Project
          </button>
        </div>
      </div>
    </div>
  );
});

export default CreateProjectModal;
