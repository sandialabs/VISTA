import React, { useState, useCallback, useRef, useEffect, useMemo, useReducer } from 'react';
import FilenameMetadataExtractor, { isFilenameConventionEnabled } from './FilenameMetadataExtractor';
import AssociatedMetadataPanel from './AssociatedMetadataPanel';
import UploadActionsPanel from './UploadActionsPanel';
import { getConfiguredNsiproParserId } from '../metadata/nsiproParsers';
import {
  buildMetadataWithAssociatedReference,
  isAssociatedMetadataFile,
} from '../utils/associatedMetadataFile';
import S3ImportPanel from './S3ImportPanel';
import ImageUploadDropArea from './ImageUploadDropArea';
import { buildSavedFilenameExtractorConfig } from '../features/imageUpload/filenameExtractorConfig';
import { normalizeHierarchyMetadata } from '../features/imageUpload/inspectionPartIngest';
import { formatUploadSize, getTotalUploadSizeBytes } from '../features/imageUpload/uploadFormatting';
import { useDataOperationGuard } from '../features/imageUpload/useDataOperationGuard';
import { useUploadProgress } from '../features/imageUpload/useUploadProgress';
import { useLocalUploadHandler } from '../features/imageUpload/useLocalUploadHandler';
import { useS3ImportHandler } from '../features/imageUpload/useS3ImportHandler';
import { useTestDataLoaders } from '../features/imageUpload/useTestDataLoaders';
import { useAssociatedMetadataFile } from '../features/imageUpload/useAssociatedMetadataFile';
import { useManualMetadataInput } from '../features/imageUpload/useManualMetadataInput';
import { useS3Listing } from '../features/imageUpload/useS3Listing';
import {
  UPLOAD_SOURCES,
  initialUploadQueueState,
  isQueueUploading,
  selectS3GlobalSelectionKeys,
  uploadQueueReducer,
} from '../features/imageUpload/uploadQueueReducer';


const S3_PICKER_PAGE_SIZE = 100;

function normalizeProjectType(value = 'PT1') {
  return String(value || 'PT1').trim().toUpperCase() || 'PT1';
}

function isPt1ProjectType(value) {
  return normalizeProjectType(value) === 'PT1';
}

function ImageUploader({ projectId, projectType = 'PT1', projectConfiguration = null, onUploadComplete, onProjectMetadataLoaded, setError }) {
  const normalizedProjectType = normalizeProjectType(projectType);
  const isPt1Project = isPt1ProjectType(normalizedProjectType);
  const activeFileNamingScheme = isPt1Project ? null : projectConfiguration?.file_naming_scheme;
  const [isDragOver, setIsDragOver] = useState(false);
  const savedExtractorConfig = useMemo(
    () => buildSavedFilenameExtractorConfig({ file_naming_scheme: activeFileNamingScheme }),
    [activeFileNamingScheme],
  );
  const [legacyExtractorConfig, setLegacyExtractorConfig] = useState(null);
  const extractorConfig = legacyExtractorConfig || savedExtractorConfig;
  const nsiproParserId = useMemo(
    () => getConfiguredNsiproParserId(projectConfiguration),
    [projectConfiguration],
  );
  const [groupKey, setGroupKey] = useState('');
  const [uploadQueue, dispatchUploadQueue] = useReducer(uploadQueueReducer, initialUploadQueueState);
  const selectedFiles = uploadQueue.localFiles;
  const uploading = isQueueUploading(uploadQueue, UPLOAD_SOURCES.LOCAL);
  const importingS3Files = isQueueUploading(uploadQueue, [UPLOAD_SOURCES.S3, UPLOAD_SOURCES.S3_RECONCILE]);
  const {
    objects: s3Objects,
    selectedKeys: selectedS3Keys,
    confirmedKeys: confirmedS3Keys,
    retryMode: s3RetrySelectionMode,
    pageIndex: s3PageIndex,
    pickerOpen: s3PickerOpen,
    reconciliationBlock: s3ReconciliationBlock,
  } = uploadQueue.s3;
  const cancelledRef = useRef(false);

  const {
    activeDataOperation,
    acquireDataOperation,
    ownsDataOperation,
    isDataOperationCurrent,
    releaseDataOperation,
    resetDataOperation,
    abortCurrentDataOperation,
    uploadAbortControllerRef,
  } = useDataOperationGuard(projectId);
  const {
    uploadProgress,
    setUploadProgressSnapshot,
    beginUploadProgress,
    finishUploadProgress,
  } = useUploadProgress();
  const {
    loadingTestData,
    loadingNistTestData,
    testDataResult,
    nistTestDataResult,
    resetTestDataState,
    handleLoadTestData,
    handleLoadNistTestData,
  } = useTestDataLoaders({
    projectId,
    projectType,
    onUploadComplete,
    setError,
    acquireDataOperation,
    ownsDataOperation,
    isDataOperationCurrent,
    releaseDataOperation,
  });
  const {
    associatedMetadataFile,
    associatedMetadataBundle,
    associatedMetadataParsing,
    associatedMetadataSaving,
    associatedMetadataSaved,
    associatedMetadataError,
    applyAssociatedMetadataFile,
    handleAssociatedMetadataFileChange,
    saveAssociatedMetadataBundle,
    handleLoadAssociatedMetadata,
    resetAssociatedMetadataState,
  } = useAssociatedMetadataFile({
    projectId,
    nsiproParserId,
    projectConfiguration,
    onProjectMetadataLoaded,
    acquireDataOperation,
    isDataOperationCurrent,
    releaseDataOperation,
    setError,
  });
  const { uploadMetadata, setUploadMetadata, parseManualMetadata } = useManualMetadataInput({ setError });
  const {
    s3Url,
    setS3Url,
    loadingS3Files,
    s3ListingTruncated,
    handleLoadS3Files,
    resetS3ListingState,
  } = useS3Listing({
    projectId,
    dispatchUploadQueue,
    acquireDataOperation,
    isDataOperationCurrent,
    ownsDataOperation,
    releaseDataOperation,
    setError,
  });

  useEffect(() => {
    resetDataOperation();
    dispatchUploadQueue({ type: 'reset' });
    resetTestDataState();
    resetAssociatedMetadataState();
    resetS3ListingState();
    setUploadMetadata('');
    cancelledRef.current = false;
    finishUploadProgress();

    return () => {
      abortCurrentDataOperation();
    };
  }, [
    abortCurrentDataOperation,
    finishUploadProgress,
    resetAssociatedMetadataState,
    resetDataOperation,
    resetS3ListingState,
    resetTestDataState,
    setUploadMetadata,
    projectId,
  ]);

  const extractorPreviewFiles = useMemo(() => {
    if (selectedFiles.length > 0) return [selectedFiles[0]];
    const firstS3Object = s3Objects[0];
    return firstS3Object
      ? [{ name: firstS3Object.filename || firstS3Object.key }]
      : [];
  }, [s3Objects, selectedFiles]);
  const selectedS3KeySet = useMemo(() => new Set(selectedS3Keys), [selectedS3Keys]);
  const confirmedS3KeySet = useMemo(() => new Set(confirmedS3Keys), [confirmedS3Keys]);
  const globalS3SelectionKeys = useMemo(
    () => selectS3GlobalSelectionKeys(uploadQueue.s3),
    [uploadQueue.s3],
  );
  const allGlobalS3SelectionKeysSelected = globalS3SelectionKeys.length > 0
    && globalS3SelectionKeys.every((key) => selectedS3KeySet.has(key));
  const s3PageCount = Math.max(1, Math.ceil(s3Objects.length / S3_PICKER_PAGE_SIZE));
  const activeS3PageIndex = Math.min(s3PageIndex, s3PageCount - 1);
  const s3PageStart = activeS3PageIndex * S3_PICKER_PAGE_SIZE;
  const s3PageEnd = Math.min(s3PageStart + S3_PICKER_PAGE_SIZE, s3Objects.length);
  const visibleS3Objects = useMemo(
    () => s3Objects.slice(s3PageStart, s3PageEnd),
    [s3Objects, s3PageEnd, s3PageStart],
  );
  const dataOperationBusy = activeDataOperation !== null;

  const notifyUploadComplete = useCallback(async (images, completion) => {
    if (!onUploadComplete) {
      return {
        reconciled: completion?.requiresAuthoritativeReconciliation !== true,
        error: null,
      };
    }
    try {
      const result = await onUploadComplete(images, completion);
      return {
        reconciled: completion?.requiresAuthoritativeReconciliation !== true
          || (result !== false && result?.reconciled !== false),
        error: null,
      };
    } catch (error) {
      return { reconciled: false, error };
    }
  }, [onUploadComplete]);

  const handleExtractorChange = useCallback((config) => {
    setLegacyExtractorConfig(config);
    if (groupKey && config.keys && !config.keys.includes(groupKey)) {
      setGroupKey('');
    }
  }, [groupKey]);

  useEffect(() => {
    if (groupKey && !extractorConfig.keys.includes(groupKey)) {
      setGroupKey('');
    }
  }, [extractorConfig.keys, groupKey]);

  const applySelectedUploadFiles = useCallback(async (files) => {
    const fileList = Array.from(files || []);
    const metadataFile = fileList.find(isAssociatedMetadataFile) || null;
    const uploadFiles = fileList.filter((file) => file !== metadataFile);
    dispatchUploadQueue({ type: 'local_files_selected', files: uploadFiles });
    if (metadataFile) {
      await applyAssociatedMetadataFile(metadataFile);
    }
  }, [applyAssociatedMetadataFile]);

  // Handle file input change
  const handleFileChange = async (e) => {
    if (e.target.files) {
      await applySelectedUploadFiles(e.target.files);
    }
  };

  // Handle drag and drop events
  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    setIsDragOver(false);
    if (dataOperationBusy) return;
    if (e.dataTransfer.files) {
      await applySelectedUploadFiles(e.dataTransfer.files);
    }
  };

  const handleUpload = useLocalUploadHandler({
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
  });

  const getMergedMetadataForName = useCallback((filename, manualMetadata, associatedMetadataReference = null) => {
    const extractedMetadata = extractorConfig.extractMetadata(filename);
    const mergedMetadata = (extractedMetadata || manualMetadata)
      ? { ...(extractedMetadata || {}), ...(manualMetadata || {}) }
      : null;
    const metadataWithAssociatedReference = buildMetadataWithAssociatedReference(
      mergedMetadata,
      associatedMetadataReference,
    );
    const hierarchyMetadata = normalizeHierarchyMetadata(metadataWithAssociatedReference);
    return hierarchyMetadata
      ? { ...metadataWithAssociatedReference, ...hierarchyMetadata }
      : metadataWithAssociatedReference;
  }, [extractorConfig]);

  const handleToggleS3Key = (key) => {
    dispatchUploadQueue({ type: 's3_key_toggled', key });
  };

  const handleToggleAllS3Keys = () => {
    dispatchUploadQueue({ type: 's3_all_toggled' });
  };

  const { handleImportS3Files, handleRetryS3Reconciliation } = useS3ImportHandler({
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
  });

  const selectedFilesTotalBytes = getTotalUploadSizeBytes(selectedFiles);
  const selectedS3TotalBytes = getTotalUploadSizeBytes(
    s3Objects.filter((object) => selectedS3KeySet.has(object.key))
  );

  return (
    <div className="card">
      <div className="card-header">
        <h2>Upload Images</h2>
      </div>
      <div className="card-content">
        <form onSubmit={handleUpload}>
          <ImageUploadDropArea
            isDragOver={isDragOver}
            dataOperationBusy={dataOperationBusy}
            selectedFilesCount={selectedFiles.length}
            selectedFilesTotalBytes={selectedFilesTotalBytes}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onFileChange={handleFileChange}
          />

          <S3ImportPanel
            s3Url={s3Url}
            onS3UrlChange={setS3Url}
            onLoadFiles={handleLoadS3Files}
            loading={loadingS3Files}
            reconciliationBlock={s3ReconciliationBlock}
            onRetryReconciliation={handleRetryS3Reconciliation}
            importing={importingS3Files}
            pickerOpen={s3PickerOpen}
            objects={s3Objects}
            visibleObjects={visibleS3Objects}
            selectedKeySet={selectedS3KeySet}
            confirmedKeySet={confirmedS3KeySet}
            selectedCount={selectedS3Keys.length}
            selectedTotalBytes={selectedS3TotalBytes}
            globalSelectionCount={globalS3SelectionKeys.length}
            allGlobalSelected={allGlobalS3SelectionKeysSelected}
            retryMode={s3RetrySelectionMode}
            listingTruncated={s3ListingTruncated}
            onToggleKey={handleToggleS3Key}
            onToggleAll={handleToggleAllS3Keys}
            pageIndex={activeS3PageIndex}
            pageCount={s3PageCount}
            pageStart={s3PageStart}
            pageEnd={s3PageEnd}
            onPageChange={(pageIndex) => dispatchUploadQueue({ type: 's3_page_changed', pageIndex })}
            onImport={handleImportS3Files}
            extractorValid={extractorConfig.isValid}
            onClosePicker={() => dispatchUploadQueue({ type: 's3_picker_closed' })}
            busy={dataOperationBusy}
            formatSize={formatUploadSize}
          />

          <div className="filename-decoder-utility">
            <FilenameMetadataExtractor
              files={extractorPreviewFiles}
              onConfigChange={handleExtractorChange}
              fileNamingScheme={activeFileNamingScheme}
              initialConfig={activeFileNamingScheme?.metadata_extractor || {
                mode: 'simple',
                pattern: isFilenameConventionEnabled(activeFileNamingScheme)
                  ? (activeFileNamingScheme?.delimiter || (activeFileNamingScheme ? '' : '_'))
                  : '',
                keys: [],
              }}
              title="Filename Regex & Delimiter Decoder"
            />
          </div>

          {!isPt1Project && extractorConfig.keys && extractorConfig.keys.length > 0 && (
            <div className="form-group">
              <label htmlFor="group-key-select">Use as Group Identifier (Optional)</label>
              <select
                id="group-key-select"
                value={groupKey}
                onChange={(e) => setGroupKey(e.target.value)}
                className="form-control"
              >
                <option value="">-- None --</option>
                {extractorConfig.keys.map((k) => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>
              <small className="form-text">
                Select which extracted key to use as the group identifier for each uploaded image.
              </small>
            </div>
          )}

          <AssociatedMetadataPanel
            busy={dataOperationBusy}
            associatedMetadataFile={associatedMetadataFile}
            onFileChange={handleAssociatedMetadataFileChange}
            onLoadMetadata={handleLoadAssociatedMetadata}
            parsing={associatedMetadataParsing}
            saving={associatedMetadataSaving}
            bundle={associatedMetadataBundle}
            error={associatedMetadataError}
            saved={associatedMetadataSaved}
          />

          <div className="form-group">
            <label htmlFor="metadata-input">Metadata (Optional JSON)</label>
            <textarea
              id="metadata-input"
              rows="3"
              placeholder='{"key": "value"}'
              value={uploadMetadata}
              onChange={(e) => setUploadMetadata(e.target.value)}
            ></textarea>
          </div>

          <UploadActionsPanel
            dataOperationBusy={dataOperationBusy}
            extractorValid={extractorConfig.isValid}
            associatedMetadataParsing={associatedMetadataParsing}
            associatedMetadataError={associatedMetadataError}
            uploading={uploading}
            loadingTestData={loadingTestData}
            onLoadTestData={handleLoadTestData}
            showNistButton={normalizedProjectType === 'PT3'}
            loadingNistTestData={loadingNistTestData}
            onLoadNistTestData={handleLoadNistTestData}
            onCancel={() => {
              cancelledRef.current = true;
              uploadAbortControllerRef.current?.abort();
            }}
            uploadProgress={uploadProgress}
            testDataResult={testDataResult}
            nistTestDataResult={nistTestDataResult}
            projectType={projectType}
          />
        </form>
      </div>
    </div>
  );
}

export default ImageUploader;
