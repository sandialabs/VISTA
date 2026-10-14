import React, { memo, useEffect, useState } from 'react';
import { DEFAULT_PROJECT_TYPE, PROJECT_TYPE_OPTIONS } from '../../../projectTypes';

const EditProjectModal = memo(function EditProjectModal({ project, onClose, onSubmit }) {
  const [name, setName] = useState(project?.name || '');
  const [description, setDescription] = useState(project?.description || '');
  const [projectType, setProjectType] = useState(project?.project_type || DEFAULT_PROJECT_TYPE);

  useEffect(() => {
    setName(project?.name || '');
    setDescription(project?.description || '');
    setProjectType(project?.project_type || DEFAULT_PROJECT_TYPE);
  }, [project]);

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit({
      name,
      description,
      project_type: projectType,
    });
  };

  if (!project) return null;

  return (
    <div className="modal">
      <div className="modal-content">
        <div className="modal-header">
          <h3>Edit Project</h3>
          <span className="close" onClick={onClose}>&times;</span>
        </div>
        <div className="modal-body">
          <form id="edit-project-form" onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="edit_name">Project Name *</label>
              <input
                type="text"
                id="edit_name"
                className="form-control"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="edit_description">Description</label>
              <textarea
                id="edit_description"
                rows="3"
                className="form-control"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              ></textarea>
            </div>
            <div className="form-group">
              <label htmlFor="edit_project_type">Project Type *</label>
              <select
                id="edit_project_type"
                className="form-control"
                value={projectType}
                onChange={(e) => setProjectType(e.target.value)}
              >
                {PROJECT_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
          </form>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="edit-project-form" className="btn btn-success btn-large">
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
});

export default EditProjectModal;
