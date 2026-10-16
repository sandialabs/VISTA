// Local (drag-and-drop/file-picker) image upload submit handler. Builds
// per-file metadata, runs the batched upload plan, ingests inspection parts
// for non-PT1 projects, and reconciles project data exactly once per submit.
import { useCallback } from 'react';
import { buildMetadataWithAssociatedReference } from '../../utils/associatedMetadataFile';
import { runProjectIngest } from '../../api/projects';
import { runImageUploadPlan } from '../../components/imageUploadBatches';
import { buildInspectionPartIngestPayload, normalizeHierarchyMetadata } from './inspectionPartIngest';
import { getTotalUploadSizeBytes, getUploadItemSizeBytes } from './uploadFormatting';
import { UPLOAD_SOURCES } from './uploadQueueReducer';

export function useLocalUploadHandler({
  projectId,
  isPt1Project,
  groupKey,
  extractorConfig,
  selectedFiles,
  uploadMetadata,
  setUploadMetadata,
  associatedMetadataFile,
  saveAssociatedMetadataBundle,
  onProjectMetadataLoaded,
  notifyUploadComplete,
  setError,
  dispatchUploadQueue,
  acquireDataOperation,
  ownsDataOperation,
  releaseDataOperation,
  beginUploadProgress,
  setUploadProgressSnapshot,
  finishUploadProgress,
  cancelledRef,
  uploadAbortControllerRef,
}) {
  return useCallback(async (e) => {
    e.preventDefault();

    if (selectedFiles.length === 0) {
      setError('Please select at least one file to upload.');
      return;
    }

    // Block upload when the extractor configuration is invalid.
    if (!extractorConfig.isValid) {
      setError('Filename metadata extractor has errors. Please fix them before uploading.');
      return;
    }

    // Validate manual metadata JSON if provided
    let manualMetadata = null;
    if (uploadMetadata.trim()) {
      try {
        manualMetadata = JSON.parse(uploadMetadata);
      } catch (err) {
        setError('Invalid JSON format for metadata.');
        return;
      }
    }

    const operation = acquireDataOperation('local_upload');
    if (!operation) return;
    dispatchUploadQueue({ type: 'upload_started', source: UPLOAD_SOURCES.LOCAL });
    cancelledRef.current = false;
    const uploadController = operation.controller;
    uploadAbortControllerRef.current = uploadController;
    try {
      const total = selectedFiles.length;
      const totalBytes = getTotalUploadSizeBytes(selectedFiles);
      beginUploadProgress({ completed: 0, failed: 0, total, loadedBytes: 0, totalBytes });

      let associatedMetadataReference = null;
      if (associatedMetadataFile) {
        try {
          associatedMetadataReference = await saveAssociatedMetadataBundle(uploadController.signal);
          if (!ownsDataOperation(operation)) return;
          if (onProjectMetadataLoaded) {
            try {
              await onProjectMetadataLoaded(associatedMetadataReference);
              if (!ownsDataOperation(operation)) return;
            } catch (metadataRefreshError) {
              if (!ownsDataOperation(operation)) return;
              console.error('Associated metadata was saved, but the project metadata view could not be refreshed:', metadataRefreshError);
            }
          }
        } catch (err) {
          if (!ownsDataOperation(operation)) return;
          if (cancelledRef.current || uploadController.signal.aborted) {
            await notifyUploadComplete([], {
              source: 'local_upload',
              total,
              confirmedSucceeded: 0,
              confirmedFailed: 0,
              completionUnknown: 0,
              notStarted: total,
              cancelled: true,
              partsMayHaveChanged: false,
              requiresAuthoritativeReconciliation: false,
            });
            if (ownsDataOperation(operation)) {
              setError('Upload cancelled before any images were sent. Project data was refreshed.');
            }
          } else {
            const detail = err?.message ? ` ${err.message}` : '';
            setError(`Unable to associate metadata file.${detail}`);
          }
          return;
        }
      }

      let completed = 0;
      let failed = 0;
      let loadedBytes = 0;
      const uploadItems = selectedFiles.map((file, clientIndex) => {
        const extractedMetadata = extractorConfig.extractMetadata(file.name);
        const mergedMetadata = (extractedMetadata || manualMetadata)
          ? { ...(extractedMetadata || {}), ...(manualMetadata || {}) }
          : null;
        const metadataWithAssociatedReference = buildMetadataWithAssociatedReference(
          mergedMetadata,
          associatedMetadataReference,
        );
        const hierarchyMetadata = normalizeHierarchyMetadata(metadataWithAssociatedReference);
        const metadataForUpload = hierarchyMetadata
          ? { ...metadataWithAssociatedReference, ...hierarchyMetadata }
          : metadataWithAssociatedReference;
        return {
          clientIndex,
          file,
          filename: file.name,
          metadata: metadataForUpload || {},
          groupIdentifier: !isPt1Project && groupKey && extractedMetadata?.[groupKey]
            ? String(extractedMetadata[groupKey])
            : null,
        };
      });

      const uploadResult = await runImageUploadPlan({
        items: uploadItems,
        projectId,
        signal: uploadController.signal,
        shouldStop: () => cancelledRef.current,
        onItemSettled: (outcome) => {
          if (!ownsDataOperation(operation)) return;
          completed += 1;
          if (!outcome.ok) failed += 1;
          loadedBytes += getUploadItemSizeBytes(outcome.item.file);
          setUploadProgressSnapshot({ completed, failed, total, loadedBytes, totalBytes });
        },
      });
      if (!ownsDataOperation(operation)) return;
      const results = uploadResult.successes.map((outcome) => outcome.image);
      const uploadedRecords = isPt1Project
        ? []
        : uploadResult.successes.map((outcome) => ({
          image: outcome.image,
          filename: outcome.item.filename,
          metadata: outcome.item.metadata,
        }));
      const uploadWasCancelled = () => (
        uploadResult.cancelled || cancelledRef.current || uploadController.signal.aborted
      );
      const completionUnknown = uploadResult.completionUnknown.length;
      let cancelled = uploadWasCancelled();
      const notStarted = uploadResult.failures.filter((outcome) => (
        outcome.code === 'cancelled_before_start'
      )).length;
      const confirmedFailed = Math.max(0, uploadResult.failures.length - completionUnknown - notStarted);
      const retryableFiles = uploadResult.failures
        .filter((outcome) => outcome.code !== 'completion_unknown')
        .map((outcome) => outcome.item.file);

      let ingestError = null;
      let ingestCompletionUnknown = false;
      const ingestPayload = buildInspectionPartIngestPayload(uploadedRecords);
      const partCount = ingestPayload.batches.reduce((acc, batch) => acc + batch.parts.length, 0)
        + ingestPayload.unassigned_parts.length;
      if (partCount > 0 && !cancelled) {
        try {
          await runProjectIngest(projectId, ingestPayload, {
            signal: uploadController.signal,
          }).catch((requestError) => {
            if (requestError?.name !== 'ApiError') throw requestError;
            const error = new Error(`HTTP ${requestError.status}`);
            error.ingestCompletionUnknown = requestError.status >= 500;
            throw error;
          });
        } catch (err) {
          if (!ownsDataOperation(operation)) return;
          ingestError = err;
          ingestCompletionUnknown = err?.ingestCompletionUnknown !== false;
          console.error('Error ingesting uploaded images as inspection parts:', err);
        }
      }
      if (!ownsDataOperation(operation)) return;
      cancelled = uploadWasCancelled();

      let reconciliationResult = { reconciled: true, error: null };
      if (results.length > 0 || cancelled || completionUnknown > 0) {
        // A rejected/aborted request can still have committed on the server. One
        // authoritative refresh reconciles the UI without risking a retry.
        reconciliationResult = await notifyUploadComplete(results, {
          source: 'local_upload',
          total,
          confirmedSucceeded: results.length,
          confirmedFailed,
          completionUnknown,
          notStarted,
          cancelled,
          partsMayHaveChanged: partCount > 0 || completionUnknown > 0 || cancelled || ingestCompletionUnknown,
          ingestFailed: Boolean(ingestError),
          ingestCompletionUnknown,
          requiresAuthoritativeReconciliation: completionUnknown > 0 || cancelled || ingestCompletionUnknown,
        });
        if (!ownsDataOperation(operation)) return;
      }
      const reconciliationMessage = (completionUnknown > 0 || cancelled || ingestCompletionUnknown) && !reconciliationResult.reconciled
        ? ' Authoritative project reconciliation failed; reload the project before acting on uncertain files.'
        : ' Project data was refreshed.';
      const uncertainRetryMessage = completionUnknown > 0
        ? ' Completion-unknown files were removed from the retry selection; audit project data and explicitly reselect them only if retrying is safe.'
        : '';
      if (cancelled) {
        const failedSummary = confirmedFailed > 0 ? `, ${confirmedFailed} failed` : '';
        setError(
          `Upload cancelled: ${results.length} confirmed succeeded, ${completionUnknown} completion unknown, ${notStarted} not started${failedSummary} out of ${total}.${reconciliationMessage}${uncertainRetryMessage}`,
        );
      } else if (completionUnknown > 0) {
        const confirmedFailedForMessage = Math.max(0, uploadResult.failures.length - completionUnknown);
        setError(
          `Upload finished with uncertain results: ${results.length} confirmed succeeded, ${completionUnknown} completion unknown, ${confirmedFailedForMessage} failed out of ${total}.${reconciliationMessage}${uncertainRetryMessage}`,
        );
      } else if (failed > 0) {
        const locallyRejected = uploadResult.failures.filter((outcome) => (
          outcome.code === 'manifest_item_too_large' || outcome.code === 'invalid_manifest_metadata'
        ));
        const rejectionDetail = locallyRejected.length > 0
          ? ` ${locallyRejected.length} ${locallyRejected.length === 1 ? 'file was' : 'files were'} not sent because upload metadata exceeded a built-in limit or was invalid. First: ${locallyRejected[0].item.filename}: ${locallyRejected[0].detail}.`
          : '';
        setError(`Upload complete: ${results.length} succeeded, ${failed} failed out of ${total}.${rejectionDetail}`);
      } else if (ingestCompletionUnknown) {
        setError(`Images uploaded, but part-ingest completion is unknown.${reconciliationMessage}`);
      } else if (ingestError) {
        setError('Images uploaded, but parts could not be created from filename metadata.');
      } else {
        setError(null);
      }
      dispatchUploadQueue({
        type: 'local_upload_settled',
        retryableFiles,
        completionUnknownCount: completionUnknown,
      });
      if (retryableFiles.length === 0) {
        setUploadMetadata('');
      }
    } finally {
      if (ownsDataOperation(operation)) {
        finishUploadProgress();
        dispatchUploadQueue({ type: 'upload_finished' });
      }
      releaseDataOperation(operation);
    }
  }, [
    acquireDataOperation,
    associatedMetadataFile,
    beginUploadProgress,
    cancelledRef,
    dispatchUploadQueue,
    extractorConfig,
    finishUploadProgress,
    groupKey,
    isPt1Project,
    notifyUploadComplete,
    onProjectMetadataLoaded,
    ownsDataOperation,
    projectId,
    releaseDataOperation,
    saveAssociatedMetadataBundle,
    selectedFiles,
    setError,
    setUploadMetadata,
    setUploadProgressSnapshot,
    uploadAbortControllerRef,
    uploadMetadata,
  ]);
}
