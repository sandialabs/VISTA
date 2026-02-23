import React, { useState } from 'react';

function AnnotationReviewControls({ annotation, onReviewSubmit }) {
  const [comment, setComment] = useState('');

  if (!annotation) return null;

  const handleReview = async (status) => {
    try {
      const resp = await fetch(`/api/annotations/${annotation.id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          review_status: status,
          review_comment: comment || null,
        }),
      });
      if (resp.ok) {
        const updated = await resp.json();
        if (onReviewSubmit) onReviewSubmit(updated);
        setComment('');
      }
    } catch (err) {
      console.error('Failed to review annotation:', err);
    }
  };

  const statusClass = {
    pending: 'status-pending',
    approved: 'status-approved',
    rejected: 'status-rejected',
    flagged: 'status-flagged',
  }[annotation.review_status] || '';

  return (
    <div className="annotation-review-controls">
      <div className="annotation-review-status">
        <span className={`review-status-badge ${statusClass}`}>
          {annotation.review_status}
        </span>
      </div>
      <input
        type="text"
        className="form-control annotation-review-comment"
        placeholder="Review comment (optional)"
        value={comment}
        onChange={e => setComment(e.target.value)}
      />
      <div className="annotation-review-actions">
        <button
          className="btn btn-small btn-success"
          onClick={() => handleReview('approved')}
          title="Approve"
        >
          Approve
        </button>
        <button
          className="btn btn-small btn-danger"
          onClick={() => handleReview('rejected')}
          title="Reject"
        >
          Reject
        </button>
        <button
          className="btn btn-small btn-warning"
          onClick={() => handleReview('flagged')}
          title="Flag for review"
        >
          Flag
        </button>
      </div>
    </div>
  );
}

export default AnnotationReviewControls;
