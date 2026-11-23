import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export const TRANSIENT_STATUS_DURATION_MS = 2000;
const EXIT_ANIMATION_MS = 180;

/**
 * Short status message overlaid at the top of the viewport (fixed, so it
 * stays in place while the page scrolls). It takes no layout space and
 * dismisses itself after `duration` ms; clicking it dismisses it early.
 *
 * `message` is controlled by the caller; `onDismiss` must clear it. A new
 * message restarts the timer.
 */
export default function TransientStatusBanner({
  message,
  onDismiss,
  tone = 'success',
  duration = TRANSIENT_STATUS_DURATION_MS,
}) {
  const [leaving, setLeaving] = useState(false);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    if (!message) return undefined;
    setLeaving(false);
    const leaveTimer = window.setTimeout(() => setLeaving(true), Math.max(0, duration - EXIT_ANIMATION_MS));
    const dismissTimer = window.setTimeout(() => onDismissRef.current?.(), duration);
    return () => {
      window.clearTimeout(leaveTimer);
      window.clearTimeout(dismissTimer);
    };
  }, [message, duration]);

  if (!message || typeof document === 'undefined') return null;

  return createPortal(
    <div className="transient-status-layer">
      <div
        className={`transient-status transient-status-${tone}${leaving ? ' is-leaving' : ''}`}
        role="status"
        aria-live="polite"
        data-testid="transient-status"
        onClick={() => onDismissRef.current?.()}
      >
        <span className="transient-status-icon" aria-hidden="true">
          {tone === 'success' ? '\u2713' : 'i'}
        </span>
        <span className="transient-status-text">{message}</span>
      </div>
    </div>,
    document.body,
  );
}
