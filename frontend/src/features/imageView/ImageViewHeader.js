import React from 'react';

export default function ImageViewHeader({
  currentUser,
  filename,
  onBack,
  onCopySessionLink,
}) {
  return (
    <header className="view-header-compact">
      <div className="view-header-content">
        <div className="view-header-actions">
          <button
            className="btn btn-secondary btn-small"
            onClick={onBack}
          >
            ← Back
          </button>
          <button
            className="btn btn-secondary btn-small"
            onClick={onCopySessionLink}
          >
            Copy link
          </button>
        </div>
        <span className="view-filename">{filename}</span>
        {currentUser && (
          <span className="view-user-info">{currentUser.email}</span>
        )}
      </div>
    </header>
  );
}
