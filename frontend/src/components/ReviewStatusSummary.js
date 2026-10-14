import React, { useState, useEffect, useCallback } from 'react';
import { fetchProjectReviewStatus } from '../api/projects';

function ReviewStatusSummary({ projectId }) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadSummary = useCallback(async () => {
    if (!projectId) return;
    try {
      setLoading(true);
      const data = await fetchProjectReviewStatus(projectId);
      setSummary(data);
    } catch (err) {
      console.error('Failed to load review summary:', err);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  if (loading || !summary) return null;

  const { total_images, reviewed, unreviewed, passed, reject_pending, reject_confirmed } = summary;
  const reviewedPct = total_images > 0 ? Math.round((reviewed / total_images) * 100) : 0;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '1rem',
      padding: '0.6rem 1rem',
      background: 'var(--bg-primary, #fff)',
      border: '1px solid var(--border-light, #e2e8f0)',
      borderRadius: 'var(--radius-md, 8px)',
      flexWrap: 'wrap',
      fontSize: '0.85rem',
    }}>
      <span style={{ fontWeight: 600 }}>Review Progress</span>

      {/* Progress bar */}
      <div style={{
        flex: '1 1 120px',
        maxWidth: '200px',
        height: '8px',
        background: '#e2e8f0',
        borderRadius: '4px',
        overflow: 'hidden',
      }}>
        <div style={{
          width: `${reviewedPct}%`,
          height: '100%',
          background: '#16a34a',
          transition: 'width 300ms',
        }} />
      </div>
      <span style={{ color: 'var(--gray-500, #64748b)' }}>
        {reviewed}/{total_images} reviewed ({reviewedPct}%)
      </span>

      <div style={{ display: 'flex', gap: '0.75rem' }}>
        <StatChip label="Unreviewed" count={unreviewed} color="#94a3b8" />
        <StatChip label="Pass" count={passed} color="#16a34a" />
        <StatChip label="Reject (Pending)" count={reject_pending} color="#f59e0b" />
        <StatChip label="Rejected" count={reject_confirmed} color="#dc2626" />
      </div>
    </div>
  );
}

function StatChip({ label, count, color }) {
  if (count === 0) return null;
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '4px',
      fontSize: '0.8rem',
    }}>
      <span style={{
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        background: color,
        display: 'inline-block',
      }} />
      <span style={{ color: 'var(--gray-600, #475569)' }}>{label}:</span>
      <span style={{ fontWeight: 600 }}>{count}</span>
    </span>
  );
}

export default ReviewStatusSummary;
