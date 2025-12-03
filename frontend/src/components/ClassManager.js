import React, { useState } from 'react';

function ClassManager({ projectId, classes, setClasses, loading, setLoading, setError }) {
  // Form states
  const [newClass, setNewClass] = useState({ name: '', description: '' });
  
  // Modal states
  const [showEditClassModal, setShowEditClassModal] = useState(false);
  const [editingClass, setEditingClass] = useState({ id: '', name: '', description: '' });
  // Local action loading state so we don't flip the entire page's loading flag
  const [classActionLoading, setClassActionLoading] = useState(false);

  // Handle add class
  const handleAddClass = async () => {
    
    if (newClass.name.trim() === '') {
      setError('Class name cannot be empty');
      return;
    }
    
    try {
      setClassActionLoading(true);
      
      const response = await fetch(`/api/projects/${projectId}/classes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          project_id: projectId,
          name: newClass.name,
          description: newClass.description,
        }),
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const newClassData = await response.json();
      
      // Update the classes state
      setClasses(prevClasses => [...prevClasses, newClassData]);
      
      // Reset form
      setNewClass({ name: '', description: '' });
      setError(null);
    } catch (err) {
      setError(`Failed to add class: ${err.message}`);
    } finally {
      setClassActionLoading(false);
    }
  };

  // Handle edit class
  const handleEditClass = async () => {
    try {
      setClassActionLoading(true);
      
      const response = await fetch(`/api/classes/${editingClass.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: editingClass.name,
          description: editingClass.description,
        }),
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const updatedClass = await response.json();
      
      // Update the classes state
      setClasses(prevClasses => 
        prevClasses.map(cls => 
          cls.id === editingClass.id ? updatedClass : cls
        )
      );
      
      // Close modal
      setShowEditClassModal(false);
      setError(null);
    } catch (err) {
      setError(`Failed to update class: ${err.message}`);
    } finally {
      setClassActionLoading(false);
    }
  };

  // Handle delete class
  const handleDeleteClass = async (id, name) => {
    if (!window.confirm(`Are you sure you want to delete the class "${name}"?`)) {
      return;
    }
    
    try {
      setClassActionLoading(true);
      
      const response = await fetch(`/api/classes/${id}`, {
        method: 'DELETE',
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      // Update the classes state
      setClasses(prevClasses => prevClasses.filter(cls => cls.id !== id));
      
      setError(null);
    } catch (err) {
      setError(`Failed to delete class: ${err.message}`);
    } finally {
      setClassActionLoading(false);
    }
  };

  return (
    <div className="card">
      <div className="card-header">
        <h2>Image Classes</h2>
      </div>
      <div className="card-content">
        <div id="classes-container">
          {(loading || classActionLoading) && <p>Loading classes...</p>}
          
          {!loading && classes.length === 0 && (
            <p>No classes defined for this project. Add a class to get started.</p>
          )}
          
          {!loading && classes.length > 0 && (
            <ul className="class-list">
              {classes.map(cls => (
                <li key={cls.id} className="class-item">
                  <div className="class-info">
                    <h4>{cls.name}</h4>
                    <p>{cls.description || 'No description'}</p>
                  </div>
                  <div className="class-actions">
                    <button 
                      className="btn btn-small"
                      onClick={() => {
                        setEditingClass({
                          id: cls.id,
                          name: cls.name,
                          description: cls.description || ''
                        });
                        setShowEditClassModal(true);
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
        
        <div id="add-class-form" className="form">
          <h3>Add Class</h3>
          <div className="form-group">
            <label htmlFor="class-name">Name:</label>
            <input 
              type="text" 
              id="class-name" 
              name="class-name" 
              value={newClass.name}
              onChange={(e) => setNewClass({...newClass, name: e.target.value})}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddClass(); } }}
              required 
            />
          </div>
          <div className="form-group">
            <label htmlFor="class-description">Description:</label>
            <textarea 
              id="class-description" 
              name="class-description" 
              rows="2"
              value={newClass.description}
              onChange={(e) => setNewClass({...newClass, description: e.target.value})}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAddClass(); } }}
            ></textarea>
          </div>
          <button 
            type="button" 
            className="btn btn-primary"
            disabled={classActionLoading}
            onClick={(e) => { e.preventDefault(); handleAddClass(); }}
          >
            Add Class
          </button>
        </div>

        {/* Edit class modal */}
        {showEditClassModal && (
          <div className="modal">
            <div className="modal-content">
              <span 
                className="close-modal" 
                onClick={() => setShowEditClassModal(false)}
              >
                &times;
              </span>
              <h2>Edit Class</h2>
              <form id="edit-class-form" className="form">
                <input type="hidden" value={editingClass.id} />
                <div className="form-group">
                  <label htmlFor="edit-class-name">Name:</label>
                  <input 
                    type="text" 
                    id="edit-class-name" 
                    name="edit-class-name" 
                    value={editingClass.name}
                    onChange={(e) => setEditingClass({...editingClass, name: e.target.value})}
                    required 
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="edit-class-description">Description:</label>
                  <textarea 
                    id="edit-class-description" 
                    name="edit-class-description" 
                    rows="2"
                    value={editingClass.description}
                    onChange={(e) => setEditingClass({...editingClass, description: e.target.value})}
                  ></textarea>
                </div>
                <button 
                  type="button" 
                  className="btn btn-primary"
                  onClick={handleEditClass}
                  disabled={classActionLoading}
                >
                  Update Class
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default ClassManager;
