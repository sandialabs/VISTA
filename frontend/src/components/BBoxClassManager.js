import React, { useState } from 'react';

const DEFAULT_COLORS = [
  '#4CAF50', '#2196F3', '#FF9800', '#E91E63', '#9C27B0',
  '#00BCD4', '#FF5722', '#795548', '#607D8B', '#CDDC39',
  '#3F51B5', '#F44336', '#009688', '#FFC107', '#8BC34A',
];

function BBoxClassManager({ projectId, bboxClasses, setBBoxClasses, loading, setLoading, setError }) {
  const [newClass, setNewClass] = useState({ name: '', description: '', color: '' });
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingClass, setEditingClass] = useState({ id: '', name: '', description: '', color: '' });
  const [actionLoading, setActionLoading] = useState(false);

  const nextDefaultColor = DEFAULT_COLORS[bboxClasses.length % DEFAULT_COLORS.length];

  const handleAddClass = async () => {
    if (newClass.name.trim() === '') {
      setError('Bbox class name cannot be empty');
      return;
    }

    try {
      setActionLoading(true);
      const response = await fetch(`/api/projects/${projectId}/bbox-classes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newClass.name,
          description: newClass.description,
          color: newClass.color || nextDefaultColor,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const newClassData = await response.json();
      setBBoxClasses(prev => [...prev, newClassData]);
      setNewClass({ name: '', description: '', color: '' });
      setError(null);
    } catch (err) {
      setError(`Failed to add bbox class: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleEditClass = async () => {
    try {
      setActionLoading(true);
      const response = await fetch(`/api/bbox-classes/${editingClass.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editingClass.name,
          description: editingClass.description,
          color: editingClass.color,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const updatedClass = await response.json();
      setBBoxClasses(prev =>
        prev.map(cls => cls.id === editingClass.id ? updatedClass : cls)
      );
      setShowEditModal(false);
      setError(null);
    } catch (err) {
      setError(`Failed to update bbox class: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteClass = async (id, name) => {
    if (!window.confirm(`Are you sure you want to delete the bbox class "${name}"?`)) {
      return;
    }

    try {
      setActionLoading(true);
      const response = await fetch(`/api/bbox-classes/${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      setBBoxClasses(prev => prev.filter(cls => cls.id !== id));
      setError(null);
    } catch (err) {
      setError(`Failed to delete bbox class: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="card">
      <div className="card-header">
        <h2>Bounding Box Classes</h2>
      </div>
      <div className="card-content">
        <div id="bbox-classes-container">
          {(loading || actionLoading) && <p>Loading bbox classes...</p>}

          {!loading && bboxClasses.length === 0 && (
            <p>No bbox classes defined. Add a class to enable annotation drawing.</p>
          )}

          {!loading && bboxClasses.length > 0 && (
            <ul className="class-list">
              {bboxClasses.map(cls => (
                <li key={cls.id} className="class-item">
                  <div className="class-info" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{
                      display: 'inline-block',
                      width: 16,
                      height: 16,
                      borderRadius: 4,
                      backgroundColor: cls.color || '#4CAF50',
                      border: '1px solid #ccc',
                      flexShrink: 0,
                    }} />
                    <div>
                      <h4>{cls.name}</h4>
                      <p>{cls.description || 'No description'}</p>
                    </div>
                  </div>
                  <div className="class-actions">
                    <button
                      className="btn btn-small"
                      onClick={() => {
                        setEditingClass({
                          id: cls.id,
                          name: cls.name,
                          description: cls.description || '',
                          color: cls.color || '#4CAF50',
                        });
                        setShowEditModal(true);
                      }}
                    >
                      Edit
                    </button>
                    <button
                      className="btn btn-small btn-danger"
                      onClick={() => handleDeleteClass(cls.id, cls.name)}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div id="add-bbox-class-form" className="form">
          <h3>Add Bbox Class</h3>
          <div className="form-group">
            <label htmlFor="bbox-class-name">Name:</label>
            <input
              type="text"
              id="bbox-class-name"
              value={newClass.name}
              onChange={(e) => setNewClass({ ...newClass, name: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddClass(); } }}
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="bbox-class-description">Description:</label>
            <textarea
              id="bbox-class-description"
              rows="2"
              value={newClass.description}
              onChange={(e) => setNewClass({ ...newClass, description: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAddClass(); } }}
            ></textarea>
          </div>
          <div className="form-group">
            <label htmlFor="bbox-class-color">Color:</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="color"
                id="bbox-class-color"
                value={newClass.color || nextDefaultColor}
                onChange={(e) => setNewClass({ ...newClass, color: e.target.value })}
                style={{ width: 40, height: 32, padding: 0, border: '1px solid #ccc', cursor: 'pointer' }}
              />
              <span style={{ fontSize: '0.85rem', color: '#666' }}>
                {newClass.color || nextDefaultColor}
              </span>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={actionLoading}
            onClick={(e) => { e.preventDefault(); handleAddClass(); }}
          >
            Add Bbox Class
          </button>
        </div>

        {/* Edit modal */}
        {showEditModal && (
          <div className="modal">
            <div className="modal-content">
              <span
                className="close-modal"
                onClick={() => setShowEditModal(false)}
              >
                &times;
              </span>
              <h2>Edit Bbox Class</h2>
              <form className="form">
                <div className="form-group">
                  <label htmlFor="edit-bbox-class-name">Name:</label>
                  <input
                    type="text"
                    id="edit-bbox-class-name"
                    value={editingClass.name}
                    onChange={(e) => setEditingClass({ ...editingClass, name: e.target.value })}
                    required
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="edit-bbox-class-description">Description:</label>
                  <textarea
                    id="edit-bbox-class-description"
                    rows="2"
                    value={editingClass.description}
                    onChange={(e) => setEditingClass({ ...editingClass, description: e.target.value })}
                  ></textarea>
                </div>
                <div className="form-group">
                  <label htmlFor="edit-bbox-class-color">Color:</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input
                      type="color"
                      id="edit-bbox-class-color"
                      value={editingClass.color}
                      onChange={(e) => setEditingClass({ ...editingClass, color: e.target.value })}
                      style={{ width: 40, height: 32, padding: 0, border: '1px solid #ccc', cursor: 'pointer' }}
                    />
                    <span style={{ fontSize: '0.85rem', color: '#666' }}>
                      {editingClass.color}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleEditClass}
                  disabled={actionLoading}
                >
                  Update Bbox Class
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default BBoxClassManager;
