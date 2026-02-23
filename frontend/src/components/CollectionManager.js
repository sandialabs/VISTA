import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

const PURPOSE_LABELS = {
  labeling: 'Labeling',
  review: 'Review',
  inspection: 'Inspection',
};

const PHASE_LABELS = {
  draft: 'Draft',
  annotating: 'Annotating',
  review: 'Review',
  certified: 'Certified',
};

function CollectionManager({ projectId }) {
  const navigate = useNavigate();
  const [collections, setCollections] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newPurpose, setNewPurpose] = useState('labeling');
  const [error, setError] = useState(null);

  const fetchCollections = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await fetch(`/api/projects/${projectId}/collections`);
      if (resp.ok) {
        const data = await resp.json();
        setCollections(data.collections || []);
        setTotal(data.total || 0);
      }
    } catch (err) {
      console.error('Failed to fetch collections:', err);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchCollections();
  }, [fetchCollections]);

  const handleCreate = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      const resp = await fetch(`/api/projects/${projectId}/collections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName,
          description: newDescription || null,
          purpose: newPurpose,
        }),
      });
      if (resp.ok) {
        setShowCreate(false);
        setNewName('');
        setNewDescription('');
        setNewPurpose('labeling');
        fetchCollections();
      } else {
        const errData = await resp.json();
        setError(errData.detail || 'Failed to create collection');
      }
    } catch (err) {
      setError('Failed to create collection');
    }
  };

  const handleDelete = async (collectionId) => {
    if (!window.confirm('Delete this collection? This cannot be undone.')) return;
    try {
      const resp = await fetch(`/api/collections/${collectionId}`, {
        method: 'DELETE',
      });
      if (resp.ok || resp.status === 204) {
        fetchCollections();
      }
    } catch (err) {
      console.error('Failed to delete collection:', err);
    }
  };

  return (
    <div className="collection-manager">
      <div className="collection-manager-header">
        <h2>Collections ({total})</h2>
        <button
          className="btn btn-primary"
          onClick={() => setShowCreate(!showCreate)}
        >
          {showCreate ? 'Cancel' : 'New Collection'}
        </button>
      </div>

      {showCreate && (
        <form className="collection-create-form" onSubmit={handleCreate}>
          <div className="form-group">
            <label>Name *</label>
            <input
              type="text"
              className="form-control"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Collection name"
              required
            />
          </div>
          <div className="form-group">
            <label>Description</label>
            <textarea
              className="form-control"
              value={newDescription}
              onChange={e => setNewDescription(e.target.value)}
              placeholder="Optional description"
              rows={2}
            />
          </div>
          <div className="form-group">
            <label>Purpose</label>
            <select
              className="form-control"
              value={newPurpose}
              onChange={e => setNewPurpose(e.target.value)}
            >
              <option value="labeling">Labeling</option>
              <option value="review">Review</option>
              <option value="inspection">Inspection</option>
            </select>
          </div>
          {error && <div className="alert alert-error">{error}</div>}
          <button type="submit" className="btn btn-success">Create</button>
        </form>
      )}

      {loading && <div className="loading-text">Loading collections...</div>}

      {!loading && collections.length === 0 && !showCreate && (
        <div className="collection-empty">
          <p>No collections yet. Create one to organize your images.</p>
        </div>
      )}

      <div className="collection-grid">
        {collections.map(coll => (
          <div
            key={coll.id}
            className="collection-card"
            onClick={() => navigate(`/project/${projectId}/collections/${coll.id}`)}
          >
            <div className="collection-card-header">
              <h3 className="collection-card-title">{coll.name}</h3>
              <span className={`phase-badge phase-${coll.phase}`}>
                {PHASE_LABELS[coll.phase]}
              </span>
            </div>
            <div className="collection-card-body">
              <p className="collection-card-desc">
                {coll.description || 'No description'}
              </p>
              <div className="collection-card-meta">
                <span className={`purpose-badge purpose-${coll.purpose}`}>
                  {PURPOSE_LABELS[coll.purpose]}
                </span>
                <span className="collection-image-count">
                  {coll.image_count} images
                </span>
              </div>
            </div>
            {coll.phase === 'draft' && (
              <div className="collection-card-actions">
                <button
                  className="btn btn-small btn-danger"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(coll.id);
                  }}
                >
                  Delete
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default CollectionManager;
