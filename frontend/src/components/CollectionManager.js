import React, { useState, useEffect, useCallback } from 'react';

/**
 * CollectionManager
 * Project-level collection management. Lists, creates, edits, deletes collections.
 * Supports lock/unlock and review-required toggles.
 */
function CollectionManager({ projectId }) {
  const [collections, setCollections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [newCollection, setNewCollection] = useState({ name: '', description: '' });
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingCollection, setEditingCollection] = useState({ id: '', name: '', description: '' });
  const [lockReasonInput, setLockReasonInput] = useState({});

  const loadCollections = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/projects/${projectId}/collections`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      setCollections(data);
    } catch (err) {
      console.error('Failed to load collections:', err);
      setError('Failed to load collections');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadCollections();
  }, [loadCollections]);

  const handleCreate = async () => {
    if (newCollection.name.trim() === '') {
      setError('Collection name cannot be empty');
      return;
    }
    try {
      setActionLoading(true);
      const response = await fetch(`/api/projects/${projectId}/collections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newCollection.name,
          description: newCollection.description,
        }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      setCollections(prev => [...prev, data]);
      setNewCollection({ name: '', description: '' });
      setError(null);
    } catch (err) {
      setError(`Failed to create collection: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleEdit = async () => {
    try {
      setActionLoading(true);
      const response = await fetch(`/api/collections/${editingCollection.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editingCollection.name,
          description: editingCollection.description,
        }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      setCollections(prev =>
        prev.map(c => c.id === editingCollection.id ? data : c)
      );
      setShowEditModal(false);
      setError(null);
    } catch (err) {
      setError(`Failed to update collection: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async (id, name) => {
    if (!window.confirm(`Are you sure you want to delete the collection "${name}"?`)) return;
    try {
      setActionLoading(true);
      const response = await fetch(`/api/collections/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setCollections(prev => prev.filter(c => c.id !== id));
      setError(null);
    } catch (err) {
      setError(`Failed to delete collection: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleLock = async (id) => {
    const reason = lockReasonInput[id] || '';
    try {
      setActionLoading(true);
      const response = await fetch(`/api/collections/${id}/lock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      setCollections(prev => prev.map(c => c.id === id ? data : c));
      setLockReasonInput(prev => { const n = { ...prev }; delete n[id]; return n; });
    } catch (err) {
      setError(`Failed to lock collection: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleUnlock = async (id) => {
    try {
      setActionLoading(true);
      const response = await fetch(`/api/collections/${id}/unlock`, {
        method: 'POST',
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      setCollections(prev => prev.map(c => c.id === id ? data : c));
    } catch (err) {
      setError(`Failed to unlock collection: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleToggleReviewRequired = async (id, current) => {
    try {
      setActionLoading(true);
      const response = await fetch(`/api/collections/${id}/review-required`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ review_required: !current }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      setCollections(prev => prev.map(c => c.id === id ? data : c));
    } catch (err) {
      setError(`Failed to toggle review required: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="card">
      <div className="card-header">
        <h2>Collections</h2>
      </div>
      <div className="card-content">
        {error && (
          <div style={{
            padding: '0.4rem 0.6rem',
            marginBottom: '0.5rem',
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: '4px',
            fontSize: '0.85rem',
            color: '#dc2626',
          }}>
            {error}
            <button onClick={() => setError(null)} style={{
              float: 'right', background: 'none', border: 'none',
              cursor: 'pointer', color: '#dc2626',
            }}>x</button>
          </div>
        )}

        {(loading || actionLoading) && <p>Loading collections...</p>}

        {!loading && collections.length === 0 && (
          <p>No collections yet. Create one to organize annotations.</p>
        )}

        {!loading && collections.length > 0 && (
          <ul className="class-list">
            {collections.map(col => (
              <li key={col.id} className="class-item" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div className="class-info">
                    <h4 style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {col.name}
                      {col.is_locked && (
                        <span style={{
                          fontSize: '0.7rem', padding: '1px 6px', borderRadius: 10,
                          background: '#fef3c7', color: '#92400e', fontWeight: 600,
                        }}>Locked</span>
                      )}
                      {col.review_required && (
                        <span style={{
                          fontSize: '0.7rem', padding: '1px 6px', borderRadius: 10,
                          background: '#dbeafe', color: '#1e40af', fontWeight: 600,
                        }}>Review Required</span>
                      )}
                    </h4>
                    <p>{col.description || 'No description'}</p>
                    <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                      {col.image_count != null ? `${col.image_count} images` : ''}
                    </span>
                  </div>
                  <div className="class-actions" style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                    <button
                      className="btn btn-small"
                      onClick={() => {
                        setEditingCollection({
                          id: col.id,
                          name: col.name,
                          description: col.description || '',
                        });
                        setShowEditModal(true);
                      }}
                    >
                      Edit
                    </button>
                    <button
                      className="btn btn-small btn-danger"
                      onClick={() => handleDelete(col.id, col.name)}
                    >
                      Delete
                    </button>
                    <button
                      className="btn btn-small"
                      onClick={() => handleToggleReviewRequired(col.id, col.review_required)}
                    >
                      {col.review_required ? 'Unrequire Review' : 'Require Review'}
                    </button>
                  </div>
                </div>
                {/* Lock/unlock controls */}
                <div style={{ marginTop: '4px', display: 'flex', gap: '4px', alignItems: 'center' }}>
                  {col.is_locked ? (
                    <button
                      className="btn btn-small btn-secondary"
                      onClick={() => handleUnlock(col.id)}
                      disabled={actionLoading}
                    >
                      Unlock
                    </button>
                  ) : (
                    <>
                      <input
                        type="text"
                        placeholder="Lock reason (optional)"
                        value={lockReasonInput[col.id] || ''}
                        onChange={(e) => setLockReasonInput(prev => ({ ...prev, [col.id]: e.target.value }))}
                        style={{ fontSize: '0.8rem', padding: '2px 6px', flex: 1 }}
                      />
                      <button
                        className="btn btn-small btn-secondary"
                        onClick={() => handleLock(col.id)}
                        disabled={actionLoading}
                      >
                        Lock
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="form" style={{ marginTop: '1rem' }}>
          <h3>Add Collection</h3>
          <div className="form-group">
            <label htmlFor="collection-name">Name:</label>
            <input
              type="text"
              id="collection-name"
              value={newCollection.name}
              onChange={(e) => setNewCollection({ ...newCollection, name: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleCreate(); } }}
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="collection-description">Description:</label>
            <textarea
              id="collection-description"
              rows="2"
              value={newCollection.description}
              onChange={(e) => setNewCollection({ ...newCollection, description: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleCreate(); } }}
            ></textarea>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={actionLoading}
            onClick={(e) => { e.preventDefault(); handleCreate(); }}
          >
            Add Collection
          </button>
        </div>

        {/* Edit modal */}
        {showEditModal && (
          <div className="modal">
            <div className="modal-content">
              <span className="close-modal" onClick={() => setShowEditModal(false)}>&times;</span>
              <h2>Edit Collection</h2>
              <form className="form">
                <div className="form-group">
                  <label htmlFor="edit-collection-name">Name:</label>
                  <input
                    type="text"
                    id="edit-collection-name"
                    value={editingCollection.name}
                    onChange={(e) => setEditingCollection({ ...editingCollection, name: e.target.value })}
                    required
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="edit-collection-description">Description:</label>
                  <textarea
                    id="edit-collection-description"
                    rows="2"
                    value={editingCollection.description}
                    onChange={(e) => setEditingCollection({ ...editingCollection, description: e.target.value })}
                  ></textarea>
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleEdit}
                  disabled={actionLoading}
                >
                  Update Collection
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default CollectionManager;
