import React from 'react';

function ReviewProgressBar({ progress }) {
  if (!progress) return null;

  const { total_images, reviewed, flagged, unreviewed } = progress;
  const pctReviewed = total_images > 0 ? (reviewed / total_images) * 100 : 0;
  const pctFlagged = total_images > 0 ? (flagged / total_images) * 100 : 0;

  return (
    <div className="review-progress-bar">
      <div className="review-progress-header">
        <span className="review-progress-label">Review Progress</span>
        <span className="review-progress-count">
          {reviewed + flagged} / {total_images} images
        </span>
      </div>
      <div className="review-progress-track">
        <div
          className="review-progress-fill review-progress-reviewed"
          style={{ width: `${pctReviewed}%` }}
        />
        <div
          className="review-progress-fill review-progress-flagged"
          style={{ width: `${pctFlagged}%` }}
        />
      </div>
      <div className="review-progress-legend">
        <span className="review-legend-item">
          <span className="review-legend-dot review-legend-reviewed" />
          Reviewed: {reviewed}
        </span>
        <span className="review-legend-item">
          <span className="review-legend-dot review-legend-flagged" />
          Flagged: {flagged}
        </span>
        <span className="review-legend-item">
          <span className="review-legend-dot review-legend-unreviewed" />
          Pending: {unreviewed}
        </span>
      </div>
      {progress.annotation_total > 0 && (
        <div className="review-annotation-summary">
          Annotations: {progress.annotation_approved} approved,
          {' '}{progress.annotation_pending} pending,
          {' '}{progress.annotation_rejected} rejected,
          {' '}{progress.annotation_flagged} flagged
        </div>
      )}
    </div>
  );
}

export default ReviewProgressBar;
