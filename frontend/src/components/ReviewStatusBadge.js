import React from 'react';

const STATUS_CONFIG = {
  unreviewed: { label: '--', color: '#94a3b8', bg: '#f1f5f9' },
  pass: { label: 'Pass', color: '#fff', bg: '#16a34a' },
  reject_pending: { label: 'Reject Pending', color: '#fff', bg: '#f59e0b' },
  reject_confirmed: { label: 'Rejected', color: '#fff', bg: '#dc2626' },
};

function ReviewStatusBadge({ status, size = 'small' }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.unreviewed;
  if (status === 'unreviewed') return null;

  const isSmall = size === 'small';

  return (
    <span
      className="review-status-badge"
      style={{
        display: 'inline-block',
        padding: isSmall ? '1px 6px' : '2px 8px',
        borderRadius: '10px',
        fontSize: isSmall ? '0.65rem' : '0.75rem',
        fontWeight: 600,
        color: config.color,
        backgroundColor: config.bg,
        lineHeight: 1.4,
        whiteSpace: 'nowrap',
      }}
      title={`Review status: ${config.label}`}
    >
      {config.label}
    </span>
  );
}

export default ReviewStatusBadge;
