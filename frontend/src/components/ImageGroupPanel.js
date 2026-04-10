import React, { useState, useEffect } from 'react';

/**
 * ImageGroupPanel - shows and allows editing the group assignment for an image.
 *
 * Props:
 *   imageId    - the image's UUID
 *   projectId  - the project's UUID
 *   groupId    - current group_id (may be null)
 *   onGroupChanged - called when the group assignment changes
 */
function ImageGroupPanel({ imageId, projectId, groupId, onGroupChanged, readOnly = false }) {
  const [groups, setGroups] = useState([]);
  const [currentGroup, setCurrentGroup] = useState(null);
  const [editing, setEditing] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState(groupId || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Fetch available groups for the project.
  // Limit is set to 500 which covers most practical cases; projects with
  // hundreds of groups should consider adding server-side search/pagination here.
  useEffect(() => {
    if (!projectId) return;
    fetch(`/api/projects/${projectId}/groups?limit=500`)
      .then(r => r.ok ? r.json() : { groups: [] })
      .then(data => setGroups(data.groups || []))
      .catch(() => {});
  }, [projectId]);

  // Resolve current group name
  useEffect(() => {
    if (groupId) {
      fetch(`/api/groups/${groupId}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => setCurrentGroup(data))
        .catch(() => {});
    } else {
      setCurrentGroup(null);
    }
    setSelectedGroupId(groupId || '');
  }, [groupId]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      if (selectedGroupId) {
        // Assign image to group
        const resp = await fetch(`/api/groups/${selectedGroupId}/images`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify([imageId]),
        });
        if (!resp.ok) throw new Error(`HTTP error ${resp.status}`);
      } else if (groupId) {
        // Remove from current group
        const resp = await fetch(`/api/groups/${groupId}/images`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify([imageId]),
        });
        if (!resp.ok) throw new Error(`HTTP error ${resp.status}`);
      }
      setEditing(false);
      if (onGroupChanged) onGroupChanged(selectedGroupId || null);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card" style={{ marginBottom: '16px' }}>
      <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: '0.95rem' }}>Group Assignment</h3>
        {!editing && !readOnly && (
          <button
            className="btn btn-secondary"
            style={{ fontSize: '0.8rem', padding: '2px 8px' }}
            onClick={() => setEditing(true)}
          >
            Edit
          </button>
        )}
      </div>
      <div className="card-content">
        {error && <div className="alert alert-error" style={{ marginBottom: '8px' }}>{error}</div>}
        {!editing ? (
          <div>
            {currentGroup ? (
              <span className="group-badge">
                {currentGroup.display_name || currentGroup.identifier}
              </span>
            ) : (
              <span style={{ color: '#888', fontStyle: 'italic' }}>Not assigned to any group</span>
            )}
          </div>
        ) : (
          <div>
            <select
              value={selectedGroupId}
              onChange={(e) => setSelectedGroupId(e.target.value)}
              className="form-control"
              style={{ marginBottom: '8px' }}
            >
              <option value="">-- None (ungrouped) --</option>
              {groups.map(g => (
                <option key={g.id} value={g.id}>
                  {g.display_name || g.identifier}
                </option>
              ))}
            </select>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                className="btn btn-primary"
                style={{ fontSize: '0.85rem' }}
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
              <button
                className="btn btn-secondary"
                style={{ fontSize: '0.85rem' }}
                onClick={() => { setEditing(false); setSelectedGroupId(groupId || ''); setError(null); }}
                disabled={saving}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default ImageGroupPanel;
