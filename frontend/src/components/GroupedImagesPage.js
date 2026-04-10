import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

const PAGE_SIZE = 200;

function GroupedImagesPage({ projectId, projectName, onBack, search }) {
  const navigate = useNavigate();
  const [groups, setGroups] = useState([]);
  const [total, setTotal] = useState(0);
  const [ungroupedCount, setUngroupedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [debouncedSearch, setDebouncedSearch] = useState(search || '');

  // Debounce the search prop
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search || ''), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const fetchGroups = useCallback(async (searchVal) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), skip: '0' });
      if (searchVal) params.set('search', searchVal);
      const resp = await fetch(`/api/projects/${projectId}/groups?${params}`);
      if (!resp.ok) throw new Error(`HTTP error ${resp.status}`);
      const data = await resp.json();
      setGroups(data.groups || []);
      setTotal(data.total || 0);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const loadMore = useCallback(async () => {
    setLoadingMore(true);
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        skip: String(groups.length),
      });
      if (debouncedSearch) params.set('search', debouncedSearch);
      const resp = await fetch(`/api/projects/${projectId}/groups?${params}`);
      if (!resp.ok) throw new Error(`HTTP error ${resp.status}`);
      const data = await resp.json();
      setGroups(prev => [...prev, ...(data.groups || [])]);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingMore(false);
    }
  }, [projectId, groups.length, debouncedSearch]);

  const fetchUngroupedCount = useCallback(async () => {
    try {
      const countResp = await fetch(`/api/projects/${projectId}/ungrouped-count`);
      if (countResp.ok) {
        const data = await countResp.json();
        setUngroupedCount(data.count || 0);
      }
    } catch (_) {}
  }, [projectId]);

  useEffect(() => {
    fetchGroups(debouncedSearch);
    fetchUngroupedCount();
  }, [debouncedSearch, fetchGroups, fetchUngroupedCount]);

  const handleGroupClick = (group) => {
    navigate(`/project/${projectId}/group/${group.id}`, {
      state: { groupIdentifier: group.identifier, groupId: group.id },
    });
  };

  const handleUngroupedClick = () => {
    navigate(`/project/${projectId}/ungrouped`);
  };

  const [deletingGroupId, setDeletingGroupId] = useState(null);

  const handleDeleteGroup = async (e, group) => {
    e.stopPropagation();
    if (!window.confirm(`Delete empty group "${group.display_name || group.identifier}"?`)) {
      return;
    }
    setDeletingGroupId(group.id);
    try {
      const resp = await fetch(`/api/groups/${group.id}`, { method: 'DELETE' });
      if (!resp.ok) throw new Error(`HTTP error ${resp.status}`);
      setGroups(prev => prev.filter(g => g.id !== group.id));
      setTotal(prev => prev - 1);
    } catch (err) {
      setError(`Failed to delete group: ${err.message}`);
    } finally {
      setDeletingGroupId(null);
    }
  };

  const statusLabel = (status) => {
    if (!status) return null;
    const map = {
      reject_confirmed: 'Rejected',
      reject_pending: 'Reject Pending',
      pass: 'Pass',
    };
    return map[status] || status;
  };

  return (
    <div className="grouped-images-page">
      {error && (
        <div className="alert alert-error">
          <strong>Error:</strong> {error}
        </div>
      )}

      {loading ? (
        <div className="gallery-loading">
          <div className="spinner"></div>
          <p>Loading groups...</p>
        </div>
      ) : (
        <div className="group-list">
          {groups.map((group) => (
            <div
              key={group.id}
              className="group-row"
              onClick={() => handleGroupClick(group)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && handleGroupClick(group)}
            >
              <div className="group-row-name">
                {group.display_name || group.identifier}
                {group.display_name && group.display_name !== group.identifier && (
                  <span className="group-row-identifier">{group.identifier}</span>
                )}
              </div>
              <div className="group-row-meta">
                {group.aggregate_review_status && (
                  <span className={`group-status-badge group-status-${group.aggregate_review_status}`}>
                    {statusLabel(group.aggregate_review_status)}
                  </span>
                )}
                <span className="group-row-count">
                  {group.image_count} {group.image_count === 1 ? 'image' : 'images'}
                </span>
                {group.image_count === 0 && (
                  <button
                    className="btn btn-small btn-danger"
                    disabled={deletingGroupId === group.id}
                    onClick={(e) => handleDeleteGroup(e, group)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.stopPropagation();
                        e.preventDefault();
                      }
                    }}
                  >
                    {deletingGroupId === group.id ? 'Deleting...' : 'Delete'}
                  </button>
                )}
                <span className="group-row-arrow">&#8250;</span>
              </div>
            </div>
          ))}

          {groups.length < total && (
            <div style={{ textAlign: 'center', padding: '12px 0' }}>
              <button
                className="btn btn-secondary"
                onClick={loadMore}
                disabled={loadingMore}
              >
                {loadingMore ? 'Loading...' : `Load more (${groups.length} of ${total})`}
              </button>
            </div>
          )}

          {ungroupedCount > 0 && (
            <div
              className="group-row group-row-ungrouped"
              onClick={handleUngroupedClick}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && handleUngroupedClick()}
            >
              <div className="group-row-name">Ungrouped</div>
              <div className="group-row-meta">
                <span className="group-row-count">
                  {ungroupedCount} {ungroupedCount === 1 ? 'image' : 'images'}
                </span>
                <span className="group-row-arrow">&#8250;</span>
              </div>
            </div>
          )}

          {groups.length === 0 && ungroupedCount === 0 && (
            <div className="gallery-empty">
              <h3>No groups yet</h3>
              <p>Upload images with a group identifier to create groups.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default GroupedImagesPage;
