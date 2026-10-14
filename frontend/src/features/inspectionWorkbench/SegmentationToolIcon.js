export function SegmentationToolIcon({ icon }) {
  const commonProps = {
    className: 'segmentation-tool-icon',
    viewBox: '0 0 24 24',
    'aria-hidden': 'true',
    focusable: 'false',
  };
  if (icon === 'brush') {
    return (
      <svg {...commonProps}>
        <path d="M15.5 3.5l5 5-8.4 8.4-5-5 8.4-8.4z" />
        <path d="M7.1 11.9c-2.1 1-3.2 2.7-3.2 5.2 1.8-.1 3.5-.5 5.1-1.3" />
      </svg>
    );
  }
  if (icon === 'eraser') {
    return (
      <svg {...commonProps}>
        <path d="M4 15l8.6-8.6a2 2 0 0 1 2.8 0l4.2 4.2a2 2 0 0 1 0 2.8L13 20H8.8L4 15z" />
        <path d="M9.5 9.5l5 5" />
        <path d="M13 20h7" />
      </svg>
    );
  }
  if (icon === 'target') {
    return (
      <svg {...commonProps}>
        <circle cx="12" cy="12" r="7" />
        <circle cx="12" cy="12" r="2.4" />
        <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" />
      </svg>
    );
  }
  if (icon === 'polygon') {
    return (
      <svg {...commonProps}>
        <path d="M6 6l10-2 4 9-7 7-9-5 2-9z" />
        <circle cx="6" cy="6" r="1.4" />
        <circle cx="16" cy="4" r="1.4" />
        <circle cx="20" cy="13" r="1.4" />
        <circle cx="13" cy="20" r="1.4" />
      </svg>
    );
  }
  if (icon === 'circle') {
    return (
      <svg {...commonProps}>
        <circle cx="12" cy="12" r="7.5" />
        <circle cx="12" cy="12" r="1.4" />
        <path d="M12 12l5.3-5.3" />
      </svg>
    );
  }
  if (icon === 'rectangle') {
    return (
      <svg {...commonProps}>
        <rect x="5" y="6" width="14" height="12" rx="1" />
        <circle cx="5" cy="6" r="1.3" />
        <circle cx="19" cy="18" r="1.3" />
      </svg>
    );
  }
  if (icon === 'threshold') {
    return (
      <svg {...commonProps}>
        <path d="M5 18V6" />
        <path d="M19 18V6" />
        <path d="M5 15c3-5 6-5 9 0 1.4 2.3 3 2.7 5 0" />
        <path d="M8 9h8" />
      </svg>
    );
  }
  if (icon === 'contour') {
    return (
      <svg {...commonProps}>
        <path d="M4.5 13.5c1.5-6.2 8.4-8.8 13-4.6 3.7 3.4 1 9.7-4.5 9.6-4.2 0-5.4-4.2-2.8-6.1 2-1.5 4.5-.2 4.8 2.1" />
      </svg>
    );
  }
  if (icon === 'scissors') {
    return (
      <svg {...commonProps}>
        <circle cx="6.5" cy="6.5" r="2.3" />
        <circle cx="6.5" cy="17.5" r="2.3" />
        <path d="M8.4 8.4L20 20" />
        <path d="M8.4 15.6L20 4" />
      </svg>
    );
  }
  return (
    <svg {...commonProps}>
      <path d="M12 3l1.7 5.1L19 10l-5.3 1.9L12 17l-1.7-5.1L5 10l5.3-1.9L12 3z" />
      <path d="M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8L18 15z" />
    </svg>
  );
}
