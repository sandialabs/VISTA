// S3 import submit handler and reconciliation retry. Resolves per-file
// metadata and group identifiers, runs the bounded-concurrency S3 import
// plan, ingests inspection parts for non-PT1 projects, and reconciles
// project data exactly once per import.
import { useCallback } from 'react';
import { runProjectIngest } from '../../api/projects';
import { boundApiErrorDetail, formatApiErrorDetail, readApiErrorDetail } from './errorFormatting';
import { buildInspectionPartIngestPayload } from './inspectionPartIngest';
import { runS3ImportPlan, S3_IMPORT_BATCH_SIZE } from './s3ImportWorker';
import { getTotalUploadSizeBytes } from './uploadFormatting';
import { UPLOAD_SOURCES } from './uploadQueueReducer';

export function useS3ImportHandler({
  projectId,
  isPt1Project,
  groupKey,
  extractorConfig,
  parseManualMetadata,
  getMergedMetadataForName,
  s3Url,
  s3Objects,
  selectedS3Keys,
  selectedS3KeySet,
  s3ReconciliationBlock,
  associatedMetadataFile,
  saveAssociatedMetadataBundle,
  onProjectMetadataLoaded,
  notifyUploadComplete,
  setError,
  dispatchUploadQueue,
  acquireDataOperation,
  ownsDataOperation,
  isDataOperationCurrent,
  releaseDataOperation,
  beginUploadProgress,
  setUploadProgressSnapshot,
  finishUploadProgress,
}) {
  const handleImportS3Files = useCallback(async () => {
    if (s3ReconciliationBlock) {
      setError('S3 retry is blocked until the uncertain import is reconciled with the project.');
      return;
    }
    if (selectedS3Keys.length === 0) {
      setError('Please choose at least one S3 file to load.');
      return;
    }
    if (!extractorConfig.isValid) {
      setError('Filename metadata extractor has errors. Please fix them before loading S3 files.');
      return;
    }
    const manualMetadata = parseManualMetadata();
    if (manualMetadata === undefined) return;
    const selectedObjects = s3Objects.filter((object) => selectedS3KeySet.has(object.key));
    if (selectedObjects.length === 0) {
      setError('Selected S3 files are no longer available. Reload the S3 listing and try again.');
      return;
    }
    const selectedS3Url = s3Url.trim();
    const operation = acquireDataOperation('s3_import', { s3: true });
    if (!operation) return;
    dispatchUploadQueue({ type: 'upload_started', source: UPLOAD_SOURCES.S3 });

    try {
      let associatedMetadataReference = null;
      if (associatedMetadataFile) {
        try {
          associatedMetadataReference = await saveAssociatedMetadataBundle(operation.controller.signal);
          if (!isDataOperationCurrent(operation)) return;
          if (onProjectMetadataLoaded) {
            try {
              await onProjectMetadataLoaded(associatedMetadataReference);
              if (!isDataOperationCurrent(operation)) return;
            } catch (metadataRefreshError) {
              if (!isDataOperationCurrent(operation)) return;
              console.error('Associated metadata was saved, but the project metadata view could not be refreshed:', metadataRefreshError);
            }
          }
        } catch (err) {
          if (!isDataOperationCurrent(operation)) return;
          const detail = err?.message ? ` ${err.message}` : '';
          setError(`Unable to associate metadata file.${detail}`);
          return;
        }
      }

      const perFileMetadata = {};
      const groupIdentifiers = {};
      selectedObjects.forEach((object) => {
        const metadataForUpload = getMergedMetadataForName(
          object.filename,
          manualMetadata,
          associatedMetadataReference,
        );
        if (metadataForUpload) {
          perFileMetadata[object.key] = metadataForUpload;
        }
        const extractedMetadata = extractorConfig.extractMetadata(object.filename);
        if (!isPt1Project && groupKey && extractedMetadata && extractedMetadata[groupKey]) {
          groupIdentifiers[object.key] = extractedMetadata[groupKey];
        }
      });

      const totalBytes = getTotalUploadSizeBytes(selectedObjects);
      beginUploadProgress({ completed: 0, failed: 0, total: selectedObjects.length, loadedBytes: 0, totalBytes });

      const { imported, failed, completionUnknown, importedByKey } = await runS3ImportPlan({
        projectId,
        selectedS3Url,
        selectedObjects,
        perFileMetadata,
        groupIdentifiers,
        signal: operation.controller.signal,
        isCurrent: () => isDataOperationCurrent(operation),
        onProgress: (progress) => setUploadProgressSnapshot(progress),
        batchSize: S3_IMPORT_BATCH_SIZE,
      });
      if (!isDataOperationCurrent(operation)) return;

      const retryableS3Keys = failed.map((outcome) => outcome.key);
      const importedS3Keys = selectedObjects
        .filter((object) => importedByKey.has(object.key))
        .map((object) => object.key);
      dispatchUploadQueue({
        type: 's3_import_settled',
        attemptedKeys: selectedObjects.map((object) => object.key),
        importedKeys: importedS3Keys,
        retryableKeys: retryableS3Keys,
        completionUnknownKeys: completionUnknown.map((outcome) => outcome.key),
        pageSize: S3_IMPORT_BATCH_SIZE,
      });
      setUploadProgressSnapshot({
        completed: selectedObjects.length,
        failed: failed.length + completionUnknown.length,
        total: selectedObjects.length,
        loadedBytes: totalBytes,
        totalBytes,
      }, { flush: true });

      let ingestError = null;
      let ingestCompletionUnknown = false;
      const uploadedRecords = isPt1Project
        ? []
        : selectedObjects
          .map((object) => {
            const image = importedByKey.get(object.key);
            if (!image) return null;
            return {
              image,
              filename: object.filename,
              metadata: perFileMetadata[object.key] || {},
            };
          })
          .filter(Boolean);
      const ingestPayload = buildInspectionPartIngestPayload(uploadedRecords);
      const partCount = ingestPayload.batches.reduce((acc, batch) => acc + batch.parts.length, 0)
        + ingestPayload.unassigned_parts.length;
      if (partCount > 0) {
        try {
          await runProjectIngest(projectId, ingestPayload, {
            signal: operation.controller.signal,
          }).catch((requestError) => {
            if (requestError?.name !== 'ApiError') throw requestError;
            const error = new Error(readApiErrorDetail(requestError));
            const status = Number(requestError.status);
            error.ingestCompletionUnknown = !(status >= 400 && status < 500);
            throw error;
          });
        } catch (err) {
          if (!isDataOperationCurrent(operation)) return;
          ingestError = err;
          ingestCompletionUnknown = err?.ingestCompletionUnknown !== false;
          console.error('Error ingesting S3-loaded images as inspection parts:', err);
        }
      }

      const completion = {
        source: 's3_import',
        total: selectedObjects.length,
        confirmedSucceeded: imported.length,
        confirmedFailed: failed.length,
        completionUnknown: completionUnknown.length,
        notStarted: 0,
        cancelled: false,
        partsMayHaveChanged: partCount > 0 || completionUnknown.length > 0 || ingestCompletionUnknown,
        ingestFailed: Boolean(ingestError),
        ingestCompletionUnknown,
        requiresAuthoritativeReconciliation: completionUnknown.length > 0 || ingestCompletionUnknown,
      };
      // A 5xx, transport failure, or unreadable success response can happen
      // after the server commits. Refresh once instead of retrying and
      // risking duplicate project images.
      const reconciliationResult = await notifyUploadComplete(imported, completion);
      let reconciliationBlock = null;
      if (!isDataOperationCurrent(operation)) return;
      const ingestErrorDetail = boundApiErrorDetail(ingestError?.message) || 'request failed after dispatch';
      const committedImageSummary = `S3 image import complete: ${imported.length} loaded and committed, ${failed.length} failed out of ${selectedObjects.length}.`;
      const firstConfirmedFailureReason = Array.from(new Set(
        failed
          .map((outcome) => formatApiErrorDetail(outcome.error))
          .filter(Boolean),
      ))[0] || '';
      const confirmedFailureDetail = firstConfirmedFailureReason
        ? ` First confirmed failure: ${firstConfirmedFailureReason}.`
        : '';
      if (completionUnknown.length > 0) {
        const ingestDetail = ingestError
          ? (ingestCompletionUnknown
            ? ` Confirmed image imports are committed; part creation completion is uncertain: ${ingestErrorDetail}.`
            : ` Confirmed image imports are committed, but part creation failed: ${ingestErrorDetail}.`)
          : '';
        const retryDetail = ' Confirmed successes and completion-unknown files were removed from the retry selection; completion-unknown files require manual audit and explicit reselection.';
        if (reconciliationResult.reconciled) {
          setError(
            `S3 load finished with uncertain results: ${imported.length} confirmed succeeded, ${completionUnknown.length} completion unknown, ${failed.length} failed out of ${selectedObjects.length}.${confirmedFailureDetail} Project data was refreshed.${retryDetail}${ingestDetail}`,
          );
        } else {
          reconciliationBlock = { completion };
          setError(
            `S3 load finished with uncertain results: ${imported.length} confirmed succeeded, ${completionUnknown.length} completion unknown, ${failed.length} failed out of ${selectedObjects.length}.${confirmedFailureDetail} Authoritative project reconciliation failed, so S3 retry is blocked until reconciliation succeeds.${retryDetail}${ingestDetail}`,
          );
        }
      } else if (ingestCompletionUnknown) {
        setError(reconciliationResult.reconciled
          ? `${committedImageSummary} Part creation completion is uncertain: ${ingestErrorDetail}. Project data was authoritatively reconciled.`
          : `${committedImageSummary} Part creation completion is uncertain: ${ingestErrorDetail}. Authoritative project reconciliation failed.`);
      } else if (failed.length > 0) {
        const ingestDetail = ingestError
          ? ` Imported images are committed, but part creation failed: ${ingestErrorDetail}.`
          : '';
        setError(`S3 load complete: ${imported.length} succeeded, ${failed.length} failed out of ${selectedObjects.length}.${confirmedFailureDetail}${ingestDetail}`);
      } else if (ingestError) {
        setError(`${committedImageSummary} Part creation failed: ${ingestErrorDetail}.`);
      } else {
        setError(null);
      }
      dispatchUploadQueue({ type: 's3_import_reported', reconciliationBlock });
    } catch (err) {
      if (!isDataOperationCurrent(operation) || err?.name === 'AbortError') return;
      const detail = err?.message ? ` ${err.message}` : '';
      setError(`Failed to import selected S3 files.${detail}`);
    } finally {
      if (ownsDataOperation(operation)) {
        dispatchUploadQueue({ type: 'upload_finished' });
        finishUploadProgress();
      }
      releaseDataOperation(operation);
    }
  }, [
    acquireDataOperation,
    associatedMetadataFile,
    beginUploadProgress,
    dispatchUploadQueue,
    extractorConfig,
    finishUploadProgress,
    getMergedMetadataForName,
    groupKey,
    isDataOperationCurrent,
    isPt1Project,
    notifyUploadComplete,
    onProjectMetadataLoaded,
    ownsDataOperation,
    parseManualMetadata,
    projectId,
    releaseDataOperation,
    s3Objects,
    s3ReconciliationBlock,
    s3Url,
    saveAssociatedMetadataBundle,
    selectedS3KeySet,
    selectedS3Keys,
    setError,
    setUploadProgressSnapshot,
  ]);

  const handleRetryS3Reconciliation = useCallback(async () => {
    if (!s3ReconciliationBlock) return;
    const operation = acquireDataOperation('s3_reconcile', { s3: true });
    if (!operation) return;
    dispatchUploadQueue({ type: 'upload_started', source: UPLOAD_SOURCES.S3_RECONCILE });
    try {
      const result = await notifyUploadComplete([], {
        ...s3ReconciliationBlock.completion,
        retryReconciliation: true,
      });
      if (!isDataOperationCurrent(operation)) return;
      if (result.reconciled) {
        dispatchUploadQueue({ type: 's3_reconciliation_resolved' });
        setError('Project reconciliation succeeded. Completion-unknown S3 files remain unselected; audit project data and explicitly reselect a file only if retrying is safe.');
      } else {
        setError('Authoritative project reconciliation still failed. S3 retry remains blocked.');
      }
    } finally {
      if (ownsDataOperation(operation)) dispatchUploadQueue({ type: 'upload_finished' });
      releaseDataOperation(operation);
    }
  }, [
    acquireDataOperation,
    dispatchUploadQueue,
    isDataOperationCurrent,
    notifyUploadComplete,
    ownsDataOperation,
    releaseDataOperation,
    s3ReconciliationBlock,
    setError,
  ]);

  return { handleImportS3Files, handleRetryS3Reconciliation };
}
