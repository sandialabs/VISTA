import React, { useEffect } from 'react';

export const UNDO_WINDOW_MS = 8000;

/** "Moved N items. Undo" notice; disappears after a few seconds. */
export default function UndoToast({ message, onUndo, onDismiss, duration = UNDO_WINDOW_MS }) {
  useEffect(() => {
    const timer = window.setTimeout(onDismiss, duration);
    return () => window.clearTimeout(timer);
  }, [onDismiss, duration]);

  return (
    <div className="undo-toast" role="status" aria-live="polite">
      <span>{message}</span>
      <button type="button" className="btn btn-small btn-secondary" onClick={onUndo}>Undo</button>
      <button type="button" className="undo-toast-close" aria-label="Dismiss" onClick={onDismiss}>&times;</button>
    </div>
  );
}
