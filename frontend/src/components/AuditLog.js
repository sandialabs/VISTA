import React, { useState, useEffect } from 'react';

function AuditLog({ projectId }) {
  const [events, setEvents] = useState([]);
  const [total, setTotal] = useState(0);
  const [entityTypeFilter, setEntityTypeFilter] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    let url = `/api/projects/${projectId}/audit-events?limit=50`;
    if (entityTypeFilter) url += `&entity_type=${entityTypeFilter}`;
    fetch(url)
      .then(resp => resp.ok ? resp.json() : { events: [], total: 0 })
      .then(data => {
        setEvents(data.events || []);
        setTotal(data.total || 0);
      })
      .catch(err => console.error('Failed to fetch audit events:', err))
      .finally(() => setLoading(false));
  }, [projectId, entityTypeFilter]);

  return (
    <div className="audit-log">
      <div className="audit-log-header">
        <h3 className="audit-log-title">Audit Log</h3>
        <select
          className="form-control audit-log-filter"
          value={entityTypeFilter}
          onChange={e => setEntityTypeFilter(e.target.value)}
        >
          <option value="">All Events</option>
          <option value="collection">Collections</option>
          <option value="annotation">Annotations</option>
          <option value="image_review">Image Reviews</option>
        </select>
      </div>
      {loading && <div className="loading-text">Loading audit events...</div>}
      {!loading && events.length === 0 && (
        <p className="audit-log-empty">No audit events found.</p>
      )}
      {!loading && events.length > 0 && (
        <div className="audit-log-table-wrapper">
          <table className="audit-log-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Action</th>
                <th>Entity</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {events.map(event => (
                <tr key={event.id}>
                  <td className="audit-time">
                    {new Date(event.created_at).toLocaleString()}
                  </td>
                  <td className="audit-action">{event.action}</td>
                  <td className="audit-entity">
                    {event.entity_type}
                  </td>
                  <td className="audit-details">
                    {event.details ? JSON.stringify(event.details) : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {total > events.length && (
            <p className="audit-log-more">
              Showing {events.length} of {total} events
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default AuditLog;
