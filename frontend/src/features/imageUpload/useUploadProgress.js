// Tracks a periodically-refreshed upload progress snapshot. Progress updates
// are written to a ref immediately but only flushed to render state on an
// interval (or explicitly), so rapid per-item progress callbacks do not
// trigger a render per item.
import { useCallback, useEffect, useRef, useState } from 'react';

const UPLOAD_PROGRESS_UPDATE_INTERVAL_MS = 5000;

export function useUploadProgress() {
  const [uploadProgress, setUploadProgress] = useState(null);
  const uploadProgressRef = useRef(null);
  const uploadProgressTimerRef = useRef(null);

  const clearUploadProgressTimer = useCallback(() => {
    if (uploadProgressTimerRef.current) {
      clearInterval(uploadProgressTimerRef.current);
      uploadProgressTimerRef.current = null;
    }
  }, []);

  const setUploadProgressSnapshot = useCallback((snapshot, { flush = false } = {}) => {
    uploadProgressRef.current = snapshot;
    if (flush) {
      setUploadProgress(snapshot);
    }
  }, []);

  const beginUploadProgress = useCallback((initialProgress) => {
    clearUploadProgressTimer();
    setUploadProgressSnapshot(initialProgress, { flush: true });
    uploadProgressTimerRef.current = setInterval(() => {
      if (uploadProgressRef.current) {
        setUploadProgress({ ...uploadProgressRef.current });
      }
    }, UPLOAD_PROGRESS_UPDATE_INTERVAL_MS);
  }, [clearUploadProgressTimer, setUploadProgressSnapshot]);

  const finishUploadProgress = useCallback(() => {
    clearUploadProgressTimer();
    uploadProgressRef.current = null;
    setUploadProgress(null);
  }, [clearUploadProgressTimer]);

  useEffect(() => clearUploadProgressTimer, [clearUploadProgressTimer]);

  return {
    uploadProgress,
    setUploadProgressSnapshot,
    beginUploadProgress,
    finishUploadProgress,
    clearUploadProgressTimer,
  };
}
