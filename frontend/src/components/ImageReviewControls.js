import React, { useState, useEffect } from 'react';

function ImageReviewControls({ collectionId, imageId, collectionPhase }) {
  const [review, setReview] = useState(null);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!collectionId || !imageId || collectionPhase !== 'review') return;
    fetch(`/api/collections/${collectionId}/images/${imageId}/review`)
      .then(resp => resp.ok ? resp.json() : null)
      .then(data => { if (data) setReview(data); })
      .catch(err => console.error('Failed to fetch image review:', err));
  }, [collectionId, imageId, collectionPhase]);

  if (collectionPhase !== 'review') return null;

  const handleReview = async (status) => {
    setLoading(true);
    try {
      const resp = await fetch(
        `/api/collections/${collectionId}/images/${imageId}/review`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status, notes: notes || null }),
        }
      );
      if (resp.ok) {
        const data = await resp.json();
        setReview(data);
        setNotes('');
      }
    } catch (err) {
      console.error('Failed to submit image review:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="image-review-controls">
      <h4 className="image-review-title">Image Review</h4>
      {review && (
        <div className="image-review-current">
          <span className={`review-status-badge status-${review.status}`}>
            {review.status}
          </span>
          {review.notes && <p className="image-review-notes">{review.notes}</p>}
        </div>
      )}
      <input
        type="text"
        className="form-control image-review-notes-input"
        placeholder="Review notes (optional)"
        value={notes}
        onChange={e => setNotes(e.target.value)}
      />
      <div className="image-review-actions">
        <button
          className="btn btn-success btn-small"
          onClick={() => handleReview('reviewed')}
          disabled={loading}
        >
          Mark Reviewed
        </button>
        <button
          className="btn btn-warning btn-small"
          onClick={() => handleReview('flagged')}
          disabled={loading}
        >
          Flag
        </button>
      </div>
    </div>
  );
}

export default ImageReviewControls;
