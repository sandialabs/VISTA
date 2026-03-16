import React, { useState, useEffect, useCallback } from 'react';

// Map backend action values to display labels
const ACTION_LABELS = {
  approve: 'Approved',
  reject: 'Rejected',
  flag_revision: 'Flagged',
};

const ACTION_COLORS = {
  approve: '#16a34a',
  reject: '#dc2626',
  flag_revision: '#f59e0b',
};

/**
 * AnnotationReviewControls
 * Inline review controls for a selected annotation.
 * Shows approve/reject/flag buttons, comment field, and review history.
 */
function AnnotationReviewControls({ annotationId, onReviewComplete }) {
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [comment, setComment] = useState('');
  const [showHistory, setShowHistory] = useState(false);

  const loadReviews = useCallback(async () => {
    if (!annotationId) return;
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(`/api/user-annotations/${annotationId}/reviews`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      setReviews(data);
    } catch (err) {
      console.error('Failed to load annotation reviews:', err);
      setError('Failed to load reviews');
    } finally {
      setLoading(false);
    }
  }, [annotationId]);

  useEffect(() => {
    loadReviews();
  }, [loadReviews]);

  const submitReview = async (action) => {
    try {
      setSubmitting(true);
      setError(null);
      const response = await fetch(`/api/user-annotations/${annotationId}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          comment: comment.trim() || null,
        }),
      });
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Review failed (${response.status}): ${detail}`);
      }
      setComment('');
      await loadReviews();
      if (onReviewComplete) onReviewComplete();
    } catch (err) {
      console.error('Failed to submit review:', err);
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const currentAction = reviews.length > 0 ? reviews[0].action : null;
  const statusColor = currentAction ? (ACTION_COLORS[currentAction] || '#94a3b8') : '#94a3b8';
  const statusLabel = currentAction ? (ACTION_LABELS[currentAction] || currentAction) : 'Not reviewed';

  return (
    <div style={{
      background: 'var(--bg-primary, #ffffff)',
      borderRadius: 'var(--radius-md, 8px)',
      border: '1px solid var(--border-light, #e2e8f0)',
      padding: '0.75rem',
      marginBottom: '0.75rem',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '0.5rem',
      }}>
        <h4 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 600 }}>
          Annotation Review
        </h4>
        <span style={{
          display: 'inline-block',
          padding: '2px 8px',
          borderRadius: '12px',
          fontSize: '0.75rem',
          fontWeight: 600,
          color: '#fff',
          backgroundColor: statusColor,
        }}>
          {loading ? '...' : statusLabel}
        </span>
      </div>

      {error && (
        <div style={{
          padding: '0.4rem 0.6rem',
          marginBottom: '0.5rem',
          background: '#fef2f2',
          border: '1px solid #fecaca',
          borderRadius: '4px',
          fontSize: '0.8rem',
          color: '#dc2626',
        }}>
          {error}
          <button
            onClick={() => setError(null)}
            style={{
              float: 'right', background: 'none', border: 'none',
              cursor: 'pointer', fontSize: '0.9rem', color: '#dc2626',
            }}
            aria-label="Dismiss error"
          >x</button>
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.5rem' }}>
        {['approve', 'reject', 'flag_revision'].map(action => (
          <button
            key={action}
            onClick={() => submitReview(action)}
            disabled={submitting || loading}
            style={{
              flex: 1,
              padding: '0.4rem 0.5rem',
              border: currentAction === action
                ? `2px solid ${ACTION_COLORS[action]}`
                : '1px solid var(--border-light, #e2e8f0)',
              borderRadius: 'var(--radius-sm, 6px)',
              background: currentAction === action ? `${ACTION_COLORS[action]}10` : 'var(--bg-secondary, #f8fafc)',
              color: ACTION_COLORS[action],
              fontWeight: 600,
              fontSize: '0.8rem',
              cursor: submitting ? 'wait' : 'pointer',
              transition: 'all 150ms',
            }}
          >
            {ACTION_LABELS[action]}
          </button>
        ))}
      </div>

      {/* Comment field */}
      <div style={{ marginBottom: '0.5rem' }}>
        <input
          type="text"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Add a review comment..."
          style={{
            width: '100%',
            padding: '0.3rem 0.5rem',
            fontSize: '0.8rem',
            border: '1px solid var(--border-light, #e2e8f0)',
            borderRadius: '4px',
            boxSizing: 'border-box',
          }}
        />
      </div>

      {/* Review history */}
      {reviews.length > 0 && (
        <div>
          <button
            onClick={() => setShowHistory(!showHistory)}
            style={{
              background: 'none', border: 'none',
              color: 'var(--primary-color, #2563eb)',
              fontSize: '0.8rem', cursor: 'pointer',
              padding: 0, textDecoration: 'underline',
            }}
          >
            {showHistory ? 'Hide' : 'Show'} review history ({reviews.length})
          </button>

          {showHistory && (
            <div style={{ marginTop: '0.4rem', maxHeight: '120px', overflowY: 'auto' }}>
              {reviews.map((review) => (
                <div key={review.id} style={{
                  padding: '0.3rem 0.5rem',
                  borderBottom: '1px solid var(--border-light, #e2e8f0)',
                  fontSize: '0.75rem',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{
                      fontWeight: 600,
                      color: ACTION_COLORS[review.action] || '#94a3b8',
                    }}>
                      {ACTION_LABELS[review.action] || review.action}
                    </span>
                    <span style={{ color: 'var(--gray-400, #94a3b8)' }}>
                      {new Date(review.created_at).toLocaleString()}
                    </span>
                  </div>
                  <div style={{ color: 'var(--gray-500, #64748b)', marginTop: '2px' }}>
                    By: {review.reviewer_id ? String(review.reviewer_id).slice(0, 8) : 'Unknown'}
                  </div>
                  {review.comment && (
                    <div style={{ color: 'var(--gray-600, #475569)', marginTop: '2px' }}>
                      {review.comment}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default AnnotationReviewControls;
