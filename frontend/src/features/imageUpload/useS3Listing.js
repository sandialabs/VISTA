// S3 URL input and object listing. Owns the URL/loading/truncation state
// together with the "Load Files" submit handler that populates the shared
// upload queue's S3 object list.
import { useCallback, useState } from 'react';
import { listProjectS3ObjectsResponse } from '../../api/projects';

export function useS3Listing({
  projectId,
  dispatchUploadQueue,
  acquireDataOperation,
  isDataOperationCurrent,
  ownsDataOperation,
  releaseDataOperation,
  setError,
}) {
  const [s3Url, setS3Url] = useState('');
  const [loadingS3Files, setLoadingS3Files] = useState(false);
  const [s3ListingTruncated, setS3ListingTruncated] = useState(false);

  const resetS3ListingState = useCallback(() => {
    setLoadingS3Files(false);
    setS3Url('');
    setS3ListingTruncated(false);
  }, []);

  const handleLoadS3Files = useCallback(async () => {
    if (!s3Url.trim()) {
      setError('Please specify an S3 URL.');
      return;
    }
    const operation = acquireDataOperation('s3_list', { s3: true });
    if (!operation) return;
    setLoadingS3Files(true);
    dispatchUploadQueue({ type: 's3_listing_started' });
    setS3ListingTruncated(false);
    try {
      const response = await listProjectS3ObjectsResponse(projectId, s3Url.trim(), {
        signal: operation.controller.signal,
      });
      if (!isDataOperationCurrent(operation)) return;
      if (!response.ok) {
        let detail = `HTTP ${response.status}`;
        try {
          const payload = await response.json();
          detail = payload?.detail || detail;
        } catch (parseError) {
          detail = response.statusText || detail;
        }
        throw new Error(detail);
      }
      const payload = await response.json();
      if (!isDataOperationCurrent(operation)) return;
      const objects = payload.objects || [];
      dispatchUploadQueue({ type: 's3_listing_loaded', objects });
      setS3ListingTruncated(Boolean(payload.truncated));
      setError(objects.length ? null : 'No supported files were found at that S3 URL.');
    } catch (err) {
      if (!isDataOperationCurrent(operation) || err?.name === 'AbortError') return;
      const detail = err?.message ? ` ${err.message}` : '';
      setError(`Failed to load files from S3.${detail}`);
    } finally {
      if (ownsDataOperation(operation)) setLoadingS3Files(false);
      releaseDataOperation(operation);
    }
  }, [
    acquireDataOperation,
    dispatchUploadQueue,
    isDataOperationCurrent,
    ownsDataOperation,
    projectId,
    releaseDataOperation,
    s3Url,
    setError,
  ]);

  return {
    s3Url,
    setS3Url,
    loadingS3Files,
    s3ListingTruncated,
    handleLoadS3Files,
    resetS3ListingState,
  };
}
